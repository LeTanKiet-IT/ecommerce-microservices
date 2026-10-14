import { pool } from "../database.js";

const customerSelect = `
  SELECT
    c.customer_id,
    c.auth_user_id,
    c.full_name,
    c.address,
    c.score,
    c.created_at,
    c.updated_at,
    tier.tier_id AS membership_tier_id,
    tier.tier_name AS membership_tier,
    COALESCE(tier.discount_percent, 0)::numeric(5, 2) AS discount_percent
  FROM customers c
  LEFT JOIN LATERAL (
    SELECT tier_id, tier_name, discount_percent
    FROM membership_tiers
    WHERE min_score <= c.score
    ORDER BY min_score DESC
    LIMIT 1
  ) AS tier ON TRUE
`;

export const customerRepository = {
  async create({ authUserId, fullName, address }) {
    const result = await pool.query(
      `INSERT INTO customers (auth_user_id, full_name, address)
       VALUES ($1, $2, $3)
       RETURNING customer_id, auth_user_id, full_name, address, score,
                 created_at, updated_at`,
      [authUserId, fullName, address ?? null]
    );

    return result.rows[0];
  },

  async findByAuthUserId(authUserId) {
    const result = await pool.query(
      `${customerSelect}
       WHERE c.auth_user_id = $1`,
      [authUserId]
    );

    return result.rows[0] ?? null;
  },

  async updateProfile(authUserId, { fullName, address }) {
    const result = await pool.query(
      `UPDATE customers
       SET full_name = $2,
           address = $3,
           updated_at = NOW()
       WHERE auth_user_id = $1
       RETURNING customer_id, auth_user_id, full_name, address, score,
                 created_at, updated_at`,
      [authUserId, fullName, address ?? null]
    );

    return result.rows[0] ?? null;
  },
};
