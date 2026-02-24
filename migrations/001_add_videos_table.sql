-- Migration: Add videos table for video processing system
-- Date: 2026-02-19

-- Create videos table
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,                    -- UUID v4
    original_name TEXT NOT NULL,            -- Original filename: "güneş gözlüğü.mp4"
    normalized_name TEXT NOT NULL,          -- Normalized filename: "gunes-gozlugu-abc123.mp4"
    temp_r2_key TEXT,                       -- Temporary R2 storage key
    perm_r2_key TEXT,                       -- Permanent R2 storage key
    status TEXT NOT NULL DEFAULT 'uploaded', -- uploaded, processing, completed, failed
    render_preset TEXT NOT NULL,            -- 720p_web, 1080p_web, custom
    file_size INTEGER,                      -- File size in bytes
    duration FLOAT,                         -- Video duration in seconds
    resolution TEXT,                        -- "1920x1080"
    bitrate INTEGER,                        -- Video bitrate in kbps
    codec TEXT,                             -- "h264", "hevc", "vp9"
    frame_rate FLOAT,                       -- FPS
    audio_codec TEXT,                       -- "aac", "mp3"
    audio_channels INTEGER,                 -- 1 (mono), 2 (stereo), 6 (5.1)
    audio_bitrate INTEGER,                  -- Audio bitrate in kbps
    thumbnail_r2_key TEXT,                  -- Thumbnail image in R2
    uploaded_by TEXT NOT NULL,              -- User ID who uploaded
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processing_started_at TIMESTAMP,
    processing_completed_at TIMESTAMP,
    error_message TEXT,
    metadata_json TEXT,                     -- Additional metadata as JSON
    queue_message_id TEXT,                  -- Cloudflare Queue message ID
    hetner_job_id TEXT,                     -- Hetner processing job ID
    processing_duration INTEGER,            -- Processing time in seconds
    final_file_size INTEGER,                -- Processed file size in bytes
    final_bitrate INTEGER,                  -- Processed video bitrate
    final_resolution TEXT,                  -- Processed resolution
    tags TEXT,                              -- Comma-separated tags for search
    project_name TEXT,                      -- Optional project grouping
    notes TEXT                              -- User notes
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_uploaded_by ON videos(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_videos_uploaded_at ON videos(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_videos_render_preset ON videos(render_preset);
CREATE INDEX IF NOT EXISTS idx_videos_normalized_name ON videos(normalized_name);
CREATE INDEX IF NOT EXISTS idx_videos_tags ON videos(tags);

-- Create video_processing_logs table for detailed processing history
CREATE TABLE IF NOT EXISTS video_processing_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    log_level TEXT NOT NULL,                -- info, warning, error, debug
    message TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    step TEXT,                              -- upload, normalization, queue, processing, upload_final, cleanup
    details_json TEXT,                      -- Additional details as JSON
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

-- Create video_statistics table for reporting
CREATE TABLE IF NOT EXISTS video_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL UNIQUE,
    total_uploads INTEGER DEFAULT 0,
    total_processed INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    total_storage_bytes INTEGER DEFAULT 0,
    avg_processing_time_seconds FLOAT DEFAULT 0,
    preset_720p_count INTEGER DEFAULT 0,
    preset_1080p_count INTEGER DEFAULT 0,
    top_uploader TEXT
);

-- Create search view for advanced queries
CREATE VIEW IF NOT EXISTS videos_search_view AS
SELECT 
    v.id,
    v.original_name,
    v.normalized_name,
    v.status,
    v.render_preset,
    v.file_size,
    v.duration,
    v.resolution,
    v.uploaded_by,
    v.uploaded_at,
    v.processing_completed_at,
    v.tags,
    v.project_name,
    v.notes,
    CASE 
        WHEN v.status = 'completed' THEN '✅ ' || v.normalized_name
        WHEN v.status = 'processing' THEN '⏳ ' || v.normalized_name
        WHEN v.status = 'failed' THEN '❌ ' || v.normalized_name
        ELSE '📤 ' || v.normalized_name
    END as display_name,
    CASE 
        WHEN v.status = 'completed' AND v.perm_r2_key IS NOT NULL THEN 'https://cdn.bilgekarga.tr/' || v.perm_r2_key
        ELSE NULL
    END as perm_url,
    CASE 
        WHEN v.thumbnail_r2_key IS NOT NULL THEN 'https://cdn.bilgekarga.tr/' || v.thumbnail_r2_key
        ELSE NULL
    END as thumbnail_url
FROM videos v;

-- Insert default video processing configuration
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('video_max_file_size', '1073741824', 'Maximum file size in bytes (1GB)'),
    ('video_allowed_formats', 'mp4,mov,avi,mkv,webm', 'Allowed video formats'),
    ('video_temp_ttl_days', '3', 'Temporary storage TTL in days'),
    ('video_queue_max_retries', '3', 'Maximum queue retry attempts'),
    ('video_processing_timeout_minutes', '60', 'Processing timeout in minutes'),
    ('video_720p_preset', '--preset="Fast 720p30" --encoder x264 --quality 22 --rate 30 --width 1280 --height 720 --optimize', 'Handbrake 720p preset'),
    ('video_1080p_preset', '--preset="Fast 1080p30" --encoder x264 --quality 22 --rate 30 --width 1920 --height 1080 --optimize', 'Handbrake 1080p preset'),
    ('video_hetner_api_url', 'http://hetner-server:8080/api/process', 'Hetner server API URL'),
    ('video_hetner_api_key', '', 'Hetner server API key'),
    ('video_r2_temp_bucket', 'video-temp', 'R2 temporary bucket name'),
    ('video_r2_perm_bucket', 'video-perm', 'R2 permanent bucket name'),
    ('video_r2_thumb_bucket', 'video-thumbnails', 'R2 thumbnails bucket name');
