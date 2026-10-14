
import { pool } from "../database.js";

function makeError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export const orderRequestRepository = {
  // 1. Dang ky yeu cau truoc khi Reserve ton kho
  // Primary Key dam bao chi mot INSERT thanh cong
  async register({
    idempotencyKey,
    customerAuthUserId,
    requestHash,
    stockReservationId,
  }) {
    if (
      typeof idempotencyKey !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(idempotencyKey) ||
      !Number.isSafeInteger(Number(customerAuthUserId)) ||
      Number(customerAuthUserId) <= 0 ||
      typeof requestHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(requestHash) ||
      typeof stockReservationId !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(stockReservationId)
    ) {
      throw makeError(
        "Invalid order request",
        400,
        "INVALID_ORDER_REQUEST"
      );
    }

    const result = await pool.query(
      `INSERT INTO order_requests (
         idempotency_key,
         customer_auth_user_id,
         request_hash,
         stock_reservation_id,
         status
       )
       VALUES ($1, $2, $3, $4, 'PROCESSING')
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        idempotencyKey,
        customerAuthUserId,
        requestHash,
        stockReservationId,
      ]
    );

    if (result.rowCount === 1) {
      return {
        created: true,
        request: result.rows[0],
      };
    }

    const existing = await pool.query(
      `SELECT *
       FROM order_requests
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (existing.rowCount !== 1) {
      throw makeError(
        "Order request conflict requires reconciliation",
        409,
        "ORDER_REQUEST_CONFLICT"
      );
    }

    const request = existing.rows[0];

    // Cung key nhung khac khach hang, gio hang hoac Reservation
    if (
      Number(request.customer_auth_user_id) !==
        Number(customerAuthUserId) ||
      request.request_hash !== requestHash ||
      request.stock_reservation_id !== stockReservationId
    ) {
      throw makeError(
        "Idempotency key already used for a different request",
        409,
        "IDEMPOTENCY_KEY_CONFLICT"
      );
    }

    return {
      created: false,
      request,
    };
  },

  // 2. Tim Order Request bang Idempotency Key
  async findByKey(idempotencyKey) {
    const result = await pool.query(
      `SELECT *
       FROM order_requests
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    return result.rows[0] ?? null;
  },

  // 3. Gan Order vao Request sau khi da xac minh du lieu
  // PROCESSING va RECONCILIATION_REQUIRED:
  //   cho phep gan Order neu chua gan hoac trung ID
  // COMPLETED:
  //   chi cho phep goi lai voi dung Order ID da luu
  async attachOrder(idempotencyKey, orderId) {
    const result = await pool.query(
      `UPDATE order_requests
       SET order_id = $2,
           updated_at = NOW()
       WHERE idempotency_key = $1
         AND (
           (
             status IN (
               'PROCESSING',
               'RECONCILIATION_REQUIRED'
             )
             AND (order_id IS NULL OR order_id = $2)
           )
           OR
           (
             status = 'COMPLETED'
             AND order_id = $2
           )
         )
       RETURNING *`,
      [idempotencyKey, orderId]
    );

    if (result.rowCount !== 1) {
      throw makeError(
        "Cannot attach Order to request",
        409,
        "ORDER_REQUEST_CONFLICT"
      );
    }

    return result.rows[0];
  },

  // 4. Danh dau COMPLETED sau khi Order va Reservation da Confirm
  // Cho phep goi lai neu da COMPLETED voi dung Order ID
  async markCompleted(idempotencyKey, orderId) {
    const result = await pool.query(
      `UPDATE order_requests
       SET status = 'COMPLETED',
           updated_at = NOW()
       WHERE idempotency_key = $1
         AND order_id = $2
         AND status IN (
           'PROCESSING',
           'RECONCILIATION_REQUIRED',
           'COMPLETED'
         )
       RETURNING *`,
      [idempotencyKey, orderId]
    );

    if (result.rowCount !== 1) {
      throw makeError(
        "Cannot complete order request",
        409,
        "ORDER_REQUEST_CONFLICT"
      );
    }

    return result.rows[0];
  },

  // 5. Danh dau FAILED khi chac chan khong du ton kho
  // Khong ghi de Request da COMPLETED hoac da co Order
  async markFailed(idempotencyKey) {
    const result = await pool.query(
      `UPDATE order_requests
       SET status = 'FAILED',
           updated_at = NOW()
       WHERE idempotency_key = $1
         AND status = 'PROCESSING'
         AND order_id IS NULL
       RETURNING *`,
      [idempotencyKey]
    );

    if (result.rowCount !== 1) {
      throw makeError(
        "Cannot mark order request as failed",
        409,
        "ORDER_REQUEST_CONFLICT"
      );
    }

    return result.rows[0];
  },

  // 6. Danh dau yeu cau can doi soat khi ket qua xu ly khong chac chan
  // Khong ghi de Request da COMPLETED hoac FAILED
  async markReconciliationRequired(idempotencyKey) {
    const result = await pool.query(
      `UPDATE order_requests
       SET status = 'RECONCILIATION_REQUIRED',
           updated_at = NOW()
       WHERE idempotency_key = $1
         AND status IN (
           'PROCESSING',
           'RECONCILIATION_REQUIRED'
         )
       RETURNING *`,
      [idempotencyKey]
    );

    if (result.rowCount !== 1) {
      throw makeError(
        "Cannot mark order request for reconciliation",
        409,
        "ORDER_REQUEST_CONFLICT"
      );
    }

    return result.rows[0];
  },
};
