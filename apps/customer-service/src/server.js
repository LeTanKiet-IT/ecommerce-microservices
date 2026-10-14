import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import {
  checkDatabaseConnection,
  pool,
} from "./infrastructure/database.js";
import customerRouter from "./presentation/http/customer.routes.js";
import membershipRouter from "./presentation/http/membership.routes.js";

const app = express();
const port = Number(process.env.CUSTOMER_SERVICE_PORT || 3002);

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

app.get("/health", (req, res) => {
  return res.status(200).json({
    service: "customer-service",
    status: "UP",
  });
});

app.get("/health/ready", async (req, res) => {
  try {
    await checkDatabaseConnection();

    return res.status(200).json({
      service: "customer-service",
      status: "READY",
      database: "UP",
    });
  } catch (error) {
    console.error("Customer DB health check failed:", error.message);

    return res.status(503).json({
      service: "customer-service",
      status: "NOT_READY",
      database: "DOWN",
    });
  }
});

app.use("/api/customers", customerRouter);
app.use("/api/membership-tiers", membershipRouter);

app.use((error, req, res, next) => {
  if (error.code === "23505") {
    return res.status(409).json({ message: "A record with this value already exists" });
  }

  if (error.code === "23503") {
    return res.status(409).json({ message: "The record is referenced by other data" });
  }

  if (error.code === "23514") {
    return res.status(400).json({ message: "Data violates a database constraint" });
  }

  console.error("Customer API error:", error.message);
  return res.status(500).json({ message: "Internal server error" });
});

async function startServer() {
  try {
    await checkDatabaseConnection();

    app.listen(port, () => {
      console.log(`Customer Service listening at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Customer Service failed to start:", error.message);
    await pool.end();
    process.exit(1);
  }
}

startServer();
