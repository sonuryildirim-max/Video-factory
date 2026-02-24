-- =============================================================================
-- Migration 0026: Index optimization — composite (status, created_at), (deleted_at, created_at)
-- Supports cursor/ordered list queries on conversion_jobs
-- =============================================================================

-- (status, created_at) for bucket=list ordering (if not already present from 006/020/021)
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_status_created_at ON conversion_jobs(status, created_at);

-- (deleted_at, created_at) for deleted list ORDER BY deleted_at DESC, id
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_deleted_at_created_at ON conversion_jobs(deleted_at, created_at) WHERE deleted_at IS NOT NULL;

SELECT 'Migration 0026: Index optimization applied' AS message;
