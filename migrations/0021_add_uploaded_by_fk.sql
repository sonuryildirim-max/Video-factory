-- =============================================================================
-- Migration 021: uploaded_by FK — REFERENCES users(username) ON DELETE SET DEFAULT
-- BK Video Factory R1 Production Hardening
-- SQLite: ALTER COLUMN ADD FK desteklenmediği için tablo yeniden oluşturulur
-- =============================================================================

PRAGMA foreign_keys = OFF;

-- 1. conversion_jobs'a bağlı view ve virtual tabloları kaldır
DROP VIEW IF EXISTS jobs_search_view;
DROP TABLE IF EXISTS conversion_jobs_fts;

-- 2. Yeni tablo — uploaded_by REFERENCES users(username) ON DELETE SET DEFAULT
CREATE TABLE conversion_jobs_new (
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
    deleted_at DATETIME,
    upload_confirmed_at DATETIME,
    created_by TEXT,
    view_count INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    processing_profile TEXT DEFAULT 'dengeli',
    download_progress INTEGER DEFAULT 0,
    download_bytes INTEGER DEFAULT 0,
    download_total INTEGER DEFAULT 0,
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- 3. Veriyi kopyala
INSERT INTO conversion_jobs_new SELECT * FROM conversion_jobs;

-- 4. Eski tabloyu kaldır
DROP TABLE conversion_jobs;

-- 5. Yeniden adlandır
ALTER TABLE conversion_jobs_new RENAME TO conversion_jobs;

-- 6. İndeksleri oluştur
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_status ON conversion_jobs(status);
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

-- 7. FTS5 tablosunu yeniden oluştur ve doldur (id = conversion_jobs.id, rowid ile eşleşir)
CREATE VIRTUAL TABLE IF NOT EXISTS conversion_jobs_fts USING fts5(
    original_name,
    clean_name,
    tags,
    project_name,
    notes,
    content='conversion_jobs',
    content_rowid='id'
);
INSERT INTO conversion_jobs_fts(conversion_jobs_fts) VALUES('rebuild');

-- 8. jobs_search_view'ı yeniden oluştur
CREATE VIEW jobs_search_view AS
SELECT
    j.id, j.original_name, j.clean_name, j.status, j.quality,
    j.file_size_input, j.file_size_output, j.duration, j.uploaded_by,
    j.created_at, j.started_at, j.completed_at, j.tags, j.project_name, j.notes,
    j.retry_count, j.error_message, j.public_url, j.worker_id, j.processing_time_seconds,
    j.resolution, j.bitrate, j.codec, j.frame_rate, j.audio_codec, j.audio_bitrate,
    j.thumbnail_key, j.source_url, j.privacy, j.allow_download,
    CASE WHEN j.status = 'COMPLETED' THEN '✅ ' || j.clean_name
         WHEN j.status = 'PROCESSING' THEN '⏳ ' || j.clean_name
         WHEN j.status = 'FAILED' THEN '❌ ' || j.clean_name
         ELSE '📤 ' || j.clean_name END as display_name,
    CASE WHEN j.status = 'COMPLETED' AND j.public_url IS NOT NULL THEN j.public_url ELSE NULL END as video_url,
    CASE WHEN j.thumbnail_key IS NOT NULL THEN 'https://cdn.bilgekarga.tr/' || j.thumbnail_key ELSE NULL END as thumbnail_url,
    CASE WHEN j.file_size_input > 0 AND j.file_size_output > 0
         THEN ROUND((1.0 - (CAST(j.file_size_output AS REAL) / j.file_size_input)) * 100, 1) ELSE 0 END as compression_percentage
FROM conversion_jobs j;

PRAGMA foreign_keys = ON;

SELECT 'Migration 021: uploaded_by FK applied' AS message;
