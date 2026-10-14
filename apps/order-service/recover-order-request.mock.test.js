import assert from "node:assert/strict";
import { mock } from "node:test";

import { recoverOrderRequest } from "./src/application/use-cases/recover-order-request.use-case.js";
import { orderRequestRepository } from "./src/infrastructure/repositories/order-request.repository.js";
import { orderRepository } from "./src/infrastructure/repositories/order.repository.js";
import { productReservationClient } from "./src/infrastructure/clients/product-reservation.client.js";

const key = "RECOVERY_MOCK_001";
const productId = "6ace8d5dc8c1450fa32654a1";
const reservationId = "ORDER_RES_MOCK_001";
const hash = "a".repeat(64);

let passed = 0;
let failed = 0;

function setup({
  hasOrder = true,
  requestStatus = "PROCESSING",
  orderStatus = "AWAITING_STOCK_CONFIRMATION",
  reservationStatus = "RESERVED",
  matchingItems = true,
  orderReference = "101",
  matchingHash = true,
} = {}) {
  const calls = [];
  let currentStatus = orderStatus;

  const request = {
    idempotency_key: key,
    customer_auth_user_id: 1,
    request_hash: hash,
    stock_reservation_id: reservationId,
    order_id: requestStatus === "COMPLETED" ? "101" : null,
    status: requestStatus,
  };

  function getOrder() {
    if (!hasOrder) return null;

    return {
      order_id: "101",
      customer_auth_user_id: 1,
      request_hash: matchingHash ? hash : "b".repeat(64),
      stock_reservation_id: reservationId,
      status: currentStatus,
      items: [{ product_id: productId, quantity: 2 }],
    };
  }

  mock.method(orderRequestRepository, "findByKey", async () => {
    calls.push("findByKey");
    return request;
  });

  mock.method(
    orderRepository,
    "findByIdempotencyKey",
    async () => {
      calls.push("findByIdempotencyKey");
      return getOrder();
    }
  );

  mock.method(orderRepository, "findById", async () => {
    calls.push("findById");
    return getOrder();
  });

  mock.method(
    productReservationClient,
    "getReservation",
    async () => {
      calls.push("getReservation");
      return {
        reservationId,
        status: reservationStatus,
        orderReference,
        items: [{
          productId,
          quantity: matchingItems ? 2 : 5,
        }],
      };
    }
  );

  mock.method(
    productReservationClient,
    "confirmStock",
    async () => {
      calls.push("confirmStock");
      return { status: "CONFIRMED" };
    }
  );

  mock.method(
    orderRepository,
    "confirmOrderStock",
    async () => {
      calls.push("confirmOrderStock");
      currentStatus = "PENDING_SHIPMENT";
    }
  );

  mock.method(
    orderRequestRepository,
    "attachOrder",
    async (_key, orderId) => {
      calls.push("attachOrder");
      assert.equal(String(orderId), "101");
      request.order_id = String(orderId);
      return request;
    }
  );

  mock.method(
    orderRequestRepository,
    "markCompleted",
    async (_key, orderId) => {
      calls.push("markCompleted");
      assert.equal(String(orderId), "101");
      request.status = "COMPLETED";
      return request;
    }
  );

  return calls;
}

async function runTest(name, fn) {
  mock.restoreAll();

  try {
    await fn();
    passed++;
    console.log("PASS:", name);
  } catch (error) {
    failed++;
    console.error("FAIL:", name);
    console.error(error);
  } finally {
    mock.restoreAll();
  }
}

// 1. Reservation RESERVED + Order dang cho
await runTest("Recover RESERVED Order", async () => {
  const calls = setup();

  const result = await recoverOrderRequest(key);

  assert.equal(result.action, "ORDER_RECOVERED");
  assert.equal(result.requestStatus, "COMPLETED");
  assert.equal(result.orderStatus, "PENDING_SHIPMENT");

  assert.deepEqual(calls, [
    "findByKey",
    "findByIdempotencyKey",
    "findById",
    "getReservation",
    "confirmStock",
    "confirmOrderStock",
    "findById",
    "attachOrder",
    "markCompleted",
  ]);
});

// 2. Order da PENDING_SHIPMENT, Reservation CONFIRMED
await runTest("Recover already confirmed Order", async () => {
  const calls = setup({
    requestStatus: "COMPLETED",
    orderStatus: "PENDING_SHIPMENT",
    reservationStatus: "CONFIRMED",
  });

  const result = await recoverOrderRequest(key);

  assert.equal(result.requestStatus, "COMPLETED");
  assert.equal(result.orderStatus, "PENDING_SHIPMENT");
  assert.equal(calls.includes("confirmStock"), false);
  assert.equal(calls.includes("confirmOrderStock"), false);
  assert.equal(calls.includes("markCompleted"), true);
});

// 3. Co Reservation nhung chua co Order
await runTest("Missing Order requires manual reconciliation", async () => {
  const calls = setup({ hasOrder: false });

  const result = await recoverOrderRequest(key);

  assert.equal(result.orderId, null);
  assert.equal(result.reservationStatus, "RESERVED");
  assert.equal(result.action, "MANUAL_RECONCILIATION_REQUIRED");
  assert.equal(calls.includes("confirmStock"), false);
  assert.equal(calls.includes("attachOrder"), false);
  assert.equal(calls.includes("markCompleted"), false);
});

// 4. Sai Request Hash
await runTest("Mismatched Order hash is rejected", async () => {
  const calls = setup({ matchingHash: false });

  await assert.rejects(
    recoverOrderRequest(key),
    { code: "ORDER_REQUEST_CONFLICT", status: 409 }
  );

  assert.equal(calls.includes("confirmStock"), false);
  assert.equal(calls.includes("attachOrder"), false);
});

// 5. Reservation khong khop so luong
await runTest("Mismatched Reservation items are rejected", async () => {
  const calls = setup({ matchingItems: false });

  await assert.rejects(
    recoverOrderRequest(key),
    { code: "RESERVATION_CONFLICT", status: 409 }
  );

  assert.equal(calls.includes("confirmStock"), false);
  assert.equal(calls.includes("markCompleted"), false);
});

// 6. Reservation da RELEASED
await runTest("Released Reservation cannot be recovered", async () => {
  const calls = setup({ reservationStatus: "RELEASED" });

  await assert.rejects(
    recoverOrderRequest(key),
    { code: "RESERVATION_CONFLICT", status: 409 }
  );

  assert.equal(calls.includes("confirmStock"), false);
  assert.equal(calls.includes("markCompleted"), false);
});

console.log("");
console.log("Passed:", passed);
console.log("Failed:", failed);

if (passed === 6 && failed === 0) {
  console.log("ALL RECOVERY MOCK TESTS PASSED");
} else {
  process.exitCode = 1;
}
