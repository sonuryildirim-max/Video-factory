-- =============================================================================
-- Master Schema — BK Video Factory D1
-- SQLite/D1 compatible, CREATE IF NOT EXISTS only, no COMMENT ON
-- =============================================================================

-- config (referenced by migrations INSERT OR IGNORE)
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT
);

-- links (D1Repository, DEPLOYMENT_GUIDE)
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

-- logs (D1Repository, DEPLOYMENT_GUIDE)
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

-- url_hash_cache (migration 005)
CREATE TABLE IF NOT EXISTS url_hash_cache (
    url_hash TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_url_hash_cache_slug ON url_hash_cache(slug);

-- folders (migration 018) — system/user folders
CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- users (migration 012 + 013 + 014) — MUST exist before conversion_jobs.uploaded_by FK
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('root', 'admin')),
    api_token TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login TEXT,
    last_activity TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token) WHERE api_token IS NOT NULL;

-- conversion_jobs (migration 002 + 003 + 004 + 006 + 007 + 018 + 020)
CREATE TABLE IF NOT EXISTS conversion_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_name TEXT NOT NULL,
    clean_name TEXT NOT NULL,
    r2_raw_key TEXT NOT NULL,
    public_url TEXT,
    quality TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    worker_id TEXT,
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    file_size_input INTEGER,
    file_size_output INTEGER,
    duration INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    uploaded_by TEXT DEFAULT 'admin' REFERENCES users(username) ON DELETE SET DEFAULT,
    user_id INTEGER,
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    tags TEXT,
    project_name TEXT,
    notes TEXT,
    ffmpeg_command TEXT,
    ffmpeg_output TEXT,
    processing_time_seconds INTEGER,
    resolution TEXT,
    bitrate INTEGER,
    codec TEXT,
    frame_rate FLOAT,
    audio_codec TEXT,
    audio_bitrate INTEGER,
    thumbnail_key TEXT,
    source_url TEXT,
    privacy TEXT DEFAULT 'public',
    allow_download INTEGER DEFAULT 1,
    created_by TEXT,
    deleted_at DATETIME,
    view_count INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    processing_profile TEXT DEFAULT 'dengeli',
    interrupted_at DATETIME,
    interrupted_stage TEXT,
    processing_checkpoint TEXT,
    checkpoint_updated_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_conversion_jobs_status ON conversion_jobs(status);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_interrupted ON conversion_jobs(status) WHERE status = 'INTERRUPTED';
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_created_at ON conversion_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_clean_name ON conversion_jobs(clean_name);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_quality ON conversion_jobs(quality);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_uploaded_by ON conversion_jobs(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_thumbnail ON conversion_jobs(thumbnail_key) WHERE thumbnail_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_status_created_at ON conversion_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_started_at ON conversion_jobs(started_at) WHERE status = 'PROCESSING';
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_deleted_folder_created ON conversion_jobs(deleted_at, folder_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_status_deleted_created ON conversion_jobs(status, deleted_at, created_at);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_folder_deleted ON conversion_jobs(folder_id, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_deleted_at_created_at ON conversion_jobs(deleted_at, created_at) WHERE deleted_at IS NOT NULL;

-- job_logs
CREATE TABLE IF NOT EXISTS job_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    log_level TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    step TEXT,
    details_json TEXT,
    FOREIGN KEY (job_id) REFERENCES conversion_jobs(id) ON DELETE CASCADE
);

-- daily_statistics
CREATE TABLE IF NOT EXISTS daily_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL UNIQUE,
    total_jobs INTEGER DEFAULT 0,
    completed_jobs INTEGER DEFAULT 0,
    failed_jobs INTEGER DEFAULT 0,
    pending_jobs INTEGER DEFAULT 0,
    total_input_size_bytes INTEGER DEFAULT 0,
    total_output_size_bytes INTEGER DEFAULT 0,
    avg_processing_time_seconds FLOAT DEFAULT 0,
    quality_720p_count INTEGER DEFAULT 0,
    quality_1080p_count INTEGER DEFAULT 0,
    top_uploader TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- worker_heartbeats (migration 0025 FK)
CREATE TABLE IF NOT EXISTS worker_heartbeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id TEXT NOT NULL,
    last_heartbeat DATETIME NOT NULL,
    status TEXT NOT NULL,
    current_job_id INTEGER REFERENCES conversion_jobs(id) ON DELETE SET NULL,
    ip_address TEXT,
    version TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- security_logs (migration 008 + 0025 FK)
CREATE TABLE IF NOT EXISTS security_logs (
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

CREATE INDEX IF NOT EXISTS idx_security_logs_ip ON security_logs(ip);
CREATE INDEX IF NOT EXISTS idx_security_logs_action ON security_logs(action);
CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON security_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_security_logs_status ON security_logs(status);
CREATE INDEX IF NOT EXISTS idx_security_logs_ip_created ON security_logs(ip, created_at);

-- banned_ips (migration 008)
CREATE TABLE IF NOT EXISTS banned_ips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    banned_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_banned_ips_ip ON banned_ips(ip);
CREATE INDEX IF NOT EXISTS idx_banned_ips_expires_at ON banned_ips(expires_at);

-- system_stats (migration 008)
CREATE TABLE IF NOT EXISTS system_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    bucket TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_system_stats_metric ON system_stats(metric);
CREATE INDEX IF NOT EXISTS idx_system_stats_bucket ON system_stats(bucket);

-- admin_users (migration 008)
CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    totp_secret_encrypted TEXT,
    requires_2fa INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);

-- rate_limit_counters (migration 008)
CREATE TABLE IF NOT EXISTS rate_limit_counters (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_expires_at ON rate_limit_counters(expires_at);

-- upload_tokens (migration 008 + 020 ON DELETE CASCADE)
CREATE TABLE IF NOT EXISTS upload_tokens (
    token TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES conversion_jobs(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_upload_tokens_expires_at ON upload_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_job_id ON upload_tokens(job_id);

-- app_logs (migration 010 + 0025 FK) — append-only audit log, AppLogRepository
CREATE TABLE IF NOT EXISTS app_logs (
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

CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_app_logs_action ON app_logs(action);
CREATE INDEX IF NOT EXISTS idx_app_logs_job_id ON app_logs(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_logs_request_id ON app_logs(request_id) WHERE request_id IS NOT NULL;

-- conversion_jobs_fts (FTS5 for search)
CREATE VIRTUAL TABLE IF NOT EXISTS conversion_jobs_fts USING fts5(
    job_id UNINDEXED,
    original_name,
    clean_name,
    tags,
    project_name,
    notes,
    content='conversion_jobs',
    content_rowid='id'
);

-- jobs_search_view
DROP VIEW IF EXISTS jobs_search_view;
CREATE VIEW jobs_search_view AS
SELECT
    j.id,
    j.original_name,
    j.clean_name,
    j.status,
    j.quality,
    j.file_size_input,
    j.file_size_output,
    j.duration,
    j.uploaded_by,
    j.created_at,
    j.started_at,
    j.completed_at,
    j.tags,
    j.project_name,
    j.notes,
    j.retry_count,
    j.error_message,
    j.public_url,
    j.worker_id,
    j.processing_time_seconds,
    j.resolution,
    j.bitrate,
    j.codec,
    j.frame_rate,
    j.audio_codec,
    j.audio_bitrate,
    j.thumbnail_key,
    j.source_url,
    j.privacy,
    j.allow_download,
    CASE
        WHEN j.status = 'COMPLETED' THEN '✅ ' || j.clean_name
        WHEN j.status = 'PROCESSING' THEN '⏳ ' || j.clean_name
        WHEN j.status = 'FAILED' THEN '❌ ' || j.clean_name
        ELSE '📤 ' || j.clean_name
    END as display_name,
    CASE
        WHEN j.status = 'COMPLETED' AND j.public_url IS NOT NULL THEN j.public_url
        ELSE NULL
    END as video_url,
    CASE
        WHEN j.thumbnail_key IS NOT NULL THEN 'https://cdn.bilgekarga.tr/' || j.thumbnail_key
        ELSE NULL
    END as thumbnail_url,
    CASE
        WHEN j.file_size_input > 0 AND j.file_size_output > 0 THEN
            ROUND((1.0 - (CAST(j.file_size_output AS REAL) / j.file_size_input)) * 100, 1)
        ELSE 0
    END as compression_percentage
FROM conversion_jobs j;

-- Default config values
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('video_max_file_size', '157286400', 'Maximum file size in bytes (150MB)'),
    ('video_allowed_formats', 'mp4,mov,avi,mkv,webm', 'Allowed video formats'),
    ('video_temp_ttl_days', '7', 'Temporary storage TTL in days (R2 lifecycle)'),
    ('job_max_retries', '3', 'Maximum retry attempts for failed jobs'),
    ('job_processing_timeout_minutes', '60', 'Processing timeout in minutes'),
    ('ffmpeg_720p_preset', '-c:v libx264 -preset fast -crf 23 -profile:v high -level 4.1 -movflags +faststart -c:a aac -b:a 128k -vf scale=-2:720', 'FFmpeg 720p preset'),
    ('ffmpeg_1080p_preset', '-c:v libx264 -preset fast -crf 23 -profile:v high -level 4.1 -movflags +faststart -c:a aac -b:a 128k -vf scale=-2:1080', 'FFmpeg 1080p preset'),
    ('cdn_base_url', 'https://cdn.bilgekarga.tr', 'CDN base URL');
