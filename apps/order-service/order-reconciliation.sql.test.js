import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { pool } from "./src/infrastructure/database.js";
import { orderRequestRepository } from "./src/infrastructure/repositories/order-request.repository.js";

const suffix = randomUUID().replaceAll("-", "");
const key = `RECOVERY_SQL_${suffix}`;
const reservationId = `RECOVERY_RES_${suffix}`;
const requestHash = "a".repeat(64);

let orderId = null;
let passed = 0;

try {
  // 1. Dang ky Request
  const registration = await orderRequestRepository.register({
    idempotencyKey: key,
    customerAuthUserId: 1,
    requestHash,
    stockReservationId: reservationId,
  });

  assert.equal(registration.created, true);
  console.log("PASS: Register request");
  passed++;

  // 2. Danh dau can doi soat
  const marked =
    await orderRequestRepository.markReconciliationRequired(key);

  assert.equal(marked.status, "RECONCILIATION_REQUIRED");
  console.log("PASS: Mark reconciliation required");
  passed++;

  // 3. Tao Order gia lap trong PostgreSQL
  // Khong tao Reservation MongoDB
  const result = await pool.query(
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

  orderId = result.rows[0].order_id;

  // 4. Gan Order sau doi soat
  const attached = await orderRequestRepository.attachOrder(
    key,
    orderId
  );

  assert.equal(String(attached.order_id), String(orderId));
  console.log("PASS: Attach Order after reconciliation");
  passed++;

  // 5. Chuyen sang COMPLETED
  // Chi la kiem thu SQL, khong xac nhan Reservation that
  const completed = await orderRequestRepository.markCompleted(
    key,
    orderId
  );

  assert.equal(completed.status, "COMPLETED");
  console.log("PASS: Complete reconciled request");
  passed++;

  // 6. Goi lai phai an toan
  const repeated = await orderRequestRepository.markCompleted(
    key,
    orderId
  );

  assert.equal(repeated.status, "COMPLETED");
  console.log("PASS: Idempotent completion");
  passed++;

  console.log(`RESULT: ${passed}/5 PASS`);
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  try {
    await pool.query(
      "DELETE FROM order_requests WHERE idempotency_key = $1",
      [key]
    );

    if (orderId !== null) {
      await pool.query(
        "DELETE FROM orders WHERE order_id = $1",
        [orderId]
      );
    }

    console.log("Test data cleaned up");
  } catch (error) {
    console.error("CLEANUP FAILED:", error.message);
    console.error("Test key:", key);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
