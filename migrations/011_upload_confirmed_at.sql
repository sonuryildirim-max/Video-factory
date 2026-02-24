-- =============================================================================
-- Migration 011: upload_confirmed_at — Orphan PENDING sayımı
-- /complete çağrıldığında set edilir; uploaded = PENDING AND upload_confirmed_at IS NOT NULL
-- =============================================================================

-- SQLite: ADD COLUMN
ALTER TABLE conversion_jobs ADD COLUMN upload_confirmed_at DATETIME;
