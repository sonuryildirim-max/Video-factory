-- =============================================================================
-- Migration 020: Hard-Integrity — FK CASCADE, user_id, composite indexes
-- BK Video Factory Enterprise SaaS
-- =============================================================================

-- 1. conversion_jobs: user_id for FK to users (uploaded_by remains for display)
-- SQLite ADD COLUMN supports REFERENCES
ALTER TABLE conversion_jobs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- 2. upload_tokens: ON DELETE CASCADE (requires table recreate)
CREATE TABLE IF NOT EXISTS upload_tokens_new (
    token TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES conversion_jobs(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO upload_tokens_new SELECT token, job_id, payload_json, expires_at, created_at FROM upload_tokens;
DROP TABLE upload_tokens;
ALTER TABLE upload_tokens_new RENAME TO upload_tokens;

CREATE INDEX IF NOT EXISTS idx_upload_tokens_expires_at ON upload_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_job_id ON upload_tokens(job_id);

-- 3. Composite indexes for list/filter queries (deleted_at, folder_id, created_at)
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_deleted_folder_created
  ON conversion_jobs(deleted_at, folder_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversion_jobs_status_deleted_created
  ON conversion_jobs(status, deleted_at, created_at);

CREATE INDEX IF NOT EXISTS idx_conversion_jobs_folder_deleted
  ON conversion_jobs(folder_id, deleted_at) WHERE deleted_at IS NULL;

SELECT 'Migration 020: Hard-integrity applied' AS message;
