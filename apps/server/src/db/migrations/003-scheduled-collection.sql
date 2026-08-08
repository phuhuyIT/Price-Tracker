CREATE TABLE collection_jobs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    product_id INTEGER,
    platform TEXT NOT NULL DEFAULT 'shopee' CHECK (platform = 'shopee'),
    shop_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    job_type TEXT NOT NULL CHECK (job_type IN ('track', 'refresh')),
    job_source TEXT NOT NULL DEFAULT 'manual' CHECK (
        job_source IN ('manual', 'scheduler')
    ),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'claimed',
            'retry_wait',
            'waiting_auth',
            'completed',
            'failed'
        )
    ),
    target_context_key TEXT,
    claimed_context_key TEXT,
    lease_token_hash TEXT,
    lease_expires_at TEXT,
    next_attempt_at TEXT,
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
            AND next_attempt_at IS NULL
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
        (status = 'pending'
            AND completed_at IS NULL
            AND next_attempt_at IS NULL
            AND error_code IS NULL
            AND error_message IS NULL)
        OR (status = 'claimed'
            AND completed_at IS NULL)
        OR (status = 'retry_wait'
            AND target_context_key IS NOT NULL
            AND completed_at IS NULL
            AND next_attempt_at IS NOT NULL
            AND error_code IS NOT NULL
            AND error_message IS NOT NULL)
        OR (status = 'waiting_auth'
            AND target_context_key IS NOT NULL
            AND completed_at IS NULL
            AND next_attempt_at IS NULL
            AND error_code = 'AUTHENTICATION_REQUIRED'
            AND error_message IS NOT NULL)
        OR (status = 'completed'
            AND completed_at IS NOT NULL
            AND next_attempt_at IS NULL
            AND error_code IS NULL
            AND error_message IS NULL)
        OR (status = 'failed'
            AND completed_at IS NOT NULL
            AND next_attempt_at IS NULL
            AND error_code IS NOT NULL
            AND error_message IS NOT NULL)
    )
);

INSERT INTO collection_jobs_new (
    id,
    owner_user_id,
    product_id,
    platform,
    shop_id,
    item_id,
    canonical_url,
    job_type,
    job_source,
    status,
    target_context_key,
    claimed_context_key,
    lease_token_hash,
    lease_expires_at,
    next_attempt_at,
    attempt_count,
    error_code,
    error_message,
    created_at,
    updated_at,
    completed_at
)
SELECT
    id,
    owner_user_id,
    product_id,
    platform,
    shop_id,
    item_id,
    canonical_url,
    job_type,
    'manual',
    status,
    target_context_key,
    claimed_context_key,
    lease_token_hash,
    lease_expires_at,
    NULL,
    attempt_count,
    error_code,
    error_message,
    created_at,
    updated_at,
    completed_at
FROM collection_jobs;

DROP TABLE collection_jobs;
ALTER TABLE collection_jobs_new RENAME TO collection_jobs;

CREATE UNIQUE INDEX idx_collection_jobs_one_active_identity
ON collection_jobs(owner_user_id, platform, shop_id, item_id)
WHERE status IN ('pending', 'claimed', 'retry_wait', 'waiting_auth');

CREATE INDEX idx_collection_jobs_claim
ON collection_jobs(
    owner_user_id,
    status,
    target_context_key,
    next_attempt_at,
    created_at,
    id
);

CREATE INDEX idx_collection_jobs_product_time
ON collection_jobs(product_id, created_at DESC, id DESC);

CREATE INDEX idx_collection_jobs_expired_lease
ON collection_jobs(status, lease_expires_at)
WHERE status = 'claimed';
