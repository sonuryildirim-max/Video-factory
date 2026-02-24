-- 018: Folder management for BK Video Factory
-- Sistem klasörleri: Public (1), Raw (2), Trash (3)
-- Kullanıcı klasörleri: is_system=0

CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sistem klasörleri (silinemez, yeniden adlandırılamaz)
INSERT OR IGNORE INTO folders (id, name, is_system, created_at) VALUES
    (1, 'Public', 1, datetime('now')),
    (2, 'Raw', 1, datetime('now')),
    (3, 'Trash', 1, datetime('now'));

-- conversion_jobs'a folder_id ekle; REFERENCES folders(id) ON DELETE SET NULL
ALTER TABLE conversion_jobs ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;

-- Mevcut kayıtları statüye göre eşleştir
UPDATE conversion_jobs SET folder_id = 1 WHERE status = 'COMPLETED' AND (deleted_at IS NULL) AND (folder_id IS NULL);
UPDATE conversion_jobs SET folder_id = 2 WHERE status IN ('PENDING', 'PROCESSING', 'DOWNLOADING', 'CONVERTING', 'UPLOADING', 'URL_IMPORT_QUEUED') AND (deleted_at IS NULL) AND (folder_id IS NULL);
UPDATE conversion_jobs SET folder_id = 3 WHERE deleted_at IS NOT NULL OR status = 'DELETED';
