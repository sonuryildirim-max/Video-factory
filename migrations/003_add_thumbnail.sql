-- Migration 003: Add thumbnail support to conversion_jobs
-- Hetner agent generates a thumbnail using FFmpeg during processing,
-- uploads it to R2, and reports the key via POST /api/jobs/complete.

-- Add thumbnail_key column to conversion_jobs
ALTER TABLE conversion_jobs ADD COLUMN thumbnail_key TEXT;

-- Convenience index for cases where we query by thumbnail presence
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_thumbnail
    ON conversion_jobs (thumbnail_key)
    WHERE thumbnail_key IS NOT NULL;

-- Update the jobs_search_view to expose thumbnail URL
DROP VIEW IF EXISTS jobs_search_view;

CREATE VIEW IF NOT EXISTS jobs_search_view AS
SELECT
    j.*,
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
        WHEN j.thumbnail_key IS NOT NULL
            THEN 'https://cdn.bilgekarga.tr/' || j.thumbnail_key
        ELSE NULL
    END as thumbnail_url,
    CASE
        WHEN j.file_size_input > 0 AND j.file_size_output > 0 THEN
            ROUND((1.0 - (CAST(j.file_size_output AS REAL) / j.file_size_input)) * 100, 1)
        ELSE 0
    END as compression_percentage
FROM conversion_jobs j;

SELECT 'Migration 003: thumbnail_key column added to conversion_jobs' as message;
