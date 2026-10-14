
import { Kafka, logLevel } from "kafkajs";
import { pool } from "../database.js";

const brokers = (
  process.env.KAFKA_BROKERS || "localhost:9092"
)
  .split(",")
  .map((broker) => broker.trim())
  .filter(Boolean);

const kafka = new Kafka({
  clientId: "order-outbox-publisher",
  brokers,
  logLevel: logLevel.WARN,
});

const producer = kafka.producer({
  allowAutoTopicCreation: false,
});

const TOPIC = "order.created";
const POLL_INTERVAL_MS = 3000;

let running = true;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publishPendingEvents() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(`
      SELECT
        event_id,
        aggregate_id,
        event_type,
        payload
      FROM outbox_events
      WHERE status = 'PENDING'
        AND event_type = 'OrderCreated'
      ORDER BY created_at ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `);

    if (result.rowCount === 0) {
      await client.query("COMMIT");
      return 0;
    }

    for (const event of result.rows) {
      const payload = {
        ...event.payload,
        eventId: String(event.event_id),
        eventType: event.event_type,
      };

      await producer.send({
        topic: TOPIC,
        acks: -1,
        messages: [
          {
            key: String(event.aggregate_id),
            value: JSON.stringify(payload),
            headers: {
              eventId: String(event.event_id),
              eventType: event.event_type,
            },
          },
        ],
      });

      await client.query(
        `
        UPDATE outbox_events
        SET
          status = 'PUBLISHED',
          published_at = NOW()
        WHERE event_id = $1
          AND status = 'PENDING'
        `,
        [event.event_id]
      );

      console.log(
        `PUBLISHED: ${event.event_type} | Order #${event.aggregate_id}`
      );
    }

    await client.query("COMMIT");

    return result.rowCount;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  await producer.connect();

  console.log("Kafka Producer connected");
  console.log(`Publishing to topic: ${TOPIC}`);

  while (running) {
    try {
      const count = await publishPendingEvents();

      if (count > 0) {
        console.log(`Processed ${count} Outbox event(s)`);
      }
    } catch (error) {
      console.error("Outbox Publisher error:", error.message);
    }

    if (running) {
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

process.on("SIGINT", () => {
  running = false;
});

process.on("SIGTERM", () => {
  running = false;
});

try {
  await main();
} catch (error) {
  console.error("Publisher failed:", error.message);
  process.exitCode = 1;
} finally {
  await producer.disconnect();
  await pool.end();
  console.log("Outbox Publisher stopped");
}
