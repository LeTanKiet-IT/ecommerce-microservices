
-- ==========================================
-- 1. BANG ORDERS
-- ==========================================

CREATE TABLE IF NOT EXISTS orders (
    order_id BIGSERIAL PRIMARY KEY,
    customer_auth_user_id BIGINT NOT NULL,
    idempotency_key VARCHAR(100) UNIQUE,
    stock_reservation_id VARCHAR(100) UNIQUE,
    request_hash VARCHAR(64),

    subtotal NUMERIC(12, 2) NOT NULL
        CHECK (subtotal >= 0),

    discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0
        CHECK (discount_percent >= 0 AND discount_percent <= 100),

    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0
        CHECK (discount_amount >= 0),

    total_amount NUMERIC(12, 2) NOT NULL
        CHECK (total_amount >= 0),

    currency CHAR(3) NOT NULL DEFAULT 'VND',

    status VARCHAR(30) NOT NULL
    DEFAULT 'AWAITING_STOCK_CONFIRMATION'
    CHECK (
        status IN (
            'AWAITING_STOCK_CONFIRMATION',
            'PENDING_SHIPMENT',
            'SHIPPED',
            'DELIVERED',
            'CANCELLED',
            'FAILED'
        )
    ),

    shipment_reference VARCHAR(100),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_auth_user_id
    ON orders(customer_auth_user_id);


-- ==========================================
-- 2. BANG ORDER_DETAILS
-- ==========================================

CREATE TABLE IF NOT EXISTS order_details (
    order_detail_id BIGSERIAL PRIMARY KEY,

    order_id BIGINT NOT NULL
        REFERENCES orders(order_id) ON DELETE CASCADE,

    product_id VARCHAR(64) NOT NULL,
    product_sku VARCHAR(40) NOT NULL,
    product_name VARCHAR(120) NOT NULL,

    unit_price NUMERIC(12, 2) NOT NULL
        CHECK (unit_price >= 0),

    quantity INTEGER NOT NULL
        CHECK (quantity > 0),

    line_total NUMERIC(12, 2) NOT NULL
        CHECK (line_total >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_order_details_order_id
    ON order_details(order_id);


-- ==========================================
-- 3. BANG OUTBOX_EVENTS
-- ==========================================

CREATE TABLE IF NOT EXISTS outbox_events (
    event_id UUID PRIMARY KEY,

    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,

    payload JSONB NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'WAITING_CONFIRMATION'
        CHECK (
            status IN (
                'WAITING_CONFIRMATION',
                'PENDING',
                'PUBLISHED'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

-- Chi lay nhung su kien da duoc xac nhan
-- va dang cho gui len Kafka

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
    ON outbox_events(created_at)
    WHERE status = 'PENDING';
