import assert from "node:assert/strict";
import { mock } from "node:test";

import { placeOrder } from "./src/application/use-cases/place-order.use-case.js";
import { createRequestHash } from "./src/application/use-cases/request-hash.js";
import { orderRepository } from "./src/infrastructure/repositories/order.repository.js";
import { productReservationClient } from "./src/infrastructure/clients/product-reservation.client.js";

const productId = "6ace8d5dc8c1450fa32654a1";
const idempotencyKey = "MOCK_ORDER_001";

const originalItems = [
  { productId, quantity: 2 },
];

const requestHash = createRequestHash({
  customerAuthUserId: 1,
  items: originalItems,
});

const existingOrder = {
  order_id: "101",
  customer_auth_user_id: 1,
  idempotency_key: idempotencyKey,
  request_hash: requestHash,
  status: "PENDING_SHIPMENT",
  items: [],
};

let passed = 0;
let failed = 0;

async function runTest(name, callback) {
  mock.restoreAll();

  try {
    await callback();
    console.log("PASS:", name);
    passed++;
  } catch (error) {
    console.error("FAIL:", name, error.message);
    failed++;
  } finally {
    mock.restoreAll();
  }
}

function setup(order = existingOrder) {
  const find = mock.method(
    orderRepository,
    "findByIdempotencyKey",
    async () => order
  );

  // Nếu logic sai và gọi Reserve, bài test phải thất bại.
  const reserve = mock.method(
    productReservationClient,
    "reserveStock",
    async () => {
      throw new Error("Reserve must not be called");
    }
  );

  return { find, reserve };
}

// TEST 1: Cung key, cung gio hang
await runTest("Same key and cart return existing Order", async () => {
  const ctx = setup();

  const result = await placeOrder({
    idempotencyKey,
    customerAuthUserId: 1,
    items: originalItems,
  });

  assert.equal(result.order_id, "101");
  assert.equal(ctx.reserve.mock.callCount(), 0);
});

// TEST 2: Cung key nhung thay doi so luong
await runTest("Different quantity is rejected", async () => {
  const ctx = setup();

  await assert.rejects(
    placeOrder({
      idempotencyKey,
      customerAuthUserId: 1,
      items: [{ productId, quantity: 5 }],
    }),
    { code: "IDEMPOTENCY_KEY_CONFLICT", status: 409 }
  );

  assert.equal(ctx.reserve.mock.callCount(), 0);
});

// TEST 3: Cung key nhung khac khach hang
await runTest("Different customer is rejected", async () => {
  const ctx = setup();

  await assert.rejects(
    placeOrder({
      idempotencyKey,
      customerAuthUserId: 2,
      items: originalItems,
    }),
    { code: "IDEMPOTENCY_KEY_CONFLICT", status: 409 }
  );

  assert.equal(ctx.reserve.mock.callCount(), 0);
});

// TEST 4: Don hang dang cho xac nhan
await runTest("Pending Order requires reconciliation", async () => {
  const ctx = setup({
    ...existingOrder,
    status: "AWAITING_STOCK_CONFIRMATION",
  });

  await assert.rejects(
    placeOrder({
      idempotencyKey,
      customerAuthUserId: 1,
      items: originalItems,
    }),
    {
      code: "STOCK_RECONCILIATION_REQUIRED",
      status: 503,
    }
  );

  assert.equal(ctx.reserve.mock.callCount(), 0);
});

console.log("");
console.log("Passed:", passed);
console.log("Failed:", failed);

if (failed === 0) {
  console.log("ALL MOCK TESTS PASSED");
} else {
  process.exitCode = 1;
}
