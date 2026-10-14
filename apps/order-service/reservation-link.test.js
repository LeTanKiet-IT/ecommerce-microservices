import { randomUUID } from "node:crypto";
import { pool } from "./src/infrastructure/database.js";
import { orderRepository } from "./src/infrastructure/repositories/order.repository.js";

const testId = randomUUID().replaceAll("-", "");
const idempotencyKey = `TEST_ORDER_${testId}`;
const stockReservationId = `TEST_RES_${testId}`;

let failures = 0;

function check(condition, message) {
  if (condition) {
    console.log("PASS:", message);
  } else {
    console.error("FAIL:", message);
    failures++;
  }
}

try {
  // TEST 1: Tao Order va Outbox
  const order = await orderRepository.createOrder({
    idempotencyKey,
    stockReservationId,
    customerAuthUserId: 1,
    subtotal: 200000,
    discountPercent: 5,
    discountAmount: 10000,
    totalAmount: 190000,
    items: [
      {
        productId: "TEST_PRODUCT_001",
        productSku: "TEST_RES_001",
        productName: "Reservation Link Test",
        unitPrice: 100000,
        quantity: 2,
        lineTotal: 200000
      }
    ]
  });

  check(
    order.idempotency_key === idempotencyKey,
    "TEST 1: Idempotency Key saved"
  );

  check(
    order.stock_reservation_id === stockReservationId,
    "TEST 2: Stock Reservation ID saved"
  );

  check(
    order.status === "AWAITING_STOCK_CONFIRMATION",
    "TEST 3: Order awaiting confirmation"
  );

  // TEST 4: Kiem tra Outbox
  const outbox = await pool.query(
    `SELECT status, payload
     FROM outbox_events
     WHERE aggregate_type = 'Order'
       AND aggregate_id = $1
       AND event_type = 'OrderCreated'`,
    [String(order.order_id)]
  );

  check(
    outbox.rowCount === 1 &&
    outbox.rows[0].status === "WAITING_CONFIRMATION" &&
    outbox.rows[0].payload.stockReservationId === stockReservationId,
    "TEST 4: Outbox linked to Reservation"
  );

  // TEST 5: Tim lai Order
  const found = await orderRepository.findByIdempotencyKey(
    idempotencyKey
  );

  check(
    found !== null &&
    found.stock_reservation_id === stockReservationId,
    "TEST 5: Find Order by Idempotency Key"
  );

  // TEST 6: Khong cho phep trung Stock Reservation ID
  try {
    await orderRepository.createOrder({
      idempotencyKey: `OTHER_${testId}`,
      stockReservationId,
      customerAuthUserId: 1,
      subtotal: 200000,
      discountPercent: 5,
      discountAmount: 10000,
      totalAmount: 190000,
      items: [
        {
          productId: "TEST_PRODUCT_002",
          productSku: "TEST_RES_002",
          productName: "Duplicate Reservation Test",
          unitPrice: 100000,
          quantity: 2,
          lineTotal: 200000
        }
      ]
    });

    check(false, "TEST 6: Duplicate Reservation rejected");
  } catch (error) {
    check(
      error.code === "23505",
      "TEST 6: Duplicate Reservation rejected"
    );
  }

} catch (error) {
  console.error("TEST ERROR:", error.message);
  failures++;
} finally {
  // Chi xoa du lieu co Idempotency Key cua bai test
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
           WHERE idempotency_key IN ($1, $2)
         )`,
      [idempotencyKey, `OTHER_${testId}`]
    );

    await client.query(
      `DELETE FROM order_details
       WHERE order_id IN (
         SELECT order_id
         FROM orders
         WHERE idempotency_key IN ($1, $2)
       )`,
      [idempotencyKey, `OTHER_${testId}`]
    );

    await client.query(
      `DELETE FROM orders
       WHERE idempotency_key IN ($1, $2)`,
      [idempotencyKey, `OTHER_${testId}`]
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
