
import assert from "node:assert/strict";
import { mock } from "node:test";

import { placeOrder } from "./src/application/use-cases/place-order.use-case.js";
import { createRequestHash } from "./src/application/use-cases/request-hash.js";
import { orderRepository } from "./src/infrastructure/repositories/order.repository.js";
import { orderRequestRepository } from "./src/infrastructure/repositories/order-request.repository.js";
import { productReservationClient } from "./src/infrastructure/clients/product-reservation.client.js";

const productId = "6ace8d5dc8c1450fa32654a1";

const payload = {
  idempotencyKey: "LIFECYCLE_MOCK_001",
  customerAuthUserId: 1,
  items: [{ productId, quantity: 2 }],
};

let passed = 0;
let failed = 0;

function setup({
  registrationCreated = true,
  confirmFails = false,
  existingOrder = null,
} = {}) {
  const calls = [];

  // Mock Customer Service va Product Service
  // Khong goi HTTP that
  mock.method(globalThis, "fetch", async (url) => {
    const address = String(url);

    if (address.includes("/api/customers/1")) {
      return Response.json({
        auth_user_id: 1,
        membership_tier: "TEST-SILVER",
        discount_percent: 5,
      });
    }

    if (address.includes(`/api/products/${productId}`)) {
      return Response.json({
        id: productId,
        sku: "TEST-P001",
        name: "Mock Product",
        price: 100000,
        status: "ACTIVE",
      });
    }

    throw new Error(`Unexpected fetch: ${address}`);
  });

  // Mock kiem tra Order da ton tai
  mock.method(
    orderRepository,
    "findByIdempotencyKey",
    async () => existingOrder
  );

  // Mock dang ky Order Request
  mock.method(
    orderRequestRepository,
    "register",
    async () => {
      calls.push("register");

      return {
        created: registrationCreated,
        request: { status: "PROCESSING" },
      };
    }
  );

  // Mock Reserve ton kho
  mock.method(
    productReservationClient,
    "reserveStock",
    async () => {
      calls.push("reserveStock");
      return { status: "RESERVED" };
    }
  );

  // Mock tao Order
  mock.method(orderRepository, "createOrder", async (data) => {
    calls.push("createOrder");

    assert.match(data.requestHash, /^[a-f0-9]{64}$/);

    return {
      order_id: "101",
      status: "AWAITING_STOCK_CONFIRMATION",
    };
  });

  // Mock gan Order voi Request
  mock.method(
    orderRequestRepository,
    "attachOrder",
    async () => {
      calls.push("attachOrder");

      return {
        order_id: "101",
        status: "PROCESSING",
      };
    }
  );

  // Mock Confirm ton kho
  mock.method(
    productReservationClient,
    "confirmStock",
    async () => {
      calls.push("confirmStock");

      if (confirmFails) {
        const error = new Error(
          "Mock Product Service timeout"
        );

        error.status = 503;
        error.code = "PRODUCT_SERVICE_TIMEOUT";

        throw error;
      }

      return { status: "CONFIRMED" };
    }
  );

  // Mock cap nhat Order va Outbox
  mock.method(
    orderRepository,
    "confirmOrderStock",
    async () => {
      calls.push("confirmOrderStock");

      return {
        status: "PENDING_SHIPMENT",
      };
    }
  );

  // Mock danh dau Request COMPLETED
  mock.method(
    orderRequestRepository,
    "markCompleted",
    async () => {
      calls.push("markCompleted");

      return {
        status: "COMPLETED",
      };
    }
  );

  // MOI: Mock danh dau Request can doi soat
  mock.method(
    orderRequestRepository,
    "markReconciliationRequired",
    async () => {
      calls.push("markReconciliationRequired");

      return {
        status: "RECONCILIATION_REQUIRED",
      };
    }
  );

  // Mock lay Order sau khi xu ly
  mock.method(orderRepository, "findById", async () => ({
    order_id: "101",
    status: "PENDING_SHIPMENT",
  }));

  return calls;
}

async function runTest(name, fn) {
  mock.restoreAll();

  try {
    await fn();

    console.log("PASS:", name);
    passed++;
  } catch (error) {
    console.error("FAIL:", name);
    console.error(error);
    failed++;
  } finally {
    mock.restoreAll();
  }
}

// TEST 1: Luong dat hang thanh cong
await runTest("Full Order lifecycle", async () => {
  const calls = setup();

  const result = await placeOrder(payload);

  assert.equal(result.order_id, "101");
  assert.equal(result.status, "PENDING_SHIPMENT");

  assert.deepEqual(calls, [
    "register",
    "reserveStock",
    "createOrder",
    "attachOrder",
    "confirmStock",
    "confirmOrderStock",
    "markCompleted",
  ]);
});

// TEST 2: Request da dang ky thi khong Reserve lan nua
await runTest("Duplicate registration cannot reserve", async () => {
  const calls = setup({ registrationCreated: false });

  await assert.rejects(
    placeOrder(payload),
    {
      status: 409,
      code: "ORDER_REQUEST_IN_PROGRESS",
    }
  );

  assert.deepEqual(calls, ["register"]);
});

// TEST 3: Confirm that bai thi phai doi soat
await runTest(
  "Confirm failure requires reconciliation",
  async () => {
    const calls = setup({ confirmFails: true });

    await assert.rejects(
      placeOrder(payload),
      {
        status: 503,
        code: "STOCK_RECONCILIATION_REQUIRED",
      }
    );

    assert.deepEqual(calls, [
      "register",
      "reserveStock",
      "createOrder",
      "attachOrder",
      "confirmStock",
      "markReconciliationRequired",
    ]);

    // Khong duoc cap nhat Order hoac danh dau COMPLETED
    assert.equal(
      calls.includes("confirmOrderStock"),
      false
    );

    assert.equal(
      calls.includes("markCompleted"),
      false
    );
  }
);

// TEST 4: Order da hoan tat thi khong xu ly lai
await runTest("Existing completed Order is reused", async () => {
  const hash = createRequestHash({
    customerAuthUserId: payload.customerAuthUserId,
    items: payload.items,
  });

  const calls = setup({
    existingOrder: {
      order_id: "101",
      customer_auth_user_id: 1,
      request_hash: hash,
      status: "PENDING_SHIPMENT",
    },
  });

  const result = await placeOrder(payload);

  assert.equal(result.order_id, "101");
  assert.deepEqual(calls, []);
});

console.log("");
console.log("Passed:", passed);
console.log("Failed:", failed);

if (passed === 4 && failed === 0) {
  console.log("ALL LIFECYCLE MOCK TESTS PASSED");
} else {
  process.exitCode = 1;
}
