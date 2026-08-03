CREATE TABLE collection_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    product_id INTEGER,
    platform TEXT NOT NULL DEFAULT 'shopee' CHECK (platform = 'shopee'),
    shop_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    job_type TEXT NOT NULL CHECK (job_type IN ('track', 'refresh')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'claimed', 'completed', 'failed')
    ),
    target_context_key TEXT,
    claimed_context_key TEXT,
    lease_token_hash TEXT,
    lease_expires_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CHECK (job_type <> 'refresh' OR product_id IS NOT NULL),
    CHECK (
        status <> 'claimed'
        OR (
            target_context_key IS NOT NULL
            AND claimed_context_key = target_context_key
            AND lease_token_hash IS NOT NULL
            AND lease_expires_at IS NOT NULL
            AND completed_at IS NULL
            AND error_code IS NULL
            AND error_message IS NULL
        )
    ),
    CHECK (
        status = 'claimed'
        OR (
            claimed_context_key IS NULL
            AND lease_token_hash IS NULL
            AND lease_expires_at IS NULL
        )
    ),
    CHECK (
        (status = 'completed' AND completed_at IS NOT NULL
            AND error_code IS NULL AND error_message IS NULL)
        OR (status = 'failed' AND completed_at IS NOT NULL
            AND error_code IS NOT NULL AND error_message IS NOT NULL)
        OR (status IN ('pending', 'claimed') AND completed_at IS NULL
            AND error_code IS NULL AND error_message IS NULL)
    )
);

CREATE UNIQUE INDEX idx_collection_jobs_one_active_identity
ON collection_jobs(owner_user_id, platform, shop_id, item_id)
WHERE status IN ('pending', 'claimed');

CREATE INDEX idx_collection_jobs_claim
ON collection_jobs(owner_user_id, status, target_context_key, created_at, id);

CREATE INDEX idx_collection_jobs_product_time
ON collection_jobs(product_id, created_at DESC, id DESC);
