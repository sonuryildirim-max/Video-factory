-- Migration: Add privacy and allow_download to conversion_jobs
-- Date: 2026-02-21
-- DTO VideoDTO uses job.privacy; VideoService.updateJob allows patching these fields

ALTER TABLE conversion_jobs ADD COLUMN privacy TEXT DEFAULT 'public';
ALTER TABLE conversion_jobs ADD COLUMN allow_download INTEGER DEFAULT 1;
