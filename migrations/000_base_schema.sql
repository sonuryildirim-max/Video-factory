-- =============================================================================
-- Migration 000: Base schema — config, links, logs
-- BK Video Factory D1 — Önkoşul: Migration 001 ve 002 INSERT OR IGNORE INTO config kullanır
-- Bu tablolar olmadan migration 001/002 "no such table: config" hatası verir.
-- =============================================================================

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS links (
    slug TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    clicks INTEGER DEFAULT 0,
    created TEXT NOT NULL,
    created_by TEXT,
    updated_at TEXT,
    source TEXT,
    campaign TEXT
);

CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    details TEXT,
    ip TEXT,
    ua TEXT,
    country TEXT,
    city TEXT,
    timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action);
