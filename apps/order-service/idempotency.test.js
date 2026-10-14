import { randomUUID } from "node:crypto";
import { pool } from "./src/infrastructure/database.js";
import { orderRepository } from "./src/infrastructure/repositories/order.repository.js";

const idempotencyKey = `TEST_${randomUUID().replaceAll("-", "")}`;

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

const orderData = {
  idempotencyKey,
  customerAuthUserId: 1,
  subtotal: 200000,
  discountPercent: 5,
  discountAmount: 10000,
  totalAmount: 190000,
  items: [
    {
      productId: "TEST_PRODUCT_001",
      productSku: "TEST_SKU_001",
      productName: "Idempotency Test Product",
      unitPrice: 100000,
      quantity: 2,
      lineTotal: 200000
    }
  ]
};

try {
  // TEST 1: Tao don hang
  const order = await orderRepository.createOrder(orderData);
  orderId = order.order_id;

  check(
    order.idempotency_key === idempotencyKey,
    "TEST 1: Order saved with idempotency key"
  );

  // TEST 2: Tim don hang bang key
  const found = await orderRepository.findByIdempotencyKey(
    idempotencyKey
  );

  check(
    found !== null &&
    String(found.order_id) === String(orderId),
    "TEST 2: Find order by idempotency key"
  );

  // TEST 3: Tao lai voi cung key phai bi tu choi
  try {
    await orderRepository.createOrder(orderData);

    check(
      false,
      "TEST 3: Duplicate key rejected"
    );
  } catch (error) {
    check(
      error.code === "23505",
      "TEST 3: Duplicate key rejected"
    );
  }

  // TEST 4: Kiem tra chi co mot don hang
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM orders
     WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  check(
    result.rows[0].count === 1,
    "TEST 4: Only one order exists"
  );

  // TEST 5: Kiem tra Outbox
  const outbox = await pool.query(
    `SELECT status
     FROM outbox_events
     WHERE aggregate_type = 'Order'
       AND aggregate_id = $1`,
    [String(orderId)]
  );

  check(
    outbox.rowCount === 1 &&
    outbox.rows[0].status === "WAITING_CONFIRMATION",
    "TEST 5: Outbox remains WAITING_CONFIRMATION"
  );

} catch (error) {
  console.error("TEST ERROR:", error.message);
  failures++;
} finally {
  // Don du lieu kiem thu
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
