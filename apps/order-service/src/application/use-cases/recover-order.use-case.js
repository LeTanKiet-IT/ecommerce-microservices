import { productReservationClient } from "../../infrastructure/clients/product-reservation.client.js";
import { orderRepository } from "../../infrastructure/repositories/order.repository.js";

function reconciliationError(message) {
  const error = new Error(message);
  error.status = 503;
  error.code = "STOCK_RECONCILIATION_REQUIRED";
  return error;
}

function conflictError(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = "RESERVATION_CONFLICT";
  return error;
}

function sameItems(orderItems, reservationItems) {
  const normalize = (items) =>
    items.map((item) => ({
      productId: String(
        item.productId ?? item.product_id
      ).toLowerCase(),
      quantity: Number(item.quantity),
    })).sort((a, b) =>
      a.productId.localeCompare(b.productId)
    );

  return JSON.stringify(normalize(orderItems)) ===
    JSON.stringify(normalize(reservationItems));
}

export async function recoverOrder(orderId) {
  // 1. Tim Order trong PostgreSQL
  const order = await orderRepository.findById(orderId);

  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    error.code = "ORDER_NOT_FOUND";
    throw error;
  }

  if (!order.stock_reservation_id) {
    throw reconciliationError(
      "Order has no stock reservation ID"
    );
  }

  // 2. Tra cuu Reservation trong MongoDB
  let reservation;

  try {
    reservation = await productReservationClient.getReservation(
      order.stock_reservation_id
    );
  } catch (error) {
    throw reconciliationError(
      `Cannot verify stock reservation: ${error.code || error.message}`
    );
  }

  // 3. Kiem tra thong tin Reservation
  if (
    reservation.reservationId !== order.stock_reservation_id ||
    !sameItems(order.items, reservation.items)
  ) {
    throw conflictError(
      "Order and Reservation items do not match"
    );
  }

  // 4. Reservation da RELEASED
  if (reservation.status === "RELEASED") {
    throw conflictError(
      "Reservation already released; Order cannot be confirmed"
    );
  }

  // 5. Order da hoan tat xac nhan
  if (order.status === "PENDING_SHIPMENT") {
    if (
      reservation.status !== "CONFIRMED" ||
      reservation.orderReference !== String(order.order_id)
    ) {
      throw reconciliationError(
        "Order and Reservation confirmation mismatch"
      );
    }

    return order;
  }

  // 6. Chi phuc hoi Order dang cho Confirm
  if (order.status !== "AWAITING_STOCK_CONFIRMATION") {
    throw conflictError(
      "Order status does not allow stock confirmation"
    );
  }

  // 7. Reservation da CONFIRMED
  if (reservation.status === "CONFIRMED") {
    if (reservation.orderReference !== String(order.order_id)) {
      throw conflictError(
        "Reservation belongs to another Order"
      );
    }
  } else if (reservation.status === "RESERVED") {
    // Thu Confirm voi Order Reference co dinh
    try {
      await productReservationClient.confirmStock(
        order.stock_reservation_id,
        String(order.order_id)
      );
    } catch (error) {
      throw reconciliationError(
        `Stock confirmation uncertain: ${error.code || error.message}`
      );
    }
  } else {
    throw reconciliationError(
      "Unknown Reservation status"
    );
  }

  // 8. Cap nhat Order va Outbox trong cung PostgreSQL Transaction
  await orderRepository.confirmOrderStock(order.order_id);

  // 9. Lay ket qua moi nhat
  return orderRepository.findById(order.order_id);
}
