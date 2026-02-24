-- 014: V12 Ultimate Enterprise — view_count, is_deleted, users.last_activity

-- conversion_jobs: view_count for hit analytics
ALTER TABLE conversion_jobs ADD COLUMN view_count INTEGER DEFAULT 0;

-- conversion_jobs: is_deleted (mirrors deleted_at for queries; optional)
ALTER TABLE conversion_jobs ADD COLUMN is_deleted INTEGER DEFAULT 0;

-- users: last_activity (user activity tracking)
ALTER TABLE users ADD COLUMN last_activity TEXT;

-- Index for top viewed queries
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_view_count ON conversion_jobs(view_count) WHERE status = 'COMPLETED' AND deleted_at IS NULL;
