import assert from "node:assert/strict";
import { mock } from "node:test";

import { recoverOrder } from "./src/application/use-cases/recover-order.use-case.js";
import { productReservationClient } from "./src/infrastructure/clients/product-reservation.client.js";
import { orderRepository } from "./src/infrastructure/repositories/order.repository.js";

const baseOrder = {
  order_id: "101",
  status: "AWAITING_STOCK_CONFIRMATION",
  stock_reservation_id: "TEST_RES_101",
  items: [
    {
      product_id: "6ace8d5dc8c1450fa32654a1",
      quantity: 2,
    },
  ],
};

const baseReservation = {
  reservationId: "TEST_RES_101",
  status: "RESERVED",
  orderReference: null,
  items: [
    {
      productId: "6ace8d5dc8c1450fa32654a1",
      quantity: 2,
    },
  ],
};

let passed = 0;
let failed = 0;

async function runTest(name, testFunction) {
  mock.restoreAll();

  try {
    await testFunction();
    console.log("PASS:", name);
    passed++;
  } catch (error) {
    console.error("FAIL:", name, "-", error.message);
    failed++;
  } finally {
    mock.restoreAll();
  }
}

function setup(orderChanges = {}, reservationChanges = {}) {
  const order = {
    ...baseOrder,
    ...orderChanges,
  };

  const reservation = {
    ...baseReservation,
    ...reservationChanges,
  };

  const findById = mock.method(
    orderRepository,
    "findById",
    async () => order
  );

  const getReservation = mock.method(
    productReservationClient,
    "getReservation",
    async () => reservation
  );

  const confirmStock = mock.method(
    productReservationClient,
    "confirmStock",
    async () => ({
      ...reservation,
      status: "CONFIRMED",
      orderReference: String(order.order_id),
    })
  );

  const confirmOrderStock = mock.method(
    orderRepository,
    "confirmOrderStock",
    async () => ({
      orderId: String(order.order_id),
      status: "PENDING_SHIPMENT",
      outboxStatus: "PENDING",
    })
  );

  return {
    order,
    reservation,
    findById,
    getReservation,
    confirmStock,
    confirmOrderStock,
  };
}

// TEST 1: RESERVED -> CONFIRMED
await runTest("RESERVED can recover successfully", async () => {
  const ctx = setup();

  await recoverOrder("101");

  assert.equal(ctx.confirmStock.mock.callCount(), 1);
  assert.equal(ctx.confirmOrderStock.mock.callCount(), 1);

  assert.deepEqual(
    ctx.confirmStock.mock.calls[0].arguments,
    ["TEST_RES_101", "101"]
  );
});

// TEST 2: Already CONFIRMED for same Order
await runTest("CONFIRMED reservation completes Order", async () => {
  const ctx = setup({}, {
    status: "CONFIRMED",
    orderReference: "101",
  });

  await recoverOrder("101");

  assert.equal(ctx.confirmStock.mock.callCount(), 0);
  assert.equal(ctx.confirmOrderStock.mock.callCount(), 1);
});

// TEST 3: RELEASED cannot confirm
await runTest("RELEASED reservation is rejected", async () => {
  const ctx = setup({}, {
    status: "RELEASED",
  });

  await assert.rejects(
    recoverOrder("101"),
    { code: "RESERVATION_CONFLICT" }
  );

  assert.equal(ctx.confirmStock.mock.callCount(), 0);
  assert.equal(ctx.confirmOrderStock.mock.callCount(), 0);
});

// TEST 4: Wrong orderReference
await runTest("Wrong orderReference is rejected", async () => {
  const ctx = setup({}, {
    status: "CONFIRMED",
    orderReference: "999",
  });

  await assert.rejects(
    recoverOrder("101"),
    { code: "RESERVATION_CONFLICT" }
  );

  assert.equal(ctx.confirmOrderStock.mock.callCount(), 0);
});

// TEST 5: Product mismatch
await runTest("Different products are rejected", async () => {
  const ctx = setup({}, {
    items: [
      {
        productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        quantity: 2,
      },
    ],
  });

  await assert.rejects(
    recoverOrder("101"),
    { code: "RESERVATION_CONFLICT" }
  );

  assert.equal(ctx.confirmStock.mock.callCount(), 0);
});

// TEST 6: Product Service unavailable
await runTest("Product Service error requires reconciliation", async () => {
  const ctx = setup();

  ctx.getReservation.mock.mockImplementation(async () => {
    const error = new Error("Connection timed out");
    error.code = "PRODUCT_SERVICE_TIMEOUT";
    throw error;
  });

  await assert.rejects(
    recoverOrder("101"),
    { code: "STOCK_RECONCILIATION_REQUIRED" }
  );

  assert.equal(ctx.confirmOrderStock.mock.callCount(), 0);
});

console.log("");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed === 0) {
  console.log("ALL MOCK TESTS PASSED");
} else {
  process.exitCode = 1;
}
