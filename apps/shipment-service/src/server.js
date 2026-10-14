
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import {
  pool,
  checkDatabaseConnection,
} from "./infrastructure/database.js";

const app = express();
const port = Number(
  process.env.SHIPMENT_SERVICE_PORT || 3005
);

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

app.get("/health", (req, res) => {
  return res.status(200).json({
    service: "shipment-service",
    status: "UP",
  });
});

app.get("/health/ready", async (req, res) => {
  try {
    await checkDatabaseConnection();

    return res.status(200).json({
      service: "shipment-service",
      status: "READY",
      database: "UP",
    });
  } catch {
    return res.status(503).json({
      service: "shipment-service",
      status: "NOT_READY",
      database: "DOWN",
    });
  }
});

// Tam thoi bao ve API bang internal token.
// Khi tich hop API Gateway can thay bang JWT va phan quyen.
app.use("/api/shipments", (req, res, next) => {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  const provided = req.get("x-internal-token");

  if (!expected) {
    return res.status(503).json({
      code: "AUTH_NOT_CONFIGURED",
    });
  }

  if (!provided || provided !== expected) {
    return res.status(401).json({
      code: "UNAUTHORIZED",
    });
  }

  next();
});

app.get("/api/shipments/order/:orderId", async (req, res) => {
  const { orderId } = req.params;

  if (!/^[1-9]\d*$/.test(orderId)) {
    return res.status(400).json({
      code: "INVALID_ORDER_ID",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM shipments
      WHERE order_id = $1
      `,
      [orderId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        code: "SHIPMENT_NOT_FOUND",
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      code: "SHIPMENT_LOOKUP_FAILED",
    });
  }
});

app.use((req, res) => {
  return res.status(404).json({
    code: "ROUTE_NOT_FOUND",
  });
});

async function start() {
  try {
    await checkDatabaseConnection();

    app.listen(port, () => {
      console.log(
        `Shipment Service listening at http://localhost:${port}`
      );
    });
  } catch (error) {
    console.error("Shipment startup failed:", error);
    await pool.end();
    process.exitCode = 1;
  }
}

start();
