import pg from "pg";

const { Pool } = pg;

const requiredVariables = [
  "CUSTOMER_DB_NAME",
  "CUSTOMER_DB_USER",
  "CUSTOMER_DB_PASSWORD",
  "CUSTOMER_DB_PORT",
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
  host: process.env.CUSTOMER_DB_HOST || "127.0.0.1",
  port: Number(process.env.CUSTOMER_DB_PORT),
  database: process.env.CUSTOMER_DB_NAME,
  user: process.env.CUSTOMER_DB_USER,
  password: process.env.CUSTOMER_DB_PASSWORD,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (error) => {
  console.error("Unexpected Customer DB pool error:", error.message);
});

export async function checkDatabaseConnection() {
  await pool.query("SELECT 1");
}
