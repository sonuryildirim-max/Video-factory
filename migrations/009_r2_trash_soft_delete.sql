-- Migration: R2 Trash (Soft Delete) for BK-VF
-- Date: 2026-02-21
-- Adds deleted_at column and supports DELETED status for soft delete

-- Add deleted_at column
ALTER TABLE conversion_jobs ADD COLUMN deleted_at DATETIME;

-- Index for soft-deleted jobs (cleanup queries)
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_deleted_at ON conversion_jobs(deleted_at) WHERE deleted_at IS NOT NULL;
