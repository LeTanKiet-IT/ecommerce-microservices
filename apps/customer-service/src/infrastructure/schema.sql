CREATE TABLE IF NOT EXISTS membership_tiers (
    tier_id BIGSERIAL PRIMARY KEY,
    tier_name VARCHAR(50) NOT NULL UNIQUE,
    min_score INTEGER NOT NULL UNIQUE CHECK (min_score >= 0),
    discount_percent NUMERIC(5, 2) NOT NULL
        CHECK (discount_percent >= 0 AND discount_percent <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id BIGSERIAL PRIMARY KEY,
    auth_user_id BIGINT NOT NULL UNIQUE,
    full_name VARCHAR(100),
    address VARCHAR(500),
    score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS score_transactions (
    transaction_id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL
        REFERENCES customers(customer_id) ON DELETE RESTRICT,
    points_delta INTEGER NOT NULL CHECK (points_delta <> 0),
    reason VARCHAR(255) NOT NULL,
    order_reference VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_transactions_customer_id
    ON score_transactions(customer_id);
