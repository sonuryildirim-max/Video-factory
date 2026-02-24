-- Migration 006: conversion_jobs performance indexes
-- Optimizes claimPendingJob (status + created_at) and getJobs filters.

CREATE INDEX IF NOT EXISTS idx_conversion_jobs_status_created_at
    ON conversion_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_conversion_jobs_started_at
    ON conversion_jobs (started_at) WHERE status = 'PROCESSING';

SELECT 'Migration 006: conversion_jobs indexes created' as message;
