import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { pool } from "./src/infrastructure/database.js";
import { orderRequestRepository } from "./src/infrastructure/repositories/order-request.repository.js";
import { createRequestHash } from "./src/application/use-cases/request-hash.js";

const testId = randomUUID().replaceAll("-", "");

const idempotencyKey = `CONCURRENT_${testId}`;
const stockReservationId = `CONCURRENT_RES_${testId}`;
const productId = "6ace8d5dc8c1450fa32654a1";

const requestHash = createRequestHash({
  customerAuthUserId: 1,
  items: [{ productId, quantity: 2 }],
});

const payload = {
  idempotencyKey,
  stockReservationId,
  requestHash,
  customerAuthUserId: 1,
};

let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log("PASS:", message);
    passed++;
  } else {
    console.error("FAIL:", message);
    failed++;
  }
}

try {
  // TEST 1: Hai request dong thoi, cung key
  const results = await Promise.all([
    orderRequestRepository.register(payload),
    orderRequestRepository.register(payload),
  ]);

  const createdCount = results.filter(
    (result) => result.created === true
  ).length;

  const existingCount = results.filter(
    (result) => result.created === false
  ).length;

  check(
    createdCount === 1 && existingCount === 1,
    "Only one concurrent request is registered"
  );

  // TEST 2: Database chi co mot dong
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM order_requests
     WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  check(
    countResult.rows[0].total === 1,
    "Only one row exists in PostgreSQL"
  );

  // TEST 3: Cung key va cung gio hang
  const repeated = await orderRequestRepository.register(payload);

  check(
    repeated.created === false &&
      repeated.request.request_hash === requestHash,
    "Repeated request returns existing registration"
  );

  // TEST 4: Cung key nhung khac gio hang
  const differentHash = createRequestHash({
    customerAuthUserId: 1,
    items: [{ productId, quantity: 5 }],
  });

  await assert.rejects(
    orderRequestRepository.register({
      ...payload,
      requestHash: differentHash,
    }),
    { code: "IDEMPOTENCY_KEY_CONFLICT", status: 409 }
  );

  check(true, "Different cart with same key is rejected");

  // TEST 5: Cung key nhung khac khach hang
  await assert.rejects(
    orderRequestRepository.register({
      ...payload,
      customerAuthUserId: 2,
    }),
    { code: "IDEMPOTENCY_KEY_CONFLICT", status: 409 }
  );

  check(true, "Different customer with same key is rejected");

  // TEST 6: Tim lai request
  const found = await orderRequestRepository.findByKey(
    idempotencyKey
  );

  check(
    found !== null &&
      found.status === "PROCESSING" &&
      found.stock_reservation_id === stockReservationId,
    "Request can be retrieved by key"
  );

} catch (error) {
  console.error("TEST ERROR:", error.message);
  failed++;
} finally {
  // Chi xoa ban ghi do bai test nay tao
  try {
    await pool.query(
      `DELETE FROM order_requests
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    console.log("Test data cleaned up");
  } catch (error) {
    console.error("CLEANUP ERROR:", error.message);
    console.error("CHECK KEY:", idempotencyKey);
    failed++;
  } finally {
    await pool.end();
  }
}

console.log("");
console.log("Passed:", passed);
console.log("Failed:", failed);

if (failed === 0 && passed === 6) {
  console.log("ALL TESTS PASSED");
} else {
  process.exitCode = 1;
}
