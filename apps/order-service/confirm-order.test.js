import { randomUUID } from "node:crypto";
import { pool } from "./src/infrastructure/database.js";
import { orderRepository } from "./src/infrastructure/repositories/order.repository.js";

const idempotencyKey = `CONFIRM_${randomUUID().replaceAll("-", "")}`;

let orderId = null;
let failures = 0;

function check(condition, message) {
  if (condition) {
    console.log("PASS:", message);
  } else {
    console.error("FAIL:", message);
    failures++;
  }
}

try {
  // TEST 1: Tao Order va Outbox
  const order = await orderRepository.createOrder({
    idempotencyKey,
    customerAuthUserId: 1,
    subtotal: 200000,
    discountPercent: 5,
    discountAmount: 10000,
    totalAmount: 190000,
    items: [
      {
        productId: "TEST_PRODUCT_001",
        productSku: "TEST_CONFIRM_001",
        productName: "Confirm Order Test",
        unitPrice: 100000,
        quantity: 2,
        lineTotal: 200000
      }
    ]
  });

  orderId = order.order_id;

  check(
    order.status === "AWAITING_STOCK_CONFIRMATION",
    "TEST 1: Order initially AWAITING_STOCK_CONFIRMATION"
  );

  // TEST 2: Kiem tra Outbox ban dau
  const initialOutbox = await pool.query(
    `SELECT status FROM outbox_events
     WHERE aggregate_type = 'Order'
       AND aggregate_id = $1
       AND event_type = 'OrderCreated'`,
    [String(orderId)]
  );

  check(
    initialOutbox.rowCount === 1 &&
    initialOutbox.rows[0].status === "WAITING_CONFIRMATION",
    "TEST 2: Outbox initially WAITING_CONFIRMATION"
  );

  // TEST 3: Confirm Order
  const confirmed = await orderRepository.confirmOrderStock(orderId);

  check(
    confirmed.status === "PENDING_SHIPMENT" &&
    confirmed.outboxStatus === "PENDING",
    "TEST 3: Confirm Order and Outbox"
  );

  // TEST 4: Kiem tra du lieu duoc luu
  const savedOrder = await orderRepository.findById(orderId);

  const savedOutbox = await pool.query(
    `SELECT status FROM outbox_events
     WHERE aggregate_type = 'Order'
       AND aggregate_id = $1
       AND event_type = 'OrderCreated'`,
    [String(orderId)]
  );

  check(
    savedOrder.status === "PENDING_SHIPMENT" &&
    savedOutbox.rowCount === 1 &&
    savedOutbox.rows[0].status === "PENDING",
    "TEST 4: PostgreSQL saved both statuses"
  );

  // TEST 5: Goi Confirm lan hai
  const confirmedAgain =
    await orderRepository.confirmOrderStock(orderId);

  check(
    confirmedAgain.status === "PENDING_SHIPMENT" &&
    confirmedAgain.outboxStatus === "PENDING",
    "TEST 5: Repeated confirm is idempotent"
  );

  // TEST 6: Order khong ton tai
  try {
    await orderRepository.confirmOrderStock(-1);
    check(false, "TEST 6: Unknown order rejected");
  } catch (error) {
    check(
      error.message === "Order not found",
      "TEST 6: Unknown order rejected"
    );
  }

} catch (error) {
  console.error("TEST ERROR:", error.message);
  failures++;
} finally {
  // Xoa dung Order va Outbox thu nghiem
  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM outbox_events
       WHERE aggregate_type = 'Order'
         AND aggregate_id IN (
           SELECT order_id::text
           FROM orders
           WHERE idempotency_key = $1
         )`,
      [idempotencyKey]
    );

    await client.query(
      `DELETE FROM order_details
       WHERE order_id IN (
         SELECT order_id
         FROM orders
         WHERE idempotency_key = $1
       )`,
      [idempotencyKey]
    );

    await client.query(
      "DELETE FROM orders WHERE idempotency_key = $1",
      [idempotencyKey]
    );

    await client.query("COMMIT");
    console.log("Test data cleaned up");
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("CLEANUP ERROR:", error.message);
    failures++;
  } finally {
    client?.release();
    await pool.end();
  }
}

console.log("Failures:", failures);

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("ALL TESTS PASSED");
}
