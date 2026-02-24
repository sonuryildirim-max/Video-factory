-- 0023: Checkpoint columns for resume-after-interrupt (agent can continue from last stage)
-- processing_checkpoint: 'download_done' | 'converting' | 'upload_done' | NULL
ALTER TABLE conversion_jobs ADD COLUMN processing_checkpoint TEXT;
ALTER TABLE conversion_jobs ADD COLUMN checkpoint_updated_at DATETIME;
