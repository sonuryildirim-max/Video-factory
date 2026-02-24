-- 012: Multi-user RBAC — users table, created_by on jobs and security_logs

-- users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('root', 'admin')),
    api_token TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token) WHERE api_token IS NOT NULL;

-- conversion_jobs: created_by (who performed the operation)
ALTER TABLE conversion_jobs ADD COLUMN created_by TEXT;

-- security_logs: created_by
ALTER TABLE security_logs ADD COLUMN created_by TEXT;
