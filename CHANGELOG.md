# Changelog

## [13.0.0] - 2026-02-24 — Folder CRUD & Event Management

### Backend
- **Folder DELETE API**: Added `DELETE /api/folders/:id` route. Prevents deletion of system folders (Public, Raw, Deleted).
- **Folder Assignment**: Updated `JobRepository`, `UploadService`, and `src/routes/videos.js` to support `folder_id` for URL imports and presigned uploads.
- **D1 Schema**: Ensured `folder_id` is properly handled in `conversion_jobs` table.

### Frontend
- **Folder Assignment**: Added a folder selection dropdown to the URL Import modal and the Video Upload page.
- **EventManager**: Implemented `BKEventManager` utility in `video-dashboard.js` for centralized listener management and SPA view cleanup.
- **UI Enhancements**: Added folder delete buttons to the Folders view (excluding system folders).

### Bug Fixes
- Fixed potential null pointer in `requireAuth` when user object is missing.
- Refined URL import validation to handle various platforms more robustly.

### Değiştirilen Dosyalar
| Dosya | Değişiklik |
|-------|------------|
| src/routes/folders.js | DELETE /api/folders/:id endpoint eklendi |
| src/repositories/JobRepository.js | `create` metoduna `folder_id` eklendi |
| src/services/UploadService.js | Upload ve Import metodlarına `folderId` eklendi |
| src/routes/videos.js | Route handler'lara `folder_id` parsing eklendi |
| public/video-dashboard.html | URL Modal'a klasör dropdown eklendi |
| public/video-dashboard.js | EventManager, Folder Populated, URL Import güncellendi |
| public/video-upload.html | Klasör seçimi dropdown eklendi |
| public/video-upload.js | Klasör listesi yükleme ve upload'da gönderme eklendi |

---

## [12.1.0] - 2026-02-23 — R2-D1 Storage Integrity & Admin Cleanup API

### Amaç
R2 object storage ile D1 veritabanı arasındaki senkronizasyon tutarsızlıklarını kökten gider: işlem tamamlandığında raw dosyanın silinmesi garantilenir, sessiz R2 silme hataları kaldırılır ve yönetici paneline R2 denetim endpointi eklenir.

### Backend — JobService.js
- `completeJob`: Raw dosya R2'den silinmeden D1'e `COMPLETED` yazılmıyor (önceden: opsiyonel `CONFIG.DELETE_RAW_AFTER_PROCESSING` ve silent fail).
- `CONFIG.DELETE_RAW_AFTER_PROCESSING` kapısı ve `try/catch` bloğu kaldırıldı; silme başarısız olursa hata fırlatılır, iş yarım kalır.
- `jobRepo.getById` ile `r2_raw_key` D1 güncellemesinden önce alınır; silme → D1 yazma sırası atomik olarak zorlanır.

### Backend — DeletionService.js
- `_deleteR2Keys`: `Promise.allSettled` sonrası başarısız key'ler toplanıp `throw` edilir (önceden sadece loglanıyordu).
- `purgeJob`: `try/catch` ile yutulup yalnızca `logger.warn` yapılan `delBucket.delete(key)` doğrudan `await` olarak açıldı; hata D1 silmesini engeller.

### Backend — Admin API
- **`POST /api/admin/cleanup-r2`** (root only): R2 ile D1 arasındaki uyumsuzlukları tespit edip temizler.
  - `R2_RAW_UPLOADS_BUCKET`: Aktif olmayan (PENDING/PROCESSING/... dışındaki) raw dosyalar silinir.
  - `R2_DELETED_BUCKET`: D1'de `DELETED` kaydı olmayan objeler silinir.
  - Cursor-pagination ile sınırsız bucket boyutu desteklenir.
  - Dönüş: `{ deleted_raw_count, deleted_trash_count }`

### Backend — Route Wiring (index.js)
- `/api/admin/*` rotaları artık `handleAdminRoutes`'a yönlendiriliyor (önceden legacy redirect bloğu tarafından ana siteye gönderiliyordu).
- `handleAdminRoutes` import edildi; legacy redirect listesinden `/api/admin/` kaldırıldı.

### Frontend
- **Monitoring → Kova Gezgini** toolbar'ına "Hayalet Dosyaları Temizle" butonu eklendi.
- `cleanupR2Orphans()`: `POST /api/admin/cleanup-r2` çağırır; sonucu alert ile gösterir.

### Deploy Notları
```bash
# Migration yok, sadece Worker deploy:
npm run deploy
```

### Değiştirilen Dosyalar
| Dosya | Değişiklik |
|-------|------------|
| src/services/JobService.js | Raw silme D1 güncellemesinden önce; CONFIG gate ve silent fail kaldırıldı |
| src/services/DeletionService.js | `_deleteR2Keys` throw; `purgeJob` try/catch kaldırıldı |
| src/routes/admin.js | `POST /api/admin/cleanup-r2` endpoint eklendi |
| src/routes/index.js | Admin route wiring düzeltildi; legacy redirect'ten `/api/admin/` çıkarıldı |
| public/video-dashboard.html | Kova Gezgini toolbar'ına temizleme butonu eklendi |
| public/video-dashboard.js | `cleanupR2Orphans()` fonksiyonu eklendi |

---

## [12.0.0] - 2026-02-23 — Native Video Preset (Enterprise Quality Stack)

### Amaç
Bitrate ve FPS için manuel zorlamalar kaldırıldı; **"giren neyse çıkan o"** (passthrough). Sadece kullanıcı seçimine göre CRF ve preset (slow) uygulanıyor; çözünürlük zaten seçimli, ona dokunulmadı. Sistem Native/Passthrough moduna alındı.

### Neden / Nelere Baktık
- Eski preset’ler (native, ultra, dengeli, kucuk_dosya, web_optimize) CRF sabitleri ve etiket karışıklığına yol açıyordu.
- FFmpeg tarafında `-b:v`, `-maxrate`, `-minrate`, `-bufsize`, `-r`, `-vsync` hiç kullanılmıyordu (bk_agent_v2.py); dokümante edildi, yeni kodda da eklenmedi.
- Arşiv ajanlar (hetner-agent/archive/) eski mantıkla `-b:v` ve `-r` kullanıyor; **canlıda sadece bk_agent_v2.py kullanılıyor**, archive/ referans amaçlı, deploy edilmez.

### Backend — Python Agent (bk_agent_v2.py)
- **FFmpeg:** `-b:v`, `-maxrate`, `-minrate`, `-bufsize`, `-r`, `-vsync` yok; bitrate/FPS kaynaktan miras.
- **Preset:** `crf_10`, `crf_12`, `crf_14`, `crf_16`, `crf_18` → CRF değeri profil adından; `web_opt` / `web_optimize` → `-c:v copy -an -movflags +faststart`.
- **Varsayılan profile:** `crf_14`. Legacy: native→14, ultra→16, dengeli→14, kucuk_dosya→18.
- **Log:** İşlem bitince `"Bitrate/FPS: Kaynak Korundu"`.
- **CONFIG:** `ffmpeg_crf_map` sadece legacy eşleme (native, ultra, dengeli, kucuk_dosya).

### Backend — Node (API / Job)
- **videos.js:** Upload ve URL import body’de `processingProfile || 'crf_14'`.
- **UploadService.js:** `processing_profile: processingProfile || 'crf_14'` (generatePresignedUrl, importFromUrlSync).
- **JobRepository.js:** `processing_profile || 'crf_14'`.
- **dto.js:** `processing_profile: job.processing_profile || 'crf_14'`.

### Frontend
- **video-upload.html:** İşleme Modu dropdown — crf_10, crf_12, crf_14 (varsayılan), crf_16, crf_18, web_opt; etiketler birebir güncellendi.
- **video-upload.js:** Varsayılan ve fallback `crf_14`; `isResolutionLocked()` web_opt ve web_optimize; localStorage için VALID_PROCESSING_PROFILES ile eski değerler crf_14’e yönlendiriliyor.
- **video-dashboard.js:** `getPresetLabel` yeni preset’ler + legacy (native, ultra, dengeli, kucuk_dosya, web_optimize) etiketleri.

### Testler
- **tests/processingProfile.test.js:** Varsayılan crf_14 (generatePresignedUrl, importFromUrlSync); geçerli preset değerleri (crf_10..crf_18, web_opt) job’a aynen yazılıyor.

### Deploy Notları
```bash
npm run test:run    # 40 test (processingProfile dahil)
npm run deploy     # wrangler deploy — bu release’te migration yok
# Hetzner/sunucuda bk_agent_v2.py yeniden başlatılmalı
```

### Değiştirilen Dosyalar
| Dosya | Değişiklik |
|-------|------------|
| hetner-agent/bk_agent_v2.py | Preset crf_XX + web_opt; varsayılan crf_14; legacy map; "Bitrate/FPS: Kaynak Korundu" log |
| hetner-agent/video_config.py | Ref (CONFIG legacy map bk_agent_v2’de) |
| src/routes/videos.js | processingProfile default crf_14 |
| src/services/UploadService.js | processing_profile default crf_14 |
| src/repositories/JobRepository.js | processing_profile default crf_14 |
| src/utils/dto.js | processing_profile default crf_14 |
| public/video-upload.html | Dropdown 6 preset, crf_14 selected |
| public/video-upload.js | crf_14 default, web_opt resolution lock, VALID_PROCESSING_PROFILES |
| public/video-dashboard.js | getPresetLabel yeni + legacy |
| tests/processingProfile.test.js | Yeni — preset birim testleri |

---

## [11.0.0] - 2026-02-22 — R1 Production Hardening (53.75 → 85+)

### 1. Veri Bütünlüğü: FK & Transaction
- **master_schema.sql:** `uploaded_by TEXT REFERENCES users(username) ON DELETE SET DEFAULT` eklendi
- **Schema sırası:** `users` tablosu `conversion_jobs`'dan önce oluşturulacak şekilde taşındı (FK uyumluluğu)
- **JobRepository:** `hardDeleteJob` ve `forceHardDeleteJob` — D1 batch atomic, sıralı silme (job_logs → upload_tokens → conversion_jobs_fts → conversion_jobs) ve try/catch rollback simülasyonu

### 2. Güvenlik: Rate Limit & SQL
- **rateLimit.js:** DB yoksa veya hata durumunda `return true` (bypass) kaldırıldı — in-memory strict fallback (5 req/dakika) uygulanıyor
- **SQL Audit:** Tüm repository'ler zaten %100 parameterized query kullanıyor; whitelist ile dinamik sütun isimleri

### 3. Configuration Management (Magic Number Cleanup)
- **config.js:** `VIDEO_CONSTANTS` — MAX_FILE_SIZE_BYTES (5GB), MAX_DIRECT_UPLOAD_BYTES (100MB), JOB_PROCESSING_TIMEOUT_MINUTES (60), JOB_MAX_RETRIES (3), ZOMBIE_TIMEOUT_MINUTES (45)
- **config.js:** `RATE_LIMITS.DB_FALLBACK_STRICT_PER_MINUTE: 5`
- **VideoService.js:** Hardcoded değerler `VIDEO_CONSTANTS` ile değiştirildi
- **hetner-agent/video_config.py:** Backend config.js ile senkron sabitler; `bk_agent_v2.py` bu config'den okuyor

### 4. Frontend: data-label & Infinite Scroll
- **video-dashboard.js:** Her `<td>` için `data-label` (Thumbnail, Video, İzlenme, Preset, vb.) — mobil Card View
- **dashboard.css:** Mobil Card View `::before` ile `nth-child` yerine `data-label::before` (attr(data-label))
- **Infinite Scroll:** `teardownInfiniteScroll()` — tab değiştiğinde ve `pagehide` ile observer disconnect (memory leak önleme)
- **"Daha Fazla Video Yok" mesajı:** Son sayfada gösteriliyor

### Deploy Notları
```bash
wrangler d1 migrations apply bk-video-db --remote   # Yeni migration varsa
wrangler deploy
```

### Değiştirilen Dosyalar
| Dosya | Değişiklik |
|-------|------------|
| master_schema.sql | uploaded_by FK, users tablo sırası |
| src/repositories/JobRepository.js | Batch atomic, try/catch |
| src/config/config.js | VIDEO_CONSTANTS, DB_FALLBACK |
| src/middleware/rateLimit.js | In-memory fallback, strict limit |
| src/services/VideoService.js | VIDEO_CONSTANTS kullanımı |
| hetner-agent/video_config.py | Yeni — config.js sync sabitler |
| hetner-agent/bk_agent_v2.py | video_config import |
| public/video-dashboard.js | data-label, teardown, end message |
| public/css/dashboard.css | data-label Card View |
| public/video-dashboard.html | infiniteScrollEndMessage div |

---

## [10.0.0] - 2026-02-22 — Mimari Yeniden Doğuş (Architectural Rebirth)

### Faz 1 — Veritabanı
- **Migration 020 (Hard-Integrity):** `user_id` on conversion_jobs, upload_tokens ON DELETE CASCADE, composite indexler
- **JobRepository:** Atomic silme, detaylı hata mesajları, `updateJobFileSizeInput` (R2 HEAD ile doğrulama)

### Faz 2 — Güvenlik
- **AuthService:** Basic Auth kaldırıldı (sadece Cookie + Bearer)
- **VideoService:** SSRF shield (IPv6, cloud metadata blocklist), R2 HEAD ile fileSize doğrulama (%5 tolerans)
- **bk_agent_v2:** SSRF koruması (`getaddrinfo`, metadata host blocklist)

### Faz 3 — Frontend
- **CSS ayrıştırma:** `public/css/dashboard.css` (inline CSS taşındı)
- **Infinite scroll:** API pagination + Intersection Observer
- **Mobil Card View:** etiketlerle (Thumbnail, Video, İzlenme, Preset vb.)

### Faz 4 — Python Agent
- **RAM Graceful shutdown:** 31.5 GB'da yeni iş almama, mevcut işleri bitir, 30 dk timeout
- **Dinamik concurrency:** CPU/RAM'den `max_concurrent` hesaplama (psutil)
- **SIGTERM handler:** graceful shutdown

### Deploy Notları
```bash
wrangler d1 migrations apply bk-video-db --remote
wrangler deploy
```

---

## [9.0.0] - 2026-02-22 — Library Routing, Vimeo UI & DB Integrity

### Adım Adım Fix ve Eklemeler

#### 1. Worker Routing: /library
- `src/routes/index.js`: `GET /library` handler eklendi
- `env.ASSETS.fetch('/video-dashboard.html')` ile aynı içerik sunulur, URL tarayıcıda `/library` kalır

#### 2. Frontend Navigation
- "Tüm Videolar" butonu: `window.location.href='/library'` ile yönlendirme
- `/library` ile açıldığında varsayılan Library sekmesi (tam liste) aktif

#### 3. Vimeo Workspace UI (Corporate SaaS)
- **Sidebar (240px):** Library, Folders, Analytics, Trash — Vimeo stili ince stroke ikonlar
- **Top Bar:** "Library" başlığı + video sayısı badge (örn. "124 Video") + arama + Upload butonu
- **Görsel hiyerarşi:** Arka plan #F8FAFC (Slate-50), kartlar/tablolar beyaz, rounded-lg (8px)
- **Tablo:** `th { white-space: nowrap !important; }` — "SİLİNME" gibi bölünmeler düzeltildi
- **İsim hücresi:** Çift satır: `${original_name}` (kalın) + altında gri `${r2_raw_key}`

#### 4. Veritabanı Fix (SQLITE_CONSTRAINT önleme)
- **JobRepository.forceHardDeleteJob:** Sıralı silme sırası:
  1. `DELETE FROM job_logs WHERE job_id = ?`
  2. `DELETE FROM conversion_jobs_fts WHERE rowid = ?`
  3. `DELETE FROM conversion_jobs WHERE id = ?`

#### 5. Europe/Istanbul Zaman Damgası
- **SecurityLogRepository.insert:** `created_at` artık Europe/Istanbul saat diliminde
- `datetime('now')` (UTC) kaldırıldı
- `new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Istanbul' }).replace(' ', 'T')`

#### 6. Security Logs (Kütüphane işlemleri)
- `LIBRARY_VIEW` — Liste görüntüleme (GET /api/videos)
- `LIBRARY_RENAME` — İsim değiştirme (PATCH /api/videos/:id)
- `LIBRARY_DELETE` — Soft silme (DELETE /api/videos/:id)
- `LIBRARY_PURGE` — Kalıcı silme (POST /api/videos/:id/purge)
- Tümü `status: 'success'` ile loglanır

#### 7. FTS5 Arama Entegrasyonu
- **VideoService.getJobs:** `search` parametresi varsa `JobRepository.searchWithFTS` kullanılır
- LIKE yerine `conversion_jobs_fts` tablosu ile ultra hızlı arama

#### 8. 5 GB Limit Teyidi
- VideoService.js: MAX_BYTES = 5_368_709_120
- video-upload.html: "Maks. 5 GB" metni
- video-upload.js: MAX_FILE_SIZE doğrulandı

### Değiştirilen Dosyalar
| Dosya | Değişiklik |
|-------|------------|
| src/routes/index.js | GET /library handler |
| src/repositories/JobRepository.js | forceHardDeleteJob sıralı silme |
| src/repositories/SecurityLogRepository.js | created_at Europe/Istanbul |
| src/services/VideoService.js | getJobs → FTS5 when search |
| src/routes/videos.js | LIBRARY_* SecurityLog |
| public/video-dashboard.html | Sidebar, Top bar, Slate-50 UI |
| public/video-dashboard.js | Tüm Videolar → /library, badge, search sync |

---

## [7.0.0] - 2026-02-21 — EK Task 3, Dashboard & Timezone

### EK Task 3: Mantık Kalkanı (Logic Shield)
- Native / Sadece Web Optimize seçildiğinde 720p/1080p preset kutuları gizlenir
- Kalite değişmeyeceği modlarda çözünürlük seçimi devre dışı (çelişki engeli)
- İşleme Modu etiketleri: Dengeli (Varsayılan), Sadece Web Optimize (Kalite Değişmez)

### Dashboard
- Tablo sütun genişlikleri, Preset sütunu, iki satırlı video isimlendirme
- Ana ekran 5 video limiti + "Tüm Videoları Yönet" butonu
- Sunucu Son Görülme: UTC timezone, 25 dakika eşiği (ACTIVE/OFFLINE)
- Sunucu kartı grid yerleşimi, min/max width tutarlılığı

### Backend
- UserRepository: last_activity UTC ISO string
- Migrations: 000, 013, 014, 015 (base, last_activity, v12, processing_profile)

### Agent
- Stealth heartbeat: 600s aralıkla arka plan thread (sessiz, hata varsa log)
- processing_profile → dinamik FFmpeg (native/web_optimize → -c copy; CRF → libx264, hqdn3d, tune film)

### video-upload nav
- Dashboard ile aynı nav yapısı (BilgeKarga Video Factory, Videolar, Video Yükle)

---

## [6.0.0] - V6 Enterprise

### Veritabanı
- `processing_profile` (TEXT): native, ultra, dengeli, kucuk_dosya, web_optimize

### UI
- İşleme Modu dropdown (video-upload)
- Tablo: Preset → Kazanç (%), 9 sütun sabit hizalama

### Agent
- `processing_profile`'a göre dinamik FFmpeg (CRF, -c copy, hqdn3d, tune film)

### Dashboard
- Toplam Tasarruf kartı (∑ original_size − file_size)
- Satır bazında kazanç yüzdesi

---

## [8.0.0] - 2026-02-22 — Atomic Hierarchy & Activity Heartbeat

### Hiyerarşi ve Ölümsüz Root
- Root > Admin hiyerarşisi: Admin root kullanıcısını silemez
- Öz-koruma: Root kendi kendini silemez (API + UI)
- Kullanıcı tablosunda Root/Admin rol görselleştirmesi

### Akıllı Kalp Atışı (Activity = Heartbeat)
- "Son görülme" artık sadece /heartbeat'e bağımlı değil
- claim_job, complete, status, fail istekleri last_heartbeat günceller
- Sunucu video işlerken de dashboard'da canlı görünür

### Enterprise SaaS Layout
- Kullanıcı tablosu tam genişlik (full-width)
- Hiyerarşi (Root/Admin) net şekilde görselleştirildi

### Keskin Çözünürlük (9:16 Dikey)
- 1080p: scale=1080:-2 → 1080x1920 (Full HD Dikey)
- 720p: scale=720:-2 → 720x1280 (HD Dikey)
- Suffix -1080/-720 ve resolution kolonu mühürlendi

### Kullanıcı Yönetimi: Son Giriş
- users tablosuna last_login (datetime) eklendi
- Giriş başarılı olduğunda last_login güncellenir
- UI: "Son Giriş" sütunu (22.02.2026 19:44 formatı)

### Backend & Migrations
- Migration 016: system_alerts tablosu (RAM warning/critical alarm)
- Migration 017: conversion_jobs — download_progress, download_bytes, download_total (URL import ilerlemesi)
