import { pool } from "../database.js";

export const scoreRepository = {
  async adjustScore({
    authUserId,
    pointsDelta,
    reason,
    orderReference,
  }) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const customerResult = await client.query(
        `SELECT customer_id, score
         FROM customers
         WHERE auth_user_id = $1
         FOR UPDATE`,
        [authUserId]
      );

      if (customerResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const customer = customerResult.rows[0];
      const newScore = customer.score + pointsDelta;

      if (newScore < 0) {
        const error = new Error("Score cannot be negative");
        error.code = "INSUFFICIENT_SCORE";
        throw error;
      }

      const updatedResult = await client.query(
        `UPDATE customers
         SET score = $2, updated_at = NOW()
         WHERE customer_id = $1
         RETURNING customer_id, auth_user_id, full_name, address, score,
                   created_at, updated_at`,
        [customer.customer_id, newScore]
      );

      await client.query(
        `INSERT INTO score_transactions
           (customer_id, points_delta, reason, order_reference)
         VALUES ($1, $2, $3, $4)`,
        [
          customer.customer_id,
          pointsDelta,
          reason,
          orderReference ?? null,
        ]
      );

      const tierResult = await client.query(
        `SELECT tier_id, tier_name, discount_percent
         FROM membership_tiers
         WHERE min_score <= $1
         ORDER BY min_score DESC
         LIMIT 1`,
        [newScore]
      );

      await client.query("COMMIT");

      const tier = tierResult.rows[0] ?? null;

      return {
        ...updatedResult.rows[0],
        membership_tier_id: tier?.tier_id ?? null,
        membership_tier: tier?.tier_name ?? null,
        discount_percent: tier?.discount_percent ?? "0.00",
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  async findTransactionsByAuthUserId(authUserId) {
    const result = await pool.query(
      `SELECT
         st.transaction_id,
         st.points_delta,
         st.reason,
         st.order_reference,
         st.created_at
       FROM score_transactions st
       JOIN customers c ON c.customer_id = st.customer_id
       WHERE c.auth_user_id = $1
       ORDER BY st.created_at DESC`,
      [authUserId]
    );

    return result.rows;
  },
};
