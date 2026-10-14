import assert from "node:assert/strict";
import { mock } from "node:test";

import { placeOrder } from "./src/application/use-cases/place-order.use-case.js";
import { orderRepository } from "./src/infrastructure/repositories/order.repository.js";
import { orderRequestRepository } from "./src/infrastructure/repositories/order-request.repository.js";
import { productReservationClient } from "./src/infrastructure/clients/product-reservation.client.js";

const productId = "6ace8d5dc8c1450fa32654a1";

const payload = {
  idempotencyKey: "RESERVE_TIMEOUT_MOCK_001",
  customerAuthUserId: 1,
  items: [{ productId, quantity: 2 }],
};

let passed = 0;
let failed = 0;

function setup({
  reserveMode = "timeout",
  markFails = false,
} = {}) {
  const calls = [];

  // Gia lap Customer Service va Product Service
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

    throw new Error(`Unexpected request: ${address}`);
  });

  mock.method(
    orderRepository,
    "findByIdempotencyKey",
    async () => null
  );

  mock.method(
    orderRequestRepository,
    "register",
    async () => {
      calls.push("register");
      return {
        created: true,
        request: { status: "PROCESSING" },
      };
    }
  );

  mock.method(
    productReservationClient,
    "reserveStock",
    async () => {
      calls.push("reserveStock");

      if (reserveMode === "timeout") {
        const error = new Error(
          "Product Service request timed out"
        );
        error.status = 503;
        error.code = "PRODUCT_SERVICE_TIMEOUT";
        throw error;
      }

      if (reserveMode === "unexpected") {
        return { status: "RELEASED" };
      }

      return { status: "RESERVED" };
    }
  );

  mock.method(
    orderRequestRepository,
    "markReconciliationRequired",
    async () => {
      calls.push("markReconciliationRequired");

      if (markFails) {
        throw new Error("Mock PostgreSQL unavailable");
      }

      return { status: "RECONCILIATION_REQUIRED" };
    }
  );

  // Neu code co gang tao Order hoac Release,
  // test phai that bai.
  mock.method(orderRepository, "createOrder", async () => {
    calls.push("createOrder");
    throw new Error("createOrder must not be called");
  });

  mock.method(
    productReservationClient,
    "releaseStock",
    async () => {
      calls.push("releaseStock");
      throw new Error("releaseStock must not be called");
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

// TEST 1: Reserve timeout
await runTest(
  "Reserve timeout requires reconciliation",
  async () => {
    const calls = setup({ reserveMode: "timeout" });

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
      "markReconciliationRequired",
    ]);
  }
);

// TEST 2: Reserve tra trang thai bat thuong
await runTest(
  "Unexpected Reserve status requires reconciliation",
  async () => {
    const calls = setup({ reserveMode: "unexpected" });

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
      "markReconciliationRequired",
    ]);
  }
);

// TEST 3: Khong luu duoc trang thai doi soat
await runTest(
  "Failed reconciliation update stops Order creation",
  async () => {
    const calls = setup({
      reserveMode: "timeout",
      markFails: true,
    });

    await assert.rejects(
      placeOrder(payload),
      {
        status: 503,
        code: "ORDER_RECONCILIATION_REQUIRED",
      }
    );

    assert.deepEqual(calls, [
      "register",
      "reserveStock",
      "markReconciliationRequired",
    ]);
  }
);

console.log("");
console.log("Passed:", passed);
console.log("Failed:", failed);

if (passed === 3 && failed === 0) {
  console.log("ALL RESERVE TIMEOUT MOCK TESTS PASSED");
} else {
  process.exitCode = 1;
}
