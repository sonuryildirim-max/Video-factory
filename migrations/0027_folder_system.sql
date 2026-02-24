-- 0027: Klasör sistemi — tablo ve kolon 018_folders.sql ile oluşturulmuş durumdadır.
-- Bu migrasyon safe no-op olarak referans amaçlı tutulmaktadır.
CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- NOT: folder_id sütunu 018_folders.sql tarafından conversion_jobs'a eklendi.
-- ALTER TABLE yeniden çalıştırılmaz (SQLite duplicate column hatası verir).
