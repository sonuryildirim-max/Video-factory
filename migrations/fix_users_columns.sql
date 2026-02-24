-- Add last_login and last_activity to users table if migrations 013/014 not yet applied
-- Run manually: wrangler d1 execute bk-video-db --remote --command "ALTER TABLE users ADD COLUMN last_login TEXT;"
-- Then: wrangler d1 execute bk-video-db --remote --command "ALTER TABLE users ADD COLUMN last_activity TEXT;"
-- Note: If columns already exist, you will get "duplicate column name" error — that is OK.
ALTER TABLE users ADD COLUMN last_login TEXT;
ALTER TABLE users ADD COLUMN last_activity TEXT;
