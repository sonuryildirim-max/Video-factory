-- =============================================================================
-- Migration 0025: Data Integrity — missing Foreign Keys and ON DELETE
-- security_logs.created_by -> users(username), app_logs.job_id/user_id -> jobs/users,
-- worker_heartbeats.current_job_id -> conversion_jobs(id)
-- =============================================================================

PRAGMA foreign_keys = OFF;

-- -----------------------------------------------------------------------------
-- 1. security_logs: created_by REFERENCES users(username) ON DELETE SET NULL
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_logs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    user_agent TEXT,
    country TEXT,
    city TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT REFERENCES users(username) ON DELETE SET NULL
);
INSERT INTO security_logs_new SELECT id, ip, action, status, user_agent, country, city, details_json, created_at, created_by FROM security_logs;
DROP TABLE security_logs;
ALTER TABLE security_logs_new RENAME TO security_logs;
CREATE INDEX IF NOT EXISTS idx_security_logs_ip ON security_logs(ip);
CREATE INDEX IF NOT EXISTS idx_security_logs_action ON security_logs(action);
CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON security_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_security_logs_status ON security_logs(status);
CREATE INDEX IF NOT EXISTS idx_security_logs_ip_created ON security_logs(ip, created_at);

-- -----------------------------------------------------------------------------
-- 2. app_logs: job_id -> conversion_jobs(id), user_id -> users(username) ON DELETE SET NULL
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_logs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    level TEXT NOT NULL,
    action TEXT NOT NULL,
    job_id INTEGER REFERENCES conversion_jobs(id) ON DELETE SET NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    ip TEXT,
    user_id TEXT REFERENCES users(username) ON DELETE SET NULL,
    request_id TEXT,
    prev_hash TEXT,
    entry_hash TEXT
);
INSERT INTO app_logs_new SELECT id, created_at, level, action, job_id, details_json, ip, user_id, request_id, prev_hash, entry_hash FROM app_logs;
DROP TABLE app_logs;
ALTER TABLE app_logs_new RENAME TO app_logs;
CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_app_logs_action ON app_logs(action);
CREATE INDEX IF NOT EXISTS idx_app_logs_job_id ON app_logs(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_logs_request_id ON app_logs(request_id) WHERE request_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. worker_heartbeats: current_job_id REFERENCES conversion_jobs(id) ON DELETE SET NULL
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS worker_heartbeats_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id TEXT NOT NULL,
    last_heartbeat DATETIME NOT NULL,
    status TEXT NOT NULL,
    current_job_id INTEGER REFERENCES conversion_jobs(id) ON DELETE SET NULL,
    ip_address TEXT,
    version TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO worker_heartbeats_new SELECT id, worker_id, last_heartbeat, status, current_job_id, ip_address, version, created_at FROM worker_heartbeats;
DROP TABLE worker_heartbeats;
ALTER TABLE worker_heartbeats_new RENAME TO worker_heartbeats;

PRAGMA foreign_keys = ON;

SELECT 'Migration 0025: Foreign keys integrity applied' AS message;
