-- Fix existing conversion_jobs records: remove /public/ from public_url
-- Run: wrangler d1 execute bk-video-db --remote --file=fix_public_urls.sql
UPDATE conversion_jobs SET public_url = REPLACE(public_url, '/public/', '/') WHERE public_url LIKE '%/public/%';
