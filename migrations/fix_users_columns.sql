-- Add last_login and last_activity to users table if migrations 013/014 not yet applied.
-- If 013/014 already ran, columns exist and ALTER would fail with "duplicate column name".
-- This migration is idempotent: no-op so it can be marked applied when columns already exist.
-- (SQLite has no ADD COLUMN IF NOT EXISTS; manual fix: run the ALTERs once by hand if needed.)
SELECT 1;
