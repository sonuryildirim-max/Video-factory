-- Migration 005: D1 Single Source — url_hash_cache for link deduplication
-- D1 becomes the single source of truth for links; KV used only for ephemeral data.

-- url_hash_cache: Same URL -> same slug (deduplication for auto-generated slugs)
CREATE TABLE IF NOT EXISTS url_hash_cache (
    url_hash TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_url_hash_cache_slug ON url_hash_cache(slug);

-- Indexes for links table (if not already present)
CREATE INDEX IF NOT EXISTS idx_links_created ON links(created);
CREATE INDEX IF NOT EXISTS idx_links_clicks ON links(clicks);

SELECT 'Migration 005: url_hash_cache and link indexes created' as message;
