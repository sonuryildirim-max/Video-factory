-- 017: V17 — download_progress for URL import jobs
ALTER TABLE conversion_jobs ADD COLUMN download_progress INTEGER DEFAULT 0;
ALTER TABLE conversion_jobs ADD COLUMN download_bytes INTEGER DEFAULT 0;
ALTER TABLE conversion_jobs ADD COLUMN download_total INTEGER DEFAULT 0;
