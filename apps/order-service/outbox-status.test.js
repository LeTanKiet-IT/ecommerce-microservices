import { randomUUID } from "node:crypto";
import { pool } from "./src/infrastructure/database.js";
import { orderRepository } from "./src/infrastructure/repositories/order.repository.js";

let orderId = null;
let failed = false;

function check(condition, description) {
  if (!condition) {
    failed = true;
    console.error("FAIL:", description);
  } else {
    console.log("PASS:", description);
  }
}

try {
  const order = await orderRepository.createOrder({
    customerAuthUserId: 1,
    subtotal: 200000,
    discountPercent: 5,
    discountAmount: 10000,
    totalAmount: 190000,
    items: [{
      productId: "TEST_" + randomUUID(),
      productSku: "TEST_" + randomUUID().replaceAll("-", ""),
      productName: "Outbox Status Test",
      unitPrice: 100000,
      quantity: 2,
      lineTotal: 200000
    }]
  });

  orderId = order.order_id;

  const before = await pool.query(
    `SELECT status FROM outbox_events
     WHERE aggregate_type = 'Order'
       AND aggregate_id = $1
       AND event_type = 'OrderCreated'`,
    [String(orderId)]
  );

  check(
    before.rowCount === 1 &&
    before.rows[0].status === "WAITING_CONFIRMATION",
    "TEST 1: Outbox initially WAITING_CONFIRMATION"
  );

  if (before.rowCount !== 1 ||
      before.rows[0].status !== "WAITING_CONFIRMATION") {
    throw new Error("Unexpected initial Outbox status");
  }

  const updated = await orderRepository.markOutboxPending(orderId);

  check(
    updated.status === "PENDING",
    "TEST 2: WAITING_CONFIRMATION -> PENDING"
  );

  const repeated = await orderRepository.markOutboxPending(orderId);

  check(
    repeated.status === "PENDING",
    "TEST 3: Repeated transition remains PENDING"
  );

  const finalResult = await pool.query(
    `SELECT status FROM outbox_events
     WHERE aggregate_type = 'Order'
       AND aggregate_id = $1`,
    [String(orderId)]
  );

  check(
    finalResult.rowCount === 1 &&
    finalResult.rows[0].status === "PENDING",
    "TEST 4: PostgreSQL saved PENDING status"
  );

} catch (error) {
  console.error("TEST ERROR:", error.message);
  failed = true;
} finally {
  if (orderId !== null) {
    let client;

    try {
      client = await pool.connect();
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM outbox_events
         WHERE aggregate_type = 'Order'
           AND aggregate_id = $1`,
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
      if (client) {
        await client.query("ROLLBACK").catch(() => {});
      }
      console.error("CLEANUP ERROR:", error.message);
      failed = true;
    } finally {
      client?.release();
    }
  }

  await pool.end();
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("ALL TESTS PASSED");
}
