
import { randomUUID } from "node:crypto";
import { pool } from "../database.js";

export const orderRepository = {
  // 1. Tạo Order, Order Details và Outbox trong cùng Transaction
  async createOrder({
    idempotencyKey,
    stockReservationId,
    requestHash,
    customerAuthUserId,
    subtotal,
    discountPercent,
    discountAmount,
    totalAmount,
    items,
  }) {
    // Kiểm tra Idempotency Key
    if (
      typeof idempotencyKey !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(idempotencyKey)
    ) {
      const error = new Error("Invalid idempotency key");
      error.code = "INVALID_IDEMPOTENCY_KEY";
      error.status = 400;
      throw error;
    }

    // Kiểm tra Stock Reservation ID
    if (
      typeof stockReservationId !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(stockReservationId)
    ) {
      const error = new Error("Invalid stock reservation ID");
      error.code = "INVALID_RESERVATION_ID";
      error.status = 400;
      throw error;
    }

    // Kiểm tra Request Hash (SHA-256)
    if (
      typeof requestHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(requestHash)
    ) {
      const error = new Error("Invalid request hash");
      error.code = "INVALID_REQUEST_HASH";
      error.status = 400;
      throw error;
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 2. Lưu Order vào PostgreSQL
      const orderResult = await client.query(
        `INSERT INTO orders (
           idempotency_key,
           stock_reservation_id,
           request_hash,
           customer_auth_user_id,
           subtotal,
           discount_percent,
           discount_amount,
           total_amount
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          idempotencyKey,
          stockReservationId,
          requestHash,
          customerAuthUserId,
          subtotal,
          discountPercent,
          discountAmount,
          totalAmount,
        ]
      );

      const order = orderResult.rows[0];

      // 3. Lưu Order Details
      for (const item of items) {
        await client.query(
          `INSERT INTO order_details (
             order_id,
             product_id,
             product_sku,
             product_name,
             unit_price,
             quantity,
             line_total
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            order.order_id,
            item.productId,
            item.productSku,
            item.productName,
            item.unitPrice,
            item.quantity,
            item.lineTotal,
          ]
        );
      }

      // 4. Tạo Outbox Event
      const eventId = randomUUID();

      const eventPayload = {
        eventId,
        eventType: "OrderCreated",
        orderId: String(order.order_id),
        stockReservationId,
        customerAuthUserId: String(customerAuthUserId),
        totalAmount,
        currency: "VND",
        items: items.map((item) => ({
          productId: item.productId,
          productSku: item.productSku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      };

      // 5. Lưu Outbox với trạng thái WAITING_CONFIRMATION
      await client.query(
        `INSERT INTO outbox_events (
           event_id,
           aggregate_type,
           aggregate_id,
           event_type,
           payload,
           status
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          eventId,
          "Order",
          String(order.order_id),
          "OrderCreated",
          JSON.stringify(eventPayload),
          "WAITING_CONFIRMATION",
        ]
      );

      // 6. Lấy danh sách Order Details
      const detailsResult = await client.query(
        `SELECT
           order_detail_id,
           product_id,
           product_sku,
           product_name,
           unit_price,
           quantity,
           line_total
         FROM order_details
         WHERE order_id = $1
         ORDER BY order_detail_id`,
        [order.order_id]
      );

      // 7. Commit Transaction
      await client.query("COMMIT");

      return {
        ...order,
        items: detailsResult.rows,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  // 8. Xác nhận Order và Outbox trong cùng Transaction
  async confirmOrderStock(orderId) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        `UPDATE orders
         SET status = 'PENDING_SHIPMENT',
             updated_at = NOW()
         WHERE order_id = $1
           AND status = 'AWAITING_STOCK_CONFIRMATION'
         RETURNING order_id, status`,
        [orderId]
      );

      if (orderResult.rowCount !== 1) {
        const existing = await client.query(
          `SELECT status
           FROM orders
           WHERE order_id = $1`,
          [orderId]
        );

        if (existing.rowCount === 0) {
          throw new Error("Order not found");
        }

        if (existing.rows[0].status !== "PENDING_SHIPMENT") {
          throw new Error("Order cannot be confirmed");
        }

        const outbox = await client.query(
          `SELECT status
           FROM outbox_events
           WHERE aggregate_type = 'Order'
             AND aggregate_id = $1
             AND event_type = 'OrderCreated'`,
          [String(orderId)]
        );

        if (
          outbox.rowCount !== 1 ||
          !["PENDING", "PUBLISHED"].includes(outbox.rows[0].status)
        ) {
          throw new Error("Order and Outbox status mismatch");
        }

        await client.query("COMMIT");

        return {
          orderId: String(orderId),
          status: "PENDING_SHIPMENT",
          outboxStatus: outbox.rows[0].status,
        };
      }

      // Cập nhật Outbox cùng Transaction
      const outboxResult = await client.query(
        `UPDATE outbox_events
         SET status = 'PENDING'
         WHERE aggregate_type = 'Order'
           AND aggregate_id = $1
           AND event_type = 'OrderCreated'
           AND status = 'WAITING_CONFIRMATION'
         RETURNING event_id, status`,
        [String(orderId)]
      );

      if (outboxResult.rowCount !== 1) {
        throw new Error(
          "Outbox event not found or invalid status"
        );
      }

      await client.query("COMMIT");

      return {
        orderId: String(orderId),
        status: "PENDING_SHIPMENT",
        outboxStatus: "PENDING",
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  // 9. Chuyển Outbox sang PENDING
  async markOutboxPending(orderId) {
    const result = await pool.query(
      `UPDATE outbox_events
       SET status = 'PENDING'
       WHERE aggregate_type = 'Order'
         AND aggregate_id = $1
         AND event_type = 'OrderCreated'
         AND status = 'WAITING_CONFIRMATION'
       RETURNING event_id, status`,
      [String(orderId)]
    );

    if (result.rowCount === 1) {
      return result.rows[0];
    }

    const existing = await pool.query(
      `SELECT event_id, status
       FROM outbox_events
       WHERE aggregate_type = 'Order'
         AND aggregate_id = $1
         AND event_type = 'OrderCreated'`,
      [String(orderId)]
    );

    if (
      existing.rowCount === 1 &&
      ["PENDING", "PUBLISHED"].includes(existing.rows[0].status)
    ) {
      return existing.rows[0];
    }

    throw new Error(
      "Outbox event not found or cannot transition to PENDING"
    );
  },

  // 10. Tìm Order theo Idempotency Key
  async findByIdempotencyKey(idempotencyKey) {
    const result = await pool.query(
      `SELECT order_id
       FROM orders
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return this.findById(result.rows[0].order_id);
  },

  // 11. Tìm Order theo ID
  async findById(orderId) {
    const orderResult = await pool.query(
      `SELECT *
       FROM orders
       WHERE order_id = $1`,
      [orderId]
    );

    if (orderResult.rowCount === 0) {
      return null;
    }

    const detailsResult = await pool.query(
      `SELECT
         order_detail_id,
         product_id,
         product_sku,
         product_name,
         unit_price,
         quantity,
         line_total
       FROM order_details
       WHERE order_id = $1
       ORDER BY order_detail_id`,
      [orderId]
    );

    return {
      ...orderResult.rows[0],
      items: detailsResult.rows,
    };
  },

  // 12. Lấy danh sách Order theo khách hàng
  async findByCustomerAuthUserId(authUserId) {
    const result = await pool.query(
      `SELECT
         order_id,
         customer_auth_user_id,
         subtotal,
         discount_percent,
         discount_amount,
         total_amount,
         currency,
         status,
         shipment_reference,
         created_at,
         updated_at
       FROM orders
       WHERE customer_auth_user_id = $1
       ORDER BY created_at DESC`,
      [authUserId]
    );

    return result.rows;
  },
};
