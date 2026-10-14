
import { Kafka, logLevel } from "kafkajs";
import { pool } from "../database.js";

const kafka = new Kafka({
  clientId: "shipment-service",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092")
    .split(",")
    .map((x) => x.trim()),
  logLevel: logLevel.WARN,
});

const consumer = kafka.consumer({
  groupId: "shipment-order-created-v1",
});

const TOPIC = "order.created";

function validateEvent(event) {
  if (
    typeof event.eventId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      event.eventId
    ) ||
    event.eventType !== "OrderCreated" ||
    !/^[1-9]\d*$/.test(String(event.orderId ?? "")) ||
    !/^[1-9]\d*$/.test(
      String(event.customerAuthUserId ?? "")
    ) ||
    typeof event.totalAmount !== "number" ||
    !Number.isFinite(event.totalAmount) ||
    event.totalAmount < 0 ||
    event.currency !== "VND" ||
    !Array.isArray(event.items) ||
    event.items.length === 0
  ) {
    throw new Error("Invalid OrderCreated event");
  }
}

async function processOrderCreated(event) {
  validateEvent(event);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const recorded = await client.query(
      `
      INSERT INTO processed_events (
        event_id,
        event_type,
        order_id
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
      `,
      [
        event.eventId,
        event.eventType,
        String(event.orderId),
      ]
    );

    if (recorded.rowCount === 0) {
      await client.query("COMMIT");
      console.log(`SKIPPED: Duplicate event ${event.eventId}`);
      return;
    }

    const shipment = await client.query(
      `
      INSERT INTO shipments (
        order_id,
        customer_auth_user_id,
        total_amount,
        currency,
        status
      )
      VALUES ($1, $2, $3, $4, 'PENDING')
      ON CONFLICT (order_id) DO NOTHING
      RETURNING shipment_id
      `,
      [
        String(event.orderId),
        String(event.customerAuthUserId),
        event.totalAmount,
        event.currency,
      ]
    );

    if (shipment.rowCount === 0) {
      const existing = await client.query(
        `
        SELECT customer_auth_user_id, total_amount, currency
        FROM shipments
        WHERE order_id = $1
        `,
        [String(event.orderId)]
      );

      if (
        existing.rowCount !== 1 ||
        existing.rows[0].customer_auth_user_id !==
          String(event.customerAuthUserId) ||
        Number(existing.rows[0].total_amount) !==
          event.totalAmount ||
        existing.rows[0].currency !== event.currency
      ) {
        throw new Error(
          `Conflicting shipment data for Order #${event.orderId}`
        );
      }

      console.log(
        `SKIPPED: Shipment for Order #${event.orderId} already exists`
      );
    } else {
      console.log(
        `CREATED: Shipment #${shipment.rows[0].shipment_id} for Order #${event.orderId}`
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  await consumer.connect();

  await consumer.subscribe({
    topic: TOPIC,
    fromBeginning: true,
  });

  console.log("Shipment Kafka Consumer connected");
  console.log(`Listening to topic: ${TOPIC}`);

  await consumer.run({
    autoCommit: true,
    eachMessage: async ({ message }) => {
      if (!message.value) {
        throw new Error("Empty Kafka message");
      }

      const event = JSON.parse(message.value.toString());

      await processOrderCreated(event);
    },
  });
}

async function shutdown() {
  console.log("Stopping Shipment Consumer...");

  try {
    await consumer.disconnect();
  } finally {
    await pool.end();
  }
}

process.once("SIGINT", () => {
  shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
});

process.once("SIGTERM", () => {
  shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
});

main().catch(async (error) => {
  console.error("Shipment Consumer failed:", error);
  await shutdown();
  process.exitCode = 1;
});
