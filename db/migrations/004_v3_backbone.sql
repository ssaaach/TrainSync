-- v3 Phase A: shared rate-limit counters (every worker / serverless instance
-- sees the same numbers) and migration checksums.

CREATE TABLE IF NOT EXISTS rate_limit_hits (
    rl_key VARCHAR(191) NOT NULL PRIMARY KEY,
    hits INT UNSIGNED NOT NULL DEFAULT 0,
    reset_at DATETIME(3) NOT NULL,
    KEY idx_rate_limit_reset (reset_at)
);

ALTER TABLE schema_migrations ADD COLUMN checksum CHAR(64) NULL;
