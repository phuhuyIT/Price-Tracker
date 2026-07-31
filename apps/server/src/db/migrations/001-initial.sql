CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL COLLATE NOCASE,
    password_hash TEXT,
    is_reserved INTEGER NOT NULL DEFAULT 0 CHECK (is_reserved IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(email),
    CHECK (
        (is_reserved = 1 AND password_hash IS NULL)
        OR (is_reserved = 0 AND password_hash IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_users_one_reserved
ON users(is_reserved)
WHERE is_reserved = 1;

CREATE TABLE user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    client_type TEXT NOT NULL CHECK (client_type IN ('dashboard', 'extension')),
    transport TEXT NOT NULL CHECK (transport IN ('cookie', 'bearer')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(token_hash),
    CHECK (
        (client_type = 'dashboard' AND transport = 'cookie')
        OR (client_type = 'extension' AND transport = 'bearer')
    ),
    CHECK (expires_at > created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    platform TEXT NOT NULL DEFAULT 'shopee' CHECK (platform = 'shopee'),
    shop_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    image_url TEXT,
    currency TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    alert_threshold_percent REAL NOT NULL DEFAULT 1
        CHECK (alert_threshold_percent >= 0 AND alert_threshold_percent <= 100),
    pending_missing_variant_set_hash TEXT,
    pending_missing_confirmation_count INTEGER NOT NULL DEFAULT 0
        CHECK (pending_missing_confirmation_count >= 0),
    pending_missing_updated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_checked_at TEXT,
    last_success_at TEXT,
    last_error_code TEXT,
    last_error_message TEXT,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(owner_user_id, platform, shop_id, item_id),
    CHECK (
        (pending_missing_variant_set_hash IS NULL
            AND pending_missing_confirmation_count = 0
            AND pending_missing_updated_at IS NULL)
        OR (pending_missing_variant_set_hash IS NOT NULL
            AND pending_missing_confirmation_count > 0
            AND pending_missing_updated_at IS NOT NULL)
    )
);

CREATE TABLE product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    external_model_id TEXT NOT NULL,
    identity_type TEXT NOT NULL CHECK (
        identity_type IN ('shopee_model', 'synthetic_default')
    ),
    name TEXT NOT NULL,
    lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (
        lifecycle_status IN ('active', 'suspected_missing', 'inactive')
    ),
    last_seen_at TEXT NOT NULL,
    consecutive_complete_misses INTEGER NOT NULL DEFAULT 0
        CHECK (consecutive_complete_misses >= 0),
    missing_since TEXT,
    inactive_reason TEXT,
    current_availability TEXT NOT NULL DEFAULT 'unknown' CHECK (
        current_availability IN ('available', 'sold_out', 'unavailable', 'unknown')
    ),
    availability_updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(product_id, external_model_id),
    CHECK (
        (external_model_id = 'default' AND identity_type = 'synthetic_default')
        OR (external_model_id <> 'default' AND identity_type = 'shopee_model')
    ),
    CHECK (
        (lifecycle_status = 'active'
            AND consecutive_complete_misses = 0
            AND missing_since IS NULL
            AND inactive_reason IS NULL)
        OR (lifecycle_status = 'suspected_missing'
            AND consecutive_complete_misses > 0
            AND missing_since IS NOT NULL
            AND inactive_reason IS NULL)
        OR (lifecycle_status = 'inactive'
            AND consecutive_complete_misses > 0
            AND missing_since IS NOT NULL
            AND inactive_reason IS NOT NULL)
    )
);

CREATE TABLE price_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('extension', 'playwright')),
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    schema_version INTEGER,
    pricing_context TEXT NOT NULL CHECK (
        pricing_context IN ('user_session', 'anonymous', 'unknown')
    ),
    pricing_context_key TEXT NOT NULL,
    captured_at TEXT,
    checked_at TEXT NOT NULL,
    variant_coverage TEXT NOT NULL CHECK (
        variant_coverage IN ('complete', 'partial', 'unknown')
    ),
    coverage_confidence TEXT NOT NULL CHECK (
        coverage_confidence IN ('verified', 'likely_complete', 'partial', 'unknown')
    ),
    lifecycle_eligible INTEGER NOT NULL CHECK (lifecycle_eligible IN (0, 1)),
    expected_variant_count INTEGER CHECK (
        expected_variant_count IS NULL OR expected_variant_count >= 0
    ),
    observed_variant_count INTEGER NOT NULL DEFAULT 0
        CHECK (observed_variant_count >= 0),
    priced_variant_count INTEGER NOT NULL DEFAULT 0
        CHECK (priced_variant_count >= 0),
    suspicious_mass_disappearance INTEGER NOT NULL DEFAULT 0
        CHECK (suspicious_mass_disappearance IN (0, 1)),
    observed_variant_set_hash TEXT,
    error_code TEXT,
    error_message TEXT,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(product_id, idempotency_key),
    CHECK (priced_variant_count <= observed_variant_count),
    CHECK (
        expected_variant_count IS NULL
        OR observed_variant_count <= expected_variant_count
    ),
    CHECK (
        lifecycle_eligible = 0
        OR (variant_coverage = 'complete' AND coverage_confidence = 'verified')
    ),
    CHECK (
        status = 'success'
        OR (
            lifecycle_eligible = 0
            AND variant_coverage = 'unknown'
            AND coverage_confidence = 'unknown'
            AND observed_variant_count = 0
            AND priced_variant_count = 0
        )
    ),
    CHECK (
        status = 'failed'
        OR (
            schema_version IS NOT NULL
            AND captured_at IS NOT NULL
            AND pricing_context <> 'unknown'
        )
    ),
    CHECK (
        (source = 'extension' AND pricing_context = 'user_session')
        OR (source = 'playwright' AND pricing_context = 'anonymous')
    ),
    CHECK (
        variant_coverage <> 'complete'
        OR expected_variant_count = observed_variant_count
    ),
    CHECK (
        (variant_coverage = 'complete'
            AND coverage_confidence IN ('verified', 'likely_complete'))
        OR (variant_coverage = 'partial' AND coverage_confidence = 'partial')
        OR (variant_coverage = 'unknown' AND coverage_confidence = 'unknown')
    ),
    CHECK (
        (status = 'success' AND error_code IS NULL AND error_message IS NULL)
        OR (status = 'failed' AND error_code IS NOT NULL)
    )
);

CREATE TABLE variant_check_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id INTEGER NOT NULL,
    variant_id INTEGER NOT NULL,
    presence TEXT NOT NULL CHECK (presence IN ('present', 'absent', 'unknown')),
    price_status TEXT NOT NULL CHECK (price_status IN ('observed', 'not_observed')),
    availability TEXT NOT NULL CHECK (
        availability IN ('available', 'sold_out', 'unavailable', 'unknown')
    ),
    reason_code TEXT,
    lifecycle_eligible INTEGER NOT NULL CHECK (lifecycle_eligible IN (0, 1)),
    variant_lifecycle TEXT NOT NULL CHECK (
        variant_lifecycle IN ('active', 'suspected_missing', 'inactive')
    ),
    created_at TEXT NOT NULL,
    FOREIGN KEY (check_id) REFERENCES price_checks(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
    UNIQUE(check_id, variant_id),
    CHECK (price_status <> 'observed' OR presence = 'present'),
    CHECK (
        (price_status = 'observed' AND reason_code IS NULL)
        OR (price_status = 'not_observed' AND reason_code IS NOT NULL)
    ),
    CHECK (lifecycle_eligible = 0 OR presence = 'absent'),
    CHECK (presence = 'present' OR availability = 'unknown')
);

CREATE TABLE price_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id INTEGER NOT NULL,
    variant_id INTEGER NOT NULL,
    price_amount INTEGER NOT NULL CHECK (
        typeof(price_amount) = 'integer' AND price_amount > 0
    ),
    currency TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
    price_definition TEXT NOT NULL CHECK (
        price_definition = 'displayed_post_voucher_excluding_shipping'
    ),
    price_type TEXT NOT NULL DEFAULT 'listed' CHECK (price_type = 'listed'),
    pricing_context TEXT NOT NULL CHECK (
        pricing_context IN ('user_session', 'anonymous')
    ),
    pricing_context_key TEXT NOT NULL,
    price_source TEXT NOT NULL CHECK (
        price_source IN (
            'variation_price_breakdown',
            'verified_display_field',
            'product_detail_fallback',
            'dom_display_fallback'
        )
    ),
    voucher_status TEXT NOT NULL CHECK (
        voucher_status IN ('applied', 'not_applied', 'unknown', 'not_available')
    ),
    shipping_included INTEGER NOT NULL DEFAULT 0 CHECK (shipping_included = 0),
    availability TEXT NOT NULL CHECK (
        availability IN ('available', 'sold_out', 'unavailable', 'unknown')
    ),
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (check_id) REFERENCES price_checks(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
    UNIQUE(
        check_id,
        variant_id,
        price_definition,
        price_type,
        pricing_context,
        pricing_context_key
    )
);

CREATE TABLE notification_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id INTEGER NOT NULL,
    previous_price_log_id INTEGER NOT NULL,
    current_price_log_id INTEGER NOT NULL,
    old_price_amount INTEGER NOT NULL CHECK (
        typeof(old_price_amount) = 'integer' AND old_price_amount > 0
    ),
    new_price_amount INTEGER NOT NULL CHECK (
        typeof(new_price_amount) = 'integer' AND new_price_amount > 0
    ),
    currency TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
    price_definition TEXT NOT NULL CHECK (
        price_definition = 'displayed_post_voucher_excluding_shipping'
    ),
    price_type TEXT NOT NULL DEFAULT 'listed' CHECK (price_type = 'listed'),
    pricing_context TEXT NOT NULL CHECK (
        pricing_context IN ('user_session', 'anonymous')
    ),
    pricing_context_key TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
    FOREIGN KEY (previous_price_log_id) REFERENCES price_logs(id) ON DELETE CASCADE,
    FOREIGN KEY (current_price_log_id) REFERENCES price_logs(id) ON DELETE CASCADE,
    UNIQUE(
        variant_id,
        old_price_amount,
        new_price_amount,
        price_definition,
        price_type,
        pricing_context,
        pricing_context_key
    ),
    CHECK (previous_price_log_id <> current_price_log_id),
    CHECK (new_price_amount < old_price_amount)
);

CREATE INDEX idx_sessions_user_active
ON user_sessions(user_id, revoked_at, expires_at);

CREATE INDEX idx_products_owner_status
ON products(owner_user_id, status, updated_at DESC);

CREATE INDEX idx_products_platform_item
ON products(owner_user_id, platform, shop_id, item_id);

CREATE INDEX idx_variants_product
ON product_variants(product_id, lifecycle_status);

CREATE INDEX idx_price_logs_variant_time
ON price_logs(variant_id, recorded_at DESC, id DESC);

CREATE INDEX idx_checks_product_time
ON price_checks(product_id, checked_at DESC, id DESC);

CREATE INDEX idx_variant_results_check
ON variant_check_results(check_id, variant_id);

CREATE INDEX idx_notifications_variant_time
ON notification_events(variant_id, sent_at DESC);
