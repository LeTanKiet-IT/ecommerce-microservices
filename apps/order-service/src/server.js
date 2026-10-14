
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import {
  checkDatabaseConnection,
  pool,
} from "./infrastructure/database.js";

import orderRoutes from "./presentation/routes/order.routes.js";

const app = express();

const port = Number(
  process.env.ORDER_SERVICE_PORT || 3004
);

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "100kb" }));

// Health Check
app.get("/health", (req, res) => {
  return res.status(200).json({
    service: "order-service",
    status: "UP",
  });
});

// PostgreSQL Readiness
app.get("/health/ready", async (req, res) => {
  try {
    await checkDatabaseConnection();

    return res.status(200).json({
      service: "order-service",
      status: "READY",
      database: "UP",
    });
  } catch (error) {
    console.error(
      "Order DB health check failed:",
      error.message
    );

    return res.status(503).json({
      service: "order-service",
      status: "NOT_READY",
      database: "DOWN",
    });
  }
});

// Chi cho phep client noi bo kiem thu Order API.
// Sau nay can thay bang JWT + phan quyen nguoi dung.
function requireInternalToken(req, res, next) {
  const expectedToken =
    process.env.INTERNAL_SERVICE_TOKEN;

  if (!expectedToken) {
    return res.status(503).json({
      success: false,
      code: "INTERNAL_AUTH_NOT_CONFIGURED",
      message: "Internal authentication is not configured",
    });
  }

  const providedToken = req.get("x-internal-token");

  if (
    typeof providedToken !== "string" ||
    providedToken !== expectedToken
  ) {
    return res.status(401).json({
      success: false,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  return next();
}

// Order API
app.use(
  "/api/orders",
  requireInternalToken,
  orderRoutes
);

// 404 handler
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    code: "ROUTE_NOT_FOUND",
    message: "Route not found",
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error("Order Service error:", error.message);

  return res.status(error.status || 500).json({
    success: false,
    code: error.code || "INTERNAL_SERVER_ERROR",
    message: "Request failed",
  });
});

async function startServer() {
  try {
    await checkDatabaseConnection();

    app.listen(port, () => {
      console.log(
        `Order Service listening at http://localhost:${port}`
      );
    });
  } catch (error) {
    console.error(
      "Order Service failed to start:",
      error.message
    );

    await pool.end();
    process.exit(1);
  }
}

startServer();
