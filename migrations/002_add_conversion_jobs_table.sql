-- Migration: Add conversion_jobs table for BK-VF (Bilge Karga Video Factory)
-- Date: 2026-02-19
-- Based on master JSON architecture from conversation with Claude

-- Drop existing videos table if exists (we'll use conversion_jobs instead)
DROP TABLE IF EXISTS videos;
DROP TABLE IF EXISTS video_processing_logs;
DROP TABLE IF EXISTS video_statistics;
DROP VIEW IF EXISTS videos_search_view;

-- Create conversion_jobs table (main table for atomic job processing)
CREATE TABLE IF NOT EXISTS conversion_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_name TEXT NOT NULL,                    -- Sanitizasyon öncesi orijinal dosya adı
    clean_name TEXT NOT NULL,                       -- Sanitize edilmiş nihai dosya adı
    r2_raw_key TEXT NOT NULL,                       -- Geçici ham dosya yolu (raw-uploads/ prefix'i zorunlu)
    public_url TEXT,                                -- CDN yayın linki
    quality TEXT NOT NULL,                          -- 720p / 1080p
    status TEXT NOT NULL DEFAULT 'PENDING',         -- PENDING | PROCESSING | COMPLETED | FAILED
    worker_id TEXT,                                 -- İşlemi yapan sunucu ID'si
    retry_count INTEGER DEFAULT 0,                  -- Hata toleransı için
    error_message TEXT,                             -- FFmpeg veya sistem hata çıktısı
    file_size_input INTEGER,                        -- Ham dosya boyutu (byte)
    file_size_output INTEGER,                       -- İşlenmiş dosya boyutu (byte)
    duration INTEGER,                               -- Video süresi (saniye)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,                            -- İşlem başlangıç zamanı (timeout tespiti için şart)
    completed_at DATETIME,                          -- İşlem bitiş zamanı
    
    -- Additional metadata for reporting
    uploaded_by TEXT DEFAULT 'admin',               -- Yükleyen kullanıcı
    tags TEXT,                                      -- Etiketler (virgülle ayrılmış)
    project_name TEXT,                              -- Proje adı
    notes TEXT,                                     -- Notlar
    ffmpeg_command TEXT,                            -- Kullanılan FFmpeg komutu
    ffmpeg_output TEXT,                             -- FFmpeg çıktısı (debug için)
    processing_time_seconds INTEGER,                -- İşlem süresi (saniye)
    resolution TEXT,                                -- Çözünürlük (örn: 1920x1080)
    bitrate INTEGER,                                -- Bitrate (kbps)
    codec TEXT,                                     -- Video codec (h264, hevc)
    frame_rate FLOAT,                               -- FPS
    audio_codec TEXT,                               -- Audio codec (aac, mp3)
    audio_bitrate INTEGER                           -- Audio bitrate (kbps)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_status ON conversion_jobs(status);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_created_at ON conversion_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_clean_name ON conversion_jobs(clean_name);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_quality ON conversion_jobs(quality);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_uploaded_by ON conversion_jobs(uploaded_by);

-- Create job_logs table for detailed processing history
CREATE TABLE IF NOT EXISTS job_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    log_level TEXT NOT NULL,                        -- INFO, WARNING, ERROR, DEBUG
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    step TEXT,                                      -- UPLOAD, CLAIM, DOWNLOAD, ENCODE, UPLOAD_FINAL, COMPLETE, FAIL
    details_json TEXT,                              -- Additional details as JSON
    FOREIGN KEY (job_id) REFERENCES conversion_jobs(id) ON DELETE CASCADE
);

-- Create daily_statistics table for reporting
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

-- Create worker_heartbeats table for monitoring
CREATE TABLE IF NOT EXISTS worker_heartbeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id TEXT NOT NULL,
    last_heartbeat DATETIME NOT NULL,
    status TEXT NOT NULL,                           -- ACTIVE, IDLE, ERROR
    current_job_id INTEGER,
    ip_address TEXT,
    version TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create search view for advanced queries
CREATE VIEW IF NOT EXISTS jobs_search_view AS
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
        WHEN j.file_size_input > 0 AND j.file_size_output > 0 THEN 
            ROUND((1.0 - (CAST(j.file_size_output AS REAL) / j.file_size_input)) * 100, 1)
        ELSE 0
    END as compression_percentage,
    CASE 
        WHEN j.processing_time_seconds > 0 THEN 
            ROUND(CAST(j.file_size_input AS REAL) / j.processing_time_seconds / 1024 / 1024, 2)
        ELSE 0
    END as processing_speed_mbps
FROM conversion_jobs j;

-- Insert default configuration
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('video_max_file_size', '157286400', 'Maximum file size in bytes (150MB)'),
    ('video_allowed_formats', 'mp4,mov,avi,mkv,webm', 'Allowed video formats'),
    ('video_temp_ttl_days', '7', 'Temporary storage TTL in days (R2 lifecycle)'),
    ('job_max_retries', '3', 'Maximum retry attempts for failed jobs'),
    ('job_processing_timeout_minutes', '60', 'Processing timeout in minutes'),
    ('ffmpeg_720p_preset', '-c:v libx264 -preset fast -crf 23 -profile:v high -level 4.1 -movflags +faststart -c:a aac -b:a 128k -vf scale=-2:720', 'FFmpeg 720p preset'),
    ('ffmpeg_1080p_preset', '-c:v libx264 -preset fast -crf 23 -profile:v high -level 4.1 -movflags +faststart -c:a aac -b:a 128k -vf scale=-2:1080', 'FFmpeg 1080p preset'),
    ('worker_polling_base_interval', '10', 'Base polling interval in seconds'),
    ('worker_polling_max_interval', '120', 'Maximum polling interval in seconds'),
    ('worker_heartbeat_timeout_minutes', '5', 'Worker heartbeat timeout in minutes'),
    ('r2_raw_bucket', 'raw-uploads', 'R2 raw uploads bucket name'),
    ('r2_public_bucket', 'public-videos', 'R2 public videos bucket name'),
    ('cdn_base_url', 'https://cdn.bilgekarga.tr', 'CDN base URL'),
    ('hetner_agent_version', '1.0.0', 'Hetner Python agent version'),
    ('system_version', 'BK-VF_v2.1', 'System version');

-- Create cleanup function for timed out jobs
CREATE TRIGGER IF NOT EXISTS cleanup_timed_out_jobs
AFTER INSERT ON conversion_jobs
BEGIN
    -- Clean up jobs that have been PROCESSING for more than 1 hour
    UPDATE conversion_jobs 
    SET status = 'FAILED', 
        error_message = 'Processing timeout (1 hour)',
        completed_at = CURRENT_TIMESTAMP
    WHERE status = 'PROCESSING' 
      AND started_at < datetime('now', '-1 hour');
END;

-- Note: Daily statistics will be maintained in KV store to prevent D1 lock contention
-- The trigger for update_daily_statistics_on_complete has been removed
-- Statistics will be updated asynchronously via JobService using KV store counters

-- Print migration summary
SELECT 'Migration 002: BK-VF conversion_jobs table created successfully' as message;