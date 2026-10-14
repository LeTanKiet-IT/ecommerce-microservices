
import { orderRequestRepository } from "../../infrastructure/repositories/order-request.repository.js";
import { orderRepository } from "../../infrastructure/repositories/order.repository.js";
import { productReservationClient } from "../../infrastructure/clients/product-reservation.client.js";
import { recoverOrder } from "./recover-order.use-case.js";

function makeError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export async function recoverOrderRequest(idempotencyKey) {
  // 1. Kiem tra key
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

  // 2. Tim yeu cau da dang ky
  const request = await orderRequestRepository.findByKey(
    idempotencyKey
  );

  if (!request) {
    throw makeError(
      "Order request not found",
      404,
      "ORDER_REQUEST_NOT_FOUND"
    );
  }

  // 3. Tim Order bang idempotency key
  // Khong chi dua vao request.order_id,
  // vi tien trinh co the dung truoc attachOrder()
  const order = await orderRepository.findByIdempotencyKey(
    idempotencyKey
  );

  // 4. Chua co Order trong PostgreSQL
  if (!order) {
    let reservation;

    try {
      reservation =
        await productReservationClient.getReservation(
          request.stock_reservation_id
        );
    } catch {
      // Khong the ket luan stock chua duoc giu
      // chi vi khong truy van duoc Product Service.
      throw makeError(
        "Cannot verify reservation; manual reconciliation required",
        503,
        "STOCK_RECONCILIATION_REQUIRED"
      );
    }

    if (
      reservation.reservationId !==
      request.stock_reservation_id
    ) {
      throw makeError(
        "Reservation ID mismatch",
        409,
        "RESERVATION_CONFLICT"
      );
    }

    // Chi quan sat, KHONG tu dong Release/Confirm.
    return {
      idempotencyKey,
      requestStatus: request.status,
      orderId: null,
      reservationStatus: reservation.status,
      action: "MANUAL_RECONCILIATION_REQUIRED",
    };
  }

  // 5. Kiem tra Order co thuoc dung request khong
  if (
    Number(order.customer_auth_user_id) !==
      Number(request.customer_auth_user_id) ||
    order.request_hash !== request.request_hash ||
    order.stock_reservation_id !==
      request.stock_reservation_id ||
    (
      request.order_id !== null &&
      String(request.order_id) !== String(order.order_id)
    )
  ) {
    throw makeError(
      "Order does not match registered request",
      409,
      "ORDER_REQUEST_CONFLICT"
    );
  }

  // 6. Phuc hoi Order va doi soat MongoDB
  // recoverOrder() se kiem tra Reservation va items
  const recoveredOrder = await recoverOrder(order.order_id);

  // 7. Gan Order voi request neu chua gan
  await orderRequestRepository.attachOrder(
    idempotencyKey,
    recoveredOrder.order_id
  );

  // 8. Danh dau COMPLETED khi Order da duoc xac nhan
  if (recoveredOrder.status === "PENDING_SHIPMENT") {
    await orderRequestRepository.markCompleted(
      idempotencyKey,
      recoveredOrder.order_id
    );
  }

  return {
    idempotencyKey,
    requestStatus:
      recoveredOrder.status === "PENDING_SHIPMENT"
        ? "COMPLETED"
        : request.status,
    orderId: recoveredOrder.order_id,
    orderStatus: recoveredOrder.status,
    action: "ORDER_RECOVERED",
  };
}
