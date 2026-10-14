import pg from "pg";

const { Pool } = pg;

const requiredVariables = [
  "ORDER_DB_NAME",
  "ORDER_DB_USER",
  "ORDER_DB_PASSWORD",
  "ORDER_DB_PORT",
];

const missingVariables = requiredVariables.filter(
  (name) => !process.env[name]
);

if (missingVariables.length > 0) {
  throw new Error(
    `Missing environment variables: ${missingVariables.join(", ")}`
  );
}

export const pool = new Pool({
  host: process.env.ORDER_DB_HOST || "127.0.0.1",
  port: Number(process.env.ORDER_DB_PORT),
  database: process.env.ORDER_DB_NAME,
  user: process.env.ORDER_DB_USER,
  password: process.env.ORDER_DB_PASSWORD,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (error) => {
  console.error("Unexpected Order DB pool error:", error.message);
});

export async function checkDatabaseConnection() {
  await pool.query("SELECT 1");
}
