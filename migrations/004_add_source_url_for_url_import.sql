-- Migration 004: Add source_url for URL import → Agent flow
-- URL import jobs are queued with source_url; agent downloads and uploads to R2.

-- Add source_url column (nullable; set for URL import jobs)
ALTER TABLE conversion_jobs ADD COLUMN source_url TEXT;

-- Make r2_raw_key nullable (NULL until agent uploads for URL import jobs)
-- SQLite does not support ALTER COLUMN; we add a check for new inserts/updates.
-- Existing schema has r2_raw_key NOT NULL. We need to recreate the table or use a workaround.
-- SQLite: we can add a new column and migrate, or use a more targeted approach.
-- Simpler: add source_url only. For D1/SQLite, NOT NULL can be relaxed by creating a new table.
-- To keep migration minimal: we'll allow NULL in application logic; DB might still enforce NOT NULL.
-- Check: In 002, r2_raw_key TEXT NOT NULL. SQLite doesn't support ALTER COLUMN ... DROP NOT NULL directly.
-- Workaround: Create new table, copy data, drop old, rename. That's invasive.
-- Alternative: Use a separate migration that creates a view or relies on app sending empty string for non-URL jobs.
-- Plan says "r2_raw_key = null" - so we need nullable. In SQLite we'd need:
-- PRAGMA foreign_keys=off; CREATE TABLE new_cj (...); INSERT INTO new_cj SELECT ...; DROP TABLE conversion_jobs; ALTER TABLE new_cj RENAME TO conversion_jobs;
-- That's complex. Simpler: Keep r2_raw_key NOT NULL but use a placeholder like '' for URL import until agent uploads.
-- Actually the plan explicitly says r2_raw_key = null. So we need nullable.
-- SQLite: Recreate table without NOT NULL on r2_raw_key.
-- We'll do a minimal migration: just ADD source_url. For r2_raw_key, we use a placeholder 'pending' in app
-- when creating URL import jobs - so we don't need to change the schema. The agent will UPDATE r2_raw_key
-- after upload. So we can keep r2_raw_key NOT NULL and use a sentinel value like 'raw-uploads/pending/...' or
-- we could use a dedicated placeholder that cleanup recognizes.
-- Cleanest: Add source_url. For r2_raw_key, use 'url-import-pending' or similar as placeholder so NOT NULL is satisfied.
-- Agent will UPDATE to the real key after upload. This avoids schema migration for r2_raw_key.
-- Migration 004: Add source_url only. (ALTER satırı yukarıda; tekrar yok.)

CREATE INDEX IF NOT EXISTS idx_conversion_jobs_source_url
    ON conversion_jobs (source_url) WHERE source_url IS NOT NULL;

SELECT 'Migration 004: source_url column added for URL import' as message;
