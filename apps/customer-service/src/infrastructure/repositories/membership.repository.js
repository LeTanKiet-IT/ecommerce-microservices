import { pool } from "../database.js";

export const membershipRepository = {
  async findAll() {
    const result = await pool.query(
      `SELECT tier_id, tier_name, min_score, discount_percent,
              created_at, updated_at
       FROM membership_tiers
       ORDER BY min_score ASC`
    );

    return result.rows;
  },

  async findById(id) {
    const result = await pool.query(
      `SELECT tier_id, tier_name, min_score, discount_percent,
              created_at, updated_at
       FROM membership_tiers
       WHERE tier_id = $1`,
      [id]
    );

    return result.rows[0] ?? null;
  },

  async findForScore(score) {
    const result = await pool.query(
      `SELECT tier_id, tier_name, min_score, discount_percent
       FROM membership_tiers
       WHERE min_score <= $1
       ORDER BY min_score DESC
       LIMIT 1`,
      [score]
    );

    return result.rows[0] ?? null;
  },

  async create({ tierName, minScore, discountPercent }) {
    const result = await pool.query(
      `INSERT INTO membership_tiers (tier_name, min_score, discount_percent)
       VALUES ($1, $2, $3)
       RETURNING tier_id, tier_name, min_score, discount_percent,
                 created_at, updated_at`,
      [tierName, minScore, discountPercent]
    );

    return result.rows[0];
  },

  async updateById(id, { tierName, minScore, discountPercent }) {
    const result = await pool.query(
      `UPDATE membership_tiers
       SET tier_name = $2,
           min_score = $3,
           discount_percent = $4,
           updated_at = NOW()
       WHERE tier_id = $1
       RETURNING tier_id, tier_name, min_score, discount_percent,
                 created_at, updated_at`,
      [id, tierName, minScore, discountPercent]
    );

    return result.rows[0] ?? null;
  },

  async deleteById(id) {
    const result = await pool.query(
      `DELETE FROM membership_tiers
       WHERE tier_id = $1
       RETURNING tier_id`,
      [id]
    );

    return result.rows[0] ?? null;
  },
};
