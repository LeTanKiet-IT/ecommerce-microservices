
import { createHash } from "node:crypto";

import { prepareOrder } from "./create-order.use-case.js";
import { createRequestHash } from "./request-hash.js";

import { productReservationClient } from "../../infrastructure/clients/product-reservation.client.js";
import { orderRepository } from "../../infrastructure/repositories/order.repository.js";
import { orderRequestRepository } from "../../infrastructure/repositories/order-request.repository.js";

// Tao Reservation ID co dinh theo customer va Idempotency Key.
function makeReservationId(customerAuthUserId, idempotencyKey) {
  const hash = createHash("sha256")
    .update(`${customerAuthUserId}:${idempotencyKey}`)
    .digest("hex");

  return `ORDER_RES_${hash}`;
}

function makeError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

// Ket qua xu ly khong chac chan:
// ghi nhan trang thai can doi soat va dung xu ly.
// Khong tu dong Reserve lai hoac Release ton kho.
async function requireReconciliation(idempotencyKey, cause) {
  try {
    await orderRequestRepository.markReconciliationRequired(
      idempotencyKey
    );
  } catch (markError) {
    const error = makeError(
      "Order outcome uncertain; reconciliation status could not be saved",
      503,
      "ORDER_RECONCILIATION_REQUIRED"
    );

    error.cause = markError;
    throw error;
  }

  const error = makeError(
    "Order requires reconciliation before retry",
    503,
    "STOCK_RECONCILIATION_REQUIRED"
  );

  error.cause = cause;
  throw error;
}

// Chi xem day la loi het hang khi Product Service
// da tra loi ro rang bang HTTP 409.
function isInsufficientStock(error) {
  return (
    error?.status === 409 &&
    error?.code === "INSUFFICIENT_STOCK"
  );
}

export async function placeOrder({
  idempotencyKey,
  customerAuthUserId,
  items,
}) {
  // 1. Kiem tra Idempotency Key
  if (
    typeof idempotencyKey !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(idempotencyKey)
  ) {
    throw makeError(
      "Invalid idempotency key",
      400,
      "INVALID_IDEMPOTENCY_KEY"
    );
  }

  // 2. Tao Request Hash
  const requestHash = createRequestHash({
    customerAuthUserId,
    items,
  });

  // 3. Kiem tra Order da ton tai
  const existingOrder =
    await orderRepository.findByIdempotencyKey(idempotencyKey);

  if (existingOrder) {
    if (
      Number(existingOrder.customer_auth_user_id) !==
      Number(customerAuthUserId)
    ) {
      throw makeError(
        "Idempotency key belongs to another customer",
        409,
        "IDEMPOTENCY_KEY_CONFLICT"
      );
    }

    if (
      !existingOrder.request_hash ||
      existingOrder.request_hash !== requestHash
    ) {
      throw makeError(
        "Idempotency key already used for a different order request",
        409,
        "IDEMPOTENCY_KEY_CONFLICT"
      );
    }

    if (existingOrder.status === "PENDING_SHIPMENT") {
      return existingOrder;
    }

    if (
      existingOrder.status === "AWAITING_STOCK_CONFIRMATION"
    ) {
      throw makeError(
        "Order is awaiting stock confirmation; reconciliation required",
        503,
        "STOCK_RECONCILIATION_REQUIRED"
      );
    }

    throw makeError(
      "Order already exists with this idempotency key",
      409,
      "IDEMPOTENCY_KEY_CONFLICT"
    );
  }

  // 4. Chuan bi Order
  const prepared = await prepareOrder({
    customerAuthUserId,
    items,
  });

  const stockReservationId = makeReservationId(
    customerAuthUserId,
    idempotencyKey
  );

  // 5. Dang ky yeu cau truoc khi Reserve
  const registration = await orderRequestRepository.register({
    idempotencyKey,
    customerAuthUserId,
    requestHash,
    stockReservationId,
  });

  if (!registration.created) {
    // Yeu cau trung Key: khong Reserve lan nua.
    // Neu truoc do da FAILED, cung khong xu ly lai tu dong.
    throw makeError(
      "Order request already registered; reconciliation or status check required",
      409,
      "ORDER_REQUEST_IN_PROGRESS"
    );
  }

  // 6. Reserve ton kho
  try {
    const reservation =
      await productReservationClient.reserveStock(
        stockReservationId,
        prepared.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        }))
      );

    if (!reservation || reservation.status !== "RESERVED") {
      throw makeError(
        "Unexpected reservation status",
        503,
        "STOCK_RECONCILIATION_REQUIRED"
      );
    }
  } catch (error) {
    // Product Service xac nhan chac chan khong du hang.
    if (isInsufficientStock(error)) {
      try {
        // Khong co Order va chua Reserve thanh cong.
        // Chuyen Request sang FAILED.
        await orderRequestRepository.markFailed(
          idempotencyKey
        );
      } catch (markError) {
        // Neu khong luu duoc FAILED thi khong tra 409,
        // vi trang thai Request chua duoc ghi nhan an toan.
        await requireReconciliation(
          idempotencyKey,
          markError
        );
      }

      // Tra ve dung loi nghiep vu.
      throw makeError(
        "Product unavailable or insufficient stock",
        409,
        "INSUFFICIENT_STOCK"
      );
    }

    // Timeout, mat ket noi, loi khong ro ket qua,
    // hoac Reservation tra trang thai bat thuong.
    await requireReconciliation(
      idempotencyKey,
      error
    );
  }

  let order;

  // 7. Tao Order, Details va Outbox trong PostgreSQL
  try {
    order = await orderRepository.createOrder({
      idempotencyKey,
      stockReservationId,
      requestHash,
      customerAuthUserId,
      subtotal: prepared.subtotal,
      discountPercent: prepared.discountPercent,
      discountAmount: prepared.discountAmount,
      totalAmount: prepared.totalAmount,
      items: prepared.items,
    });
  } catch (error) {
    // COMMIT co the da thanh cong du request nhan loi.
    // Khong tu dong Release ton kho.
    let existing;

    try {
      existing =
        await orderRepository.findByIdempotencyKey(
          idempotencyKey
        );
    } catch (lookupError) {
      await requireReconciliation(
        idempotencyKey,
        lookupError
      );
    }

    if (!existing) {
      await requireReconciliation(
        idempotencyKey,
        error
      );
    }

    // Khong Confirm Order khong thuoc dung request.
    if (
      Number(existing.customer_auth_user_id) !==
        Number(customerAuthUserId) ||
      existing.request_hash !== requestHash ||
      existing.stock_reservation_id !== stockReservationId
    ) {
      await requireReconciliation(
        idempotencyKey,
        makeError(
          "Existing Order conflicts with this request",
          409,
          "IDEMPOTENCY_KEY_CONFLICT"
        )
      );
    }

    order = existing;
  }

  // 8. Gan Order vao Request
  try {
    await orderRequestRepository.attachOrder(
      idempotencyKey,
      order.order_id
    );
  } catch (error) {
    await requireReconciliation(idempotencyKey, error);
  }

  // 9. Confirm Reservation
  if (order.status === "AWAITING_STOCK_CONFIRMATION") {
    try {
      await productReservationClient.confirmStock(
        stockReservationId,
        String(order.order_id)
      );

      // 10. Cap nhat Order va Outbox trong cung transaction
      await orderRepository.confirmOrderStock(order.order_id);
    } catch (error) {
      // Co the Confirm thanh cong nhung mat phan hoi.
      await requireReconciliation(idempotencyKey, error);
    }
  } else if (order.status !== "PENDING_SHIPMENT") {
    await requireReconciliation(
      idempotencyKey,
      makeError(
        "Order status requires reconciliation",
        503,
        "ORDER_RECONCILIATION_REQUIRED"
      )
    );
  }

  // 11. Danh dau COMPLETED
  try {
    await orderRequestRepository.markCompleted(
      idempotencyKey,
      order.order_id
    );
  } catch (error) {
    // Order co the da Confirm thanh cong.
    // Khong Release va khong tao Order moi.
    await requireReconciliation(idempotencyKey, error);
  }

  // 12. Tra ve Order moi nhat
  return orderRepository.findById(order.order_id);
}
