import { pool } from "../db/pool.js";

export async function createCustomerUser({
  username,
  email,
  phone,
  passwordHash,
}) {
  const result = await pool.query(
    `INSERT INTO users (username, email, phone, password_hash, role_id)
     VALUES (
       $1,
       $2,
       $3,
       $4,
       (SELECT role_id FROM roles WHERE role_name = 'CUSTOMER')
     )
     RETURNING uid, username, email, phone, role_id, created_at`,
    [username, email, phone, passwordHash]
  );

  return result.rows[0];
}

export async function findUserByUsername(username) {
  const result = await pool.query(
    `SELECT
       u.uid,
       u.username,
       u.password_hash,
       r.role_name
     FROM users AS u
     JOIN roles AS r ON r.role_id = u.role_id
     WHERE u.username = $1`,
    [username]
  );

  return result.rows[0] ?? null;
}