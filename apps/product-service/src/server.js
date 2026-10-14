
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import {
  connectDatabase,
  isDatabaseConnected,
} from "./infrastructure/database.js";

import productRouter from "./presentation/http/product.routes.js";
import stockReservationRouter from "./presentation/http/stock-reservation.routes.js";

const app = express();
const port = Number(process.env.PRODUCT_SERVICE_PORT || 3003);

// Middleware
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

// Health Check
app.get("/health", (req, res) => {
  return res.status(200).json({
    service: "product-service",
    status: "UP",
  });
});

// Database Readiness Check
app.get("/health/ready", (req, res) => {
  const connected = isDatabaseConnected();

  return res.status(connected ? 200 : 503).json({
    service: "product-service",
    status: connected ? "READY" : "NOT_READY",
    database: connected ? "UP" : "DOWN",
  });
});

// Product API
app.use("/api/products", productRouter);

// Internal Stock Reservation API
app.use(
  "/internal/stock-reservations",
  stockReservationRouter
);

// Global Error Handler
app.use((error, req, res, next) => {

  // Invalid request data
  if (error.status === 400) {
    return res.status(400).json({
      message: error.message,
    });
  }

  // Insufficient product stock
  if (error.code === "INSUFFICIENT_STOCK") {
    return res.status(409).json({
      message: error.message,
      code: error.code,
    });
  }

  // Reservation conflict
  if (error.code === "RESERVATION_CONFLICT") {
    return res.status(409).json({
      message: error.message,
      code: error.code,
    });
  }

  // Reservation not found
  if (error.code === "RESERVATION_NOT_FOUND") {
    return res.status(404).json({
      message: error.message,
      code: error.code,
    });
  }

  // Product not found during stock restoration
  if (error.code === "PRODUCT_NOT_FOUND") {
    return res.status(409).json({
      message: error.message,
      code: error.code,
    });
  }

  // MongoDB duplicate key
  if (error.code === 11000) {
    return res.status(409).json({
      message: "Duplicate resource",
      code: "DUPLICATE_KEY",
    });
  }

  // Mongoose validation errors
  if (
    error.name === "ValidationError" ||
    error.name === "CastError"
  ) {
    return res.status(400).json({
      message: "Invalid product data",
    });
  }

  // Unexpected errors
  console.error("Product API error:", error.message);

  return res.status(500).json({
    message: "Internal server error",
  });
});

// Start Product Service
async function startServer() {
  try {
    await connectDatabase();

    app.listen(port, () => {
      console.log(
        `Product Service listening at http://localhost:${port}`
      );
    });
  } catch (error) {
    console.error(
      "Product Service failed to start:",
      error.message
    );

    process.exit(1);
  }
}

startServer();
