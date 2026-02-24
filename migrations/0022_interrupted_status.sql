-- 0022: Interrupted status for graceful agent shutdown (Samaritan)
-- status = 'INTERRUPTED' when agent stops due to RAM or SIGTERM; recoverable via retry.
ALTER TABLE conversion_jobs ADD COLUMN interrupted_at DATETIME;
ALTER TABLE conversion_jobs ADD COLUMN interrupted_stage TEXT;
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_interrupted ON conversion_jobs(status) WHERE status = 'INTERRUPTED';
