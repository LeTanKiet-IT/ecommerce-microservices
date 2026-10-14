import { randomUUID } from "node:crypto";
import { pool } from "./src/infrastructure/database.js";
import { orderRepository } from "./src/infrastructure/repositories/order.repository.js";

const testSku = "TEST_" + randomUUID().replaceAll("-", "");
let orderId = null;
let passed = false;

try {
  const order = await orderRepository.createOrder({
    customerAuthUserId: 1,
    subtotal: 200000,
    discountPercent: 10,
    discountAmount: 20000,
    totalAmount: 180000,
    items: [
      {
        productId: "TEST_PRODUCT_" + randomUUID(),
        productSku: testSku,
        productName: "Order Transaction Test",
        unitPrice: 100000,
        quantity: 2,
        lineTotal: 200000
      }
    ]
  });

  orderId = order.order_id;

  const ordersResult = await pool.query(
    "SELECT * FROM orders WHERE order_id = $1",
    [orderId]
  );

  const detailsResult = await pool.query(
    "SELECT * FROM order_details WHERE order_id = $1",
    [orderId]
  );

  const outboxResult = await pool.query(
    `SELECT * FROM outbox_events
     WHERE aggregate_type = 'Order'
       AND aggregate_id = $1
       AND event_type = 'OrderCreated'`,
    [String(orderId)]
  );

  const valid =
    ordersResult.rowCount === 1 &&
    detailsResult.rowCount === 1 &&
    outboxResult.rowCount === 1 &&
    outboxResult.rows[0].status === "PENDING" &&
    outboxResult.rows[0].payload.orderId === String(orderId) &&
    Number(ordersResult.rows[0].total_amount) === 180000;

  if (!valid) {
    throw new Error(
      "Order, Order Details or Outbox data is incorrect"
    );
  }

  console.log("PASS: Order inserted");
  console.log("PASS: Order Details inserted");
  console.log("PASS: Outbox Event inserted");
  console.log("PASS: Total amount = 180000");
  console.log("PASS: Outbox status = PENDING");

  passed = true;
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  // Dọn đúng dữ liệu của đơn hàng kiểm thử.
  if (orderId !== null) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM outbox_events
         WHERE aggregate_type = 'Order'
           AND aggregate_id = $1
           AND event_type = 'OrderCreated'`,
        [String(orderId)]
      );

      await client.query(
        "DELETE FROM order_details WHERE order_id = $1",
        [orderId]
      );

      await client.query(
        "DELETE FROM orders WHERE order_id = $1",
        [orderId]
      );

      await client.query("COMMIT");
      console.log("Test data cleaned up");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("CLEANUP FAILED:", error.message);
      process.exitCode = 1;
    } finally {
      client.release();
    }
  }

  await pool.end();
}

if (passed && process.exitCode !== 1) {
  console.log("ALL TESTS PASSED");
}
