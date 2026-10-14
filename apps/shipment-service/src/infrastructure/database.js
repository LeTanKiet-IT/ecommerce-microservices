
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.SHIPMENT_DB_HOST || "127.0.0.1",
  port: Number(process.env.SHIPMENT_DB_PORT || 5436),
  database: process.env.SHIPMENT_DB_NAME,
  user: process.env.SHIPMENT_DB_USER,
  password: process.env.SHIPMENT_DB_PASSWORD,
});

export async function checkDatabaseConnection() {
  const result = await pool.query("SELECT 1 AS ok");
  return result.rows[0].ok === 1;
}
