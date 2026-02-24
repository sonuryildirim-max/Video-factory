-- 015: V6 Enterprise — processing_profile (işleme modu)
ALTER TABLE conversion_jobs ADD COLUMN processing_profile TEXT DEFAULT 'dengeli';
