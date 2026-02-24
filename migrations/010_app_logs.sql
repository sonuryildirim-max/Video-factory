-- =============================================================================
-- Migration 010: app_logs — Bankacılık / Askeri Seviye Audit Log
-- Append-only, hash chain ile tahrifat tespiti
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    level TEXT NOT NULL,
    action TEXT NOT NULL,
    job_id INTEGER,
    details_json TEXT NOT NULL DEFAULT '{}',
    ip TEXT,
    user_id TEXT,
    request_id TEXT,
    prev_hash TEXT,
    entry_hash TEXT,
    UNIQUE(id)
);

CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_app_logs_action ON app_logs(action);
CREATE INDEX IF NOT EXISTS idx_app_logs_job_id ON app_logs(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_logs_request_id ON app_logs(request_id) WHERE request_id IS NOT NULL;
