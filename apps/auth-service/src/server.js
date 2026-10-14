import express from "express";
import { pool } from "./db/pool.js";
import authRouter from "./routes/auth.routes.js";

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());
app.use("/api/auth", authRouter);

app.get("/health", (req, res) => {
  res.status(200).json({
    service: "auth-service",
    status: "UP",
  });
});

app.get("/health/ready", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      service: "auth-service",
      status: "UP",
      database: "UP",
    });
  } catch (error) {
    console.error("Auth database check failed:", error.message);

    res.status(503).json({
      service: "auth-service",
      status: "DEGRADED",
      database: "DOWN",
    });
  }
});

app.listen(port, () => {
  console.log(`Auth Service listening at http://localhost:${port}`);
});