import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { pool } from "./src/infrastructure/database.js";
import { orderRequestRepository } from "./src/infrastructure/repositories/order-request.repository.js";

const suffix = randomUUID().replaceAll("-", "");
const key = `REPO_TEST_${suffix}`;
const reservationId = `REPO_RES_${suffix}`;
const requestHash = "a".repeat(64);

let passed = 0;
let failed = 0;
const orderIds = [];

async function test(name, action) {
  try {
    await action();
    console.log("PASS:", name);
    passed++;
  } catch (error) {
    console.error("FAIL:", name, error.message);
    failed++;
  }
}

try {
  // Tao Order gia lap trong PostgreSQL
  const first = await pool.query(
    `INSERT INTO orders (
       customer_auth_user_id,
       idempotency_key,
       stock_reservation_id,
       request_hash,
       subtotal,
       total_amount
     )
     VALUES (1, $1, $2, $3, 100000, 100000)
     RETURNING order_id`,
    [key, reservationId, requestHash]
  );

  const orderId = first.rows[0].order_id;
  orderIds.push(orderId);

  // Tao mot Order thu hai de kiem tra xung dot
  const second = await pool.query(
    `INSERT INTO orders (
       customer_auth_user_id,
       subtotal,
       total_amount
     )
     VALUES (1, 100000, 100000)
     RETURNING order_id`
  );

  const otherOrderId = second.rows[0].order_id;
  orderIds.push(otherOrderId);

  await orderRequestRepository.register({
    idempotencyKey: key,
    customerAuthUserId: 1,
    requestHash,
    stockReservationId: reservationId,
  });

  // TEST 1
  await test("Attach Order to PROCESSING request", async () => {
    const result = await orderRequestRepository.attachOrder(
      key,
      orderId
    );
    assert.equal(String(result.order_id), String(orderId));
  });

  // TEST 2
  await test("Attach same Order again", async () => {
    const result = await orderRequestRepository.attachOrder(
      key,
      orderId
    );
    assert.equal(String(result.order_id), String(orderId));
  });

  // TEST 3
  await test("Reject different Order ID", async () => {
    await assert.rejects(
      orderRequestRepository.attachOrder(key, otherOrderId),
      { code: "ORDER_REQUEST_CONFLICT", status: 409 }
    );
  });

  // TEST 4
  await test("Mark request COMPLETED", async () => {
    const result = await orderRequestRepository.markCompleted(
      key,
      orderId
    );
    assert.equal(result.status, "COMPLETED");
  });

  // TEST 5
  await test("Completed request is idempotent", async () => {
    await orderRequestRepository.attachOrder(key, orderId);
    const result = await orderRequestRepository.markCompleted(
      key,
      orderId
    );
    assert.equal(result.status, "COMPLETED");
  });

  // TEST 6
  await test("COMPLETED cannot attach another Order", async () => {
    await assert.rejects(
      orderRequestRepository.attachOrder(key, otherOrderId),
      { code: "ORDER_REQUEST_CONFLICT", status: 409 }
    );
  });

} catch (error) {
  console.error("SETUP ERROR:", error.message);
  failed++;
} finally {
  // Chi xoa du lieu cua lan test nay
  try {
    await pool.query(
      `DELETE FROM order_requests
       WHERE idempotency_key = $1`,
      [key]
    );

    if (orderIds.length > 0) {
      await pool.query(
        `DELETE FROM orders
         WHERE order_id = ANY($1::bigint[])`,
        [orderIds]
      );
    }

    console.log("Test data cleaned up");
  } catch (error) {
    console.error("CLEANUP ERROR:", error.message);
    console.error("Test key:", key);
    console.error("Order IDs:", orderIds);
    failed++;
  } finally {
    await pool.end();
  }
}

console.log("");
console.log("Passed:", passed);
console.log("Failed:", failed);

if (passed === 6 && failed === 0) {
  console.log("ALL REPOSITORY TESTS PASSED");
} else {
  process.exitCode = 1;
}
