-- =============================================================================
-- Migration 008: Security Logs, Banned IPs, System Stats, Rate Limit, Upload Tokens
-- BK-Video-Factory Enterprise Security 2026 — KV Tamamen D1'e Taşındı
-- =============================================================================

-- -----------------------------------------------------------------------------
-- security_logs: Tüm güvenlik olayları (giriş, ban, honeypot, rate limit)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    action TEXT NOT NULL,           -- LOGIN_SUCCESS, LOGIN_FAILED, HONEYPOT_TRIGGERED, BANNED, RATE_LIMITED, BLOCKED_BANNED_IP
    status TEXT NOT NULL,           -- success, failed, blocked, banned
    user_agent TEXT,
    country TEXT,
    city TEXT,
    details_json TEXT,              -- { user, attemptNumber, banned, reason, ... }
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_security_logs_ip ON security_logs(ip);
CREATE INDEX IF NOT EXISTS idx_security_logs_action ON security_logs(action);
CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON security_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_security_logs_status ON security_logs(status);
CREATE INDEX IF NOT EXISTS idx_security_logs_ip_created ON security_logs(ip, created_at);


-- -----------------------------------------------------------------------------
-- banned_ips: Kalıcı veya geçici banlanan IP'ler (honeypot, brute-force)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS banned_ips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL,           -- honeypot, brute_force, rate_limit, manual
    banned_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,                -- NULL = kalıcı ban
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_banned_ips_ip ON banned_ips(ip);
CREATE INDEX IF NOT EXISTS idx_banned_ips_expires_at ON banned_ips(expires_at);


-- -----------------------------------------------------------------------------
-- system_stats: Günlük/ saatlik sistem istatistikleri
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric TEXT NOT NULL,           -- logins_success, logins_failed, bans_total, honeypot_triggers
    value INTEGER NOT NULL DEFAULT 0,
    bucket TEXT NOT NULL,           -- date '2026-02-21' veya hour '2026-02-21T14'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_system_stats_metric ON system_stats(metric);
CREATE INDEX IF NOT EXISTS idx_system_stats_bucket ON system_stats(bucket);


-- -----------------------------------------------------------------------------
-- admin_users (2FA iskeleti): İleride TOTP için
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    totp_secret_encrypted TEXT,
    requires_2fa INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);


-- -----------------------------------------------------------------------------
-- rate_limit_counters: Rate limit ve failed-attempt sayaçları (KV yerine)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_counters (
    key TEXT PRIMARY KEY,             -- rate:verify:1.2.3.4, fail:1.2.3.4, rate:presigned:1.2.3.4
    count INTEGER NOT NULL DEFAULT 0,
    window_start TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_expires_at ON rate_limit_counters(expires_at);


-- -----------------------------------------------------------------------------
-- upload_tokens: Presigned upload token (VIDEO_UPLOAD_TOKENS KV yerine)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS upload_tokens (
    token TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES conversion_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_upload_tokens_expires_at ON upload_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_job_id ON upload_tokens(job_id);
