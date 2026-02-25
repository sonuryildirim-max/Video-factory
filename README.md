<p align="center">
  <img src="https://img.shields.io/badge/Video_Factory-Edge_Processing-0a0a0a?style=for-the-badge&logo=cloudflare&logoColor=F38020&labelColor=1a1a2e" alt="Video Factory" />
</p>

<h1 align="center">⚡ Video Factory</h1>

<p align="center">
  <strong>Serverless Video Processing Infrastructure at the Edge</strong>
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
  <a href="#"><img src="https://img.shields.io/github/stars/sonuryildirim-max/Video-factory?style=flat-square&color=gold" alt="Stars" /></a>
  <a href="#"><img src="https://img.shields.io/github/issues/sonuryildirim-max/Video-factory?style=flat-square&color=red" alt="Issues" /></a>
  <a href="#"><img src="https://img.shields.io/github/last-commit/sonuryildirim-max/Video-factory?style=flat-square&color=brightgreen" alt="Last Commit" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Built_with-Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" /></a>
  <a href="#"><img src="https://img.shields.io/badge/deploy-production-00C853?style=flat-square&logo=github-actions&logoColor=white" alt="Deploy Status" /></a>
</p>

<p align="center">
  E-ticaret ve içerik üretimi için tasarlanmış, uçtan uca serverless video işleme altyapısı.<br/>
  Cloudflare Edge üzerinde yükleme, FFmpeg ile otomatik transkod, küresel CDN dağıtımı — tek pipeline'da.<br/>
  <em>"R2 > Database" felsefesi: depolama katmanı gerçeğin tek kaynağı.</em>
</p>

---

## 🏗 Mimari Genel Bakış

Sistem üç ana katmandan oluşur: **Edge** (Cloudflare Workers, R2, D1), **Processing** (Hetzner Python Agent + FFmpeg) ve **Monitoring** (Samaritan / Telegram). Tüm bileşenler arasındaki veri akışı aşağıda gösterilmektedir.

```mermaid
flowchart LR
    subgraph Client["🖥 Client / Dashboard"]
        Browser["Browser SPA"]
    end

    subgraph Edge["☁ Cloudflare Edge"]
        direction TB
        Worker["Workers\n(API Gateway)"]
        Auth["Auth\nMiddleware"]
        Cron["Cron\nScheduler"]
        D1[("D1 Database\n(State Mgmt)")]
        R2Raw[("R2_RAW\nBucket")]
        R2Public[("R2_PUBLIC\nBucket")]
    end

    subgraph Compute["🖧 Hetzner Agent"]
        Agent["Python Agent\n(FFmpeg Node)"]
        FFmpeg["FFmpeg\nTranscoder"]
    end

    subgraph Notify["📡 Monitoring"]
        Telegram["Telegram\nSamaritan Bot"]
    end

    subgraph Consumers["🌍 End Users"]
        CDN["CDN / Direct\nMP4 URL"]
        Ecom["Ticimax &\nE-commerce"]
    end

    Browser -- "Upload\nRequest" --> Worker
    Worker --> Auth
    Auth --> Worker
    Worker -- "Presigned URL" --> R2Raw
    Worker -- "Job Insert" --> D1
    Worker -- "Wakeup Signal" --> Agent
    Cron -- "Lifecycle\nTrigger" --> Worker
    Agent -- "Job Poll" --> Worker
    Worker -- "Pending Jobs" --> Agent
    Agent -- "Fetch Raw" --> R2Raw
    Agent --> FFmpeg
    FFmpeg -- "Processed\nUpload" --> R2Public
    Agent -- "Status Update" --> D1
    Agent -- "ASSET ACQUIRED" --> Telegram
    Worker -- "LOSS OF SIGNAL" --> Telegram
    Cron -- "Nuke Protocol" --> R2Raw
    R2Public -- "CDN URL" --> CDN
    CDN --> Ecom
```

---

## 🔄 İşleme Pipeline'ı

Bir video dosyasının sisteme girişinden nihai CDN dağıtımına kadar geçtiği tüm adımlar:

```mermaid
flowchart TD
    A["📤 1. Kullanıcı Upload\nMultipart → R2_RAW"]:::upload
    B["💾 2. D1 Job Kaydı\nstatus: PENDING"]:::db
    C["📡 3. Wakeup Sinyali\nWorker → Hetzner Agent"]:::signal
    D["🔍 4. Agent Job Polling\nD1'den bekleyen iş çekme"]:::agent
    E["⬇ 5. Raw Video Fetch\nR2_RAW'dan indirme"]:::agent
    F["🎬 6. FFmpeg Transcoding\nResolution • Codec • Optimization"]:::process
    G["⬆ 7. İşlenmiş Dosya\n→ R2_PUBLIC"]:::upload
    H["✅ 8. D1 Güncelleme\nstatus: COMPLETED\nfile sizes • duration"]:::db
    I["🌐 9. CDN URL Üretimi\nPublic erişim aktif"]:::cdn
    J["🧹 10. Nuke Protokolü\nR2_RAW cleanup — 1 saat"]:::nuke

    K["❌ Hata Yakalama\nRetry mekanizması aktif"]:::error
    L["📱 Telegram Bildirim\nHata detayları gönderilir"]:::error

    A --> B --> C --> D --> E --> F
    F --> G --> H --> I
    H --> J

    F -. "FFmpeg Error" .-> K
    E -. "Download Fail" .-> K
    G -. "Upload Fail" .-> K
    K --> L
    K -. "retry_count < 3" .-> D

    classDef upload fill:#1a73e8,stroke:#1557b0,color:#fff
    classDef db fill:#7c4dff,stroke:#6200ea,color:#fff
    classDef signal fill:#ff6d00,stroke:#e65100,color:#fff
    classDef agent fill:#00bfa5,stroke:#00897b,color:#fff
    classDef process fill:#ffab00,stroke:#ff8f00,color:#000
    classDef cdn fill:#00c853,stroke:#00a152,color:#fff
    classDef nuke fill:#546e7a,stroke:#37474f,color:#fff
    classDef error fill:#d32f2f,stroke:#b71c1c,color:#fff
```

---

## 📐 Bileşen Mimarisi

### 4a. Cloudflare Workers — Route & Middleware Zinciri

Tek Worker hem API'yi hem SPA'yı sunar. 15 öncelik seviyeli route zinciri:

```mermaid
flowchart LR
    Req["Incoming\nRequest"]:::req
    CORS["CORS\nPreflight"]:::mw
    AuthMW["Auth\nMiddleware"]:::mw
    Rate["Rate\nLimiter"]:::mw
    Route["Route\nHandler"]:::route
    Service["Service\nLayer"]:::service
    Repo["Repository"]:::repo
    D1DB[("D1")]:::db
    R2[("R2")]:::db

    Req --> CORS --> AuthMW --> Rate --> Route
    Route --> Service --> Repo
    Repo --> D1DB
    Repo --> R2

    classDef req fill:#263238,stroke:#263238,color:#fff
    classDef mw fill:#ff6f00,stroke:#e65100,color:#fff
    classDef route fill:#1565c0,stroke:#0d47a1,color:#fff
    classDef service fill:#6a1b9a,stroke:#4a148c,color:#fff
    classDef repo fill:#2e7d32,stroke:#1b5e20,color:#fff
    classDef db fill:#37474f,stroke:#263238,color:#fff
```

**Katmanlı Mimari:**

| Katman | Sorumluluk | Dosya(lar) |
|--------|-----------|------------|
| **Middleware** | CORS, Auth (Bearer/Cookie), Rate Limit, IP Ban | `src/middleware/` |
| **Routes** | HTTP dispatch, request validation, response format | `src/routes/` (14 modül) |
| **Services** | Business logic, orchestration | `src/services/` (12 modül) |
| **Repositories** | D1/R2 CRUD, query builder | `src/repositories/` (15 modül) |

---

### 4b. Hetzner Agent — State Machine

Agent'ın tam yaşam döngüsü ve hata kurtarma mekanizması:

```mermaid
stateDiagram-v2
    [*] --> IDLE : Başlangıç

    IDLE --> WAKEUP_RECEIVED : POST /wakeup\nsinyali alındı
    IDLE --> IDLE : Uyku stratejisi\n60s→3600s→21600s→86400s

    WAKEUP_RECEIVED --> JOB_POLLING : D1'e bağlantı

    JOB_POLLING --> PROCESSING : Pending job bulundu
    JOB_POLLING --> IDLE : Bekleyen iş yok

    PROCESSING --> UPLOADING : FFmpeg başarılı
    PROCESSING --> ERROR : FFmpeg hatası

    UPLOADING --> HEARTBEAT : R2_PUBLIC yükleme tamam
    UPLOADING --> ERROR : Upload hatası

    HEARTBEAT --> IDLE : Durum bildirimi gönderildi\nSamaritan ASSET ACQUIRED

    ERROR --> RETRY : retry_count < 3
    ERROR --> FAILED : retry_count >= 3

    RETRY --> JOB_POLLING : Yeniden deneme

    FAILED --> IDLE : Hata loglandı\nTelegram bildirim
```

**Agent Konfigürasyonu:**

| Parametre | Varsayılan | Açıklama |
|-----------|-----------|----------|
| Concurrency | 4 thread | `ThreadPoolExecutor` paralel iş |
| Uyku Stratejisi | Active→Idle→Deep1→Deep2 | 60s → 3600s → 21600s → 86400s |
| Heartbeat | 5 dk | Samaritan ping aralığı |
| Wakeup Port | 8080 | `POST /wakeup` (Bearer auth) |

---

### 4c. Nuke Protokolü — Otomatik Temizleme

Maliyet optimizasyonu için R2_RAW bucket'taki tamamlanmış işlerin ham dosyaları otomatik silinir:

```mermaid
flowchart TD
    Cron["⏰ Cron Trigger\nHer 15 dakika"]:::cron
    Scan["🔍 R2_RAW Tarama\nTüm raw-uploads/ prefix"]:::scan
    Check["📋 Job Durum Kontrolü\nD1: status = COMPLETED\n+ completed_at > 1 saat"]:::check
    Queue["📝 Silme Kuyruğu\nToplu silme listesi"]:::queue
    Delete["🗑 R2 Silme\nBatch delete işlemi"]:::delete
    Verify["✅ Doğrulama\nR2_PUBLIC'te dosya mevcut mu"]:::verify
    Update["💾 D1 Güncelleme\nraw_key temizlendi"]:::update
    Skip["⏭ Atla\nHenüz 1 saat dolmamış\nveya işlem devam ediyor"]:::skip

    Cron --> Scan --> Check
    Check -- "Koşullar karşılandı" --> Verify
    Check -- "Koşullar karşılanmadı" --> Skip
    Verify -- "Public dosya mevcut" --> Queue
    Verify -- "Public dosya YOK" --> Skip
    Queue --> Delete --> Update

    classDef cron fill:#ff6f00,stroke:#e65100,color:#fff
    classDef scan fill:#1565c0,stroke:#0d47a1,color:#fff
    classDef check fill:#7c4dff,stroke:#6200ea,color:#fff
    classDef queue fill:#546e7a,stroke:#37474f,color:#fff
    classDef delete fill:#d32f2f,stroke:#b71c1c,color:#fff
    classDef verify fill:#00c853,stroke:#00a152,color:#fff
    classDef update fill:#00bfa5,stroke:#00897b,color:#fff
    classDef skip fill:#9e9e9e,stroke:#757575,color:#fff
```

---

### 4d. Veri Modeli — Entity Relationship

D1 tablolarının ve R2 bucket'larının ilişkisel yapısı:

```mermaid
erDiagram
    users {
        int id PK
        text username UK
        text password_hash
        text role
        text api_token UK
    }

    conversion_jobs {
        int id PK
        text original_name
        text clean_name
        text r2_raw_key
        text public_url
        text quality
        text status
        int folder_id FK
        text uploaded_by FK
    }

    folders {
        int id PK
        text name
        int is_system
    }

    job_logs {
        int id PK
        int job_id FK
        text log_level
        text message
    }

    worker_heartbeats {
        int id PK
        text worker_id
        int current_job_id FK
        text status
    }

    daily_statistics {
        int id PK
        date date UK
        int total_jobs
        int completed_jobs
    }

    security_logs {
        int id PK
        text ip
        text action
        text created_by FK
    }

    app_logs {
        int id PK
        text action
        int job_id FK
        text entry_hash
    }

    users ||--o{ conversion_jobs : "uploaded_by"
    users ||--o{ security_logs : "created_by"
    folders ||--o{ conversion_jobs : "folder_id"
    conversion_jobs ||--o{ job_logs : "job_id"
    conversion_jobs ||--o{ worker_heartbeats : "current_job_id"
    conversion_jobs ||--o{ app_logs : "job_id"
```

---

## 🧱 Altyapı Planı

### Servis Karşılaştırma Tablosu

| Bileşen | Kullanılan Servis | Alternatif | Neden Bu Seçim |
|---------|:----------------:|:----------:|----------------|
| **API Gateway** | Cloudflare Workers | AWS Lambda + API GW | 0 ms cold start, küresel edge dağıtımı, Workers Free Tier: 100K istek/gün |
| **Object Storage** | Cloudflare R2 | AWS S3 | Sıfır egress ücreti — video dağıtımında %60-80 maliyet düşüşü |
| **Database** | Cloudflare D1 | PlanetScale, Turso | Workers binding ile <1 ms latency, SQLite uyumluluğu, FTS5 desteği |
| **Video Processing** | Hetzner VPS + FFmpeg | AWS MediaConvert, Mux | €4.5/ay'dan dedike CPU; MediaConvert dk başı ücret, FFmpeg tam kontrol |
| **CDN** | Cloudflare CDN (R2 custom domain) | AWS CloudFront | R2 egress = $0, otomatik edge cache, custom domain desteği |
| **Monitoring** | Telegram Bot (Samaritan) | PagerDuty, Datadog | Ücretsiz, anlık mobil bildirim, webhook entegrasyonu, komut desteği |
| **CI/CD** | GitHub Actions + Wrangler | GitLab CI, CircleCI | Native Cloudflare deploy, D1 migration, ücretsiz tier yeterli |

### Maliyet Optimizasyon Tablosu

| Senaryo | Aylık Video | Aylık İstek (API + CDN) | Tahmini Maliyet | Optimizasyon Notları |
|---------|:-----------:|:----------------------:|:---------------:|---------------------|
| **Starter** | 1.000 video | ~50K API + 500K CDN | **~$9/ay** | Workers Free (100K/gün), R2 Free (10 GB), Hetzner CAX11 €4.5, D1 Free (5M read) |
| **Growth** | 10.000 video | ~500K API + 5M CDN | **~$32/ay** | Workers Paid ($5), R2 ~$7 (100 GB storage), Hetzner CAX21 €8.5, D1 $5 |
| **Scale** | 100.000 video | ~5M API + 50M CDN | **~$145/ay** | Workers Paid ($5 + overage), R2 ~$45 (1 TB), Hetzner CAX31 €15, Nuke Protocol ile R2_RAW %0 kalıcı |

> **Kıyaslama:** Aynı 10K video/ay hacmi Mux'ta ~$500/ay, AWS MediaConvert + S3 + CloudFront'ta ~$280/ay'a mal olur. Video Factory bu maliyeti **%90'a kadar** düşürür.

---

## 🚀 Hızlı Başlangıç

### Gereksinimler

| Araç | Minimum Versiyon | Açıklama |
|------|:----------------:|----------|
| Node.js | 18+ | Worker geliştirme ortamı |
| Wrangler CLI | 3.0+ | `npm i -g wrangler` |
| Python | 3.10+ | Hetzner Agent |
| FFmpeg | 6.0+ | Video transcoding |
| Cloudflare Hesabı | — | Workers, R2, D1 erişimi |
| Hetzner VPS | CAX11+ | ARM veya x86, min 4 GB RAM |

### Ortam Değişkenleri

```bash
# .dev.vars (Cloudflare Worker — lokal geliştirme)
BK_BEARER_TOKEN=your_secure_bearer_token
HETNER_API_KEY=your_agent_api_key
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
TELEGRAM_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_admin_chat_id
SAMARITAN_SECRET=your_samaritan_secret

# .env (Hetzner Agent)
BK_API_URL=https://your-domain.com
BK_BEARER_TOKEN=same_bearer_token_as_worker
TELEGRAM_TOKEN=same_telegram_bot_token
TELEGRAM_CHAT_ID=same_admin_chat_id
```

### Adım 1 — Cloudflare Altyapısı

```bash
# Wrangler ile giriş yapın
wrangler login

# D1 veritabanı oluşturun
wrangler d1 create bk-video-db
# Çıktıdaki database_id'yi wrangler.toml'a yazın

# R2 bucket'ları oluşturun
wrangler r2 bucket create bk-video-raw
wrangler r2 bucket create bk-video-public
wrangler r2 bucket create bk-video-deleted

# R2 CORS politikası uygulayın
wrangler r2 bucket cors put bk-video-raw --rules ./r2-cors.json
wrangler r2 bucket cors put bk-video-public --rules ./r2-cors.json

# D1 migration'ları çalıştırın
wrangler d1 migrations apply bk-video-db

# Secret'ları tanımlayın
wrangler secret put BK_BEARER_TOKEN
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put TELEGRAM_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put SAMARITAN_SECRET
```

### Adım 2 — Worker Deploy

```bash
# Lokal geliştirme
npm install
npm run dev

# Production deploy
npm run deploy
```

### Adım 3 — Hetzner Agent Kurulumu

```bash
# Agent dosyalarını sunucuya kopyalayın
scp -r hetner-agent/ root@your-server:/opt/video-factory/

# Sunucuya bağlanın
ssh root@your-server

# Bağımlılıkları kurun
cd /opt/video-factory
pip install -r requirements.txt
apt install -y ffmpeg

# .env dosyasını oluşturun
cp .env.example .env
nano .env  # Değerleri doldurun

# Agent'ı başlatın (systemd ile)
cat > /etc/systemd/system/video-agent.service << 'EOF'
[Unit]
Description=Video Factory Processing Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/video-factory
ExecStart=/usr/bin/python3 bk_agent_v2.py
Restart=always
RestartSec=10
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable video-agent
systemctl start video-agent
```

### Adım 4 — Telegram Bot Bağlantısı

```bash
# BotFather'dan token alın, ardından webhook'u ayarlayın:
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://your-domain.com/api/telegram/webhook"

# Doğrulama:
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

---

## 📡 API Referansı

### Kimlik Doğrulama

```http
POST /api/login
Content-Type: application/json
```

| Parametre | Tip | Zorunlu | Açıklama |
|-----------|-----|:-------:|----------|
| `username` | string | ✅ | Kullanıcı adı |
| `password` | string | ✅ | Şifre |

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "username": "admin",
    "role": "root"
  }
}
```

---

### Video Yükleme (Presigned URL)

```http
POST /api/videos/upload/presigned
Authorization: Bearer {token}
Content-Type: application/json
```

| Parametre | Tip | Zorunlu | Açıklama |
|-----------|-----|:-------:|----------|
| `filename` | string | ✅ | Orijinal dosya adı |
| `quality` | string | ✅ | `720p` veya `1080p` |
| `folder_id` | integer | ❌ | Hedef klasör ID |
| `tags` | string | ❌ | Virgülle ayrılmış etiketler |
| `project_name` | string | ❌ | Proje adı |

**Response:**
```json
{
  "success": true,
  "jobId": 142,
  "uploadUrl": "https://bk-video-raw.r2.cloudflarestorage.com/raw-uploads/...",
  "uploadToken": "tok_abc123...",
  "method": "PUT"
}
```

---

### Upload Tamamlama

```http
POST /api/videos/upload/complete
Authorization: Bearer {token}
Content-Type: application/json
```

| Parametre | Tip | Zorunlu | Açıklama |
|-----------|-----|:-------:|----------|
| `uploadToken` | string | ✅ | Presigned aşamasından alınan token |
| `jobId` | integer | ✅ | İş ID |

**Response:**
```json
{
  "success": true,
  "job": {
    "id": 142,
    "status": "PENDING",
    "clean_name": "urun-tanitim-video"
  }
}
```

---

### URL'den Video Import

```http
POST /api/videos/upload/from-url
Authorization: Bearer {token}
Content-Type: application/json
```

| Parametre | Tip | Zorunlu | Açıklama |
|-----------|-----|:-------:|----------|
| `url` | string | ✅ | Kaynak video URL'si |
| `quality` | string | ✅ | `720p` veya `1080p` |
| `folder_id` | integer | ❌ | Hedef klasör |

**Response:**
```json
{
  "success": true,
  "jobId": 143,
  "message": "URL import başlatıldı"
}
```

---

### Video Listeleme

```http
GET /api/videos?status=COMPLETED&folder_id=2&page=1&limit=20
Authorization: Bearer {token}
```

| Query Param | Tip | Varsayılan | Açıklama |
|-------------|-----|:----------:|----------|
| `status` | string | — | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |
| `folder_id` | integer | — | Klasör filtresi |
| `page` | integer | `1` | Sayfa numarası |
| `limit` | integer | `20` | Sayfa başına sonuç |
| `search` | string | — | FTS5 arama (isim, tag, proje) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 142,
      "clean_name": "urun-tanitim-video",
      "status": "COMPLETED",
      "public_url": "https://cdn.bilgekarga.tr/videos/2025/02/142_urun-tanitim-video.mp4",
      "thumbnail_url": "https://cdn.bilgekarga.tr/thumbnails/142/urun-tanitim-video-thumb.jpg",
      "file_size_output": 8456789,
      "duration": 45,
      "compression_percentage": 62.3
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 87 }
}
```

---

### Job Claim (Agent)

```http
POST /api/jobs/claim
Authorization: Bearer {agent_token}
Content-Type: application/json
```

| Parametre | Tip | Zorunlu | Açıklama |
|-----------|-----|:-------:|----------|
| `worker_id` | string | ✅ | Agent tanımlayıcısı |

**Response:**
```json
{
  "success": true,
  "job": {
    "id": 142,
    "r2_raw_key": "raw-uploads/1708891234-142-video.mp4",
    "quality": "1080p",
    "clean_name": "urun-tanitim-video"
  }
}
```

---

### Hata Kodları

| Kod | Açıklama |
|:---:|----------|
| `400` | Eksik veya hatalı parametre |
| `401` | Geçersiz veya eksik Bearer token |
| `403` | Yetkisiz erişim (rol yetersiz) |
| `404` | Kaynak bulunamadı |
| `409` | Çakışma (duplicate slug, aktif upload) |
| `413` | Dosya boyutu limiti aşıldı (5 GB) |
| `429` | Rate limit aşıldı |
| `500` | Sunucu hatası — Samaritan otomatik bildirim gönderir |

---

## 🚢 Deployment Mimarisi

Production CI/CD pipeline akışı:

```mermaid
flowchart LR
    Push["GitHub\nPush"]:::git
    Actions["GitHub\nActions"]:::ci
    Wrangler["Wrangler\nDeploy"]:::deploy
    Migration["D1\nMigration"]:::db
    CORS["R2 CORS\nConfig"]:::config
    AgentDeploy["Agent\nDeploy\n(SSH)"]:::agent
    Health["Health\nCheck"]:::health
    Notify["Telegram\nDeploy\nNotification"]:::notify

    Push --> Actions
    Actions --> Wrangler
    Wrangler --> Migration
    Migration --> CORS
    CORS --> AgentDeploy
    AgentDeploy --> Health
    Health --> Notify

    classDef git fill:#24292e,stroke:#1b1f23,color:#fff
    classDef ci fill:#2088ff,stroke:#0366d6,color:#fff
    classDef deploy fill:#f38020,stroke:#e06d10,color:#fff
    classDef db fill:#7c4dff,stroke:#6200ea,color:#fff
    classDef config fill:#00bfa5,stroke:#00897b,color:#fff
    classDef agent fill:#546e7a,stroke:#37474f,color:#fff
    classDef health fill:#00c853,stroke:#00a152,color:#fff
    classDef notify fill:#0088cc,stroke:#006699,color:#fff
```

**Deploy Komutları:**

```bash
# Worker deploy (wrangler.toml production)
wrangler deploy

# D1 migration (otomatik)
wrangler d1 migrations apply bk-video-db

# Agent güncelleme
ssh root@agent-server "cd /opt/video-factory && git pull && systemctl restart video-agent"
```

---

## 📊 İzleme ve Gözlemlenebilirlik

Samaritan sistemi 7 farklı alarm tipi ile tam gözlemlenebilirlik sağlar. Tüm bildirimler Telegram üzerinden anlık iletilir.

### İş Tamamlandı Bildirimi
```
🎬 ASSET ACQUIRED
[ > ] FILE: urun-tanitim-2025.mp4
[ > ] QUALITY: 1080p
[ > ] INPUT: 245 MB → OUTPUT: 92 MB (↓ %62.4)
[ > ] DURATION: 45s
[ > ] PROCESSING: 2m 18s
> STATUS: READY FOR DEPLOYMENT.
> CDN: https://cdn.bilgekarga.tr/videos/2025/02/142_urun-tanitim.mp4
```

### Hata Bildirimi
```
🔺 SYSTEM ANOMALY DETECTED
[ \ ] TARGET NODE: Cloudflare Edge Worker
[ ! ] CRITICAL ERROR: R2 upload timeout after 3 retries
[ \ ] JOB_ID: 142
[ \ ] STAGE: UPLOADING
> STATUS: SYSTEM OVERRIDE NEEDED. SEARCHING FOR ADMIN... 🔎
```

### Nuke Protokolü Raporu
```
🧹 NUKE PROTOCOL EXECUTED
[ > ] SCANNED: 47 raw files
[ > ] ELIGIBLE: 12 files (completed > 1 hour)
[ > ] DELETED: 12 files
[ > ] FREED: 3.2 GB storage
[ > ] SKIPPED: 35 files (in-progress or recent)
> STATUS: R2_RAW OPTIMIZED. COST SAVINGS APPLIED.
```

### Sinyal Kaybı Alarmı
```
🔻 CRITICAL ALERT: LOSS OF SIGNAL
[ \ ] TARGET NODE: Primary Processing Core (Hetzner)
[ ! ] STATUS: MISSING 2 CONSECUTIVE HEARTBEATS.
[ \ ] LAST SEEN: 2025-02-14T08:23:00Z (14 min ago)
> DIRECTIVE: NODE PRESUMED DEAD. INITIATING ADMIN WAKE-UP ALARM! 🚨
```

### Günlük Sistem Özeti
```
📊 DAILY SYSTEM REPORT — 2025-02-14
━━━━━━━━━━━━━━━━━━━━
[ > ] PROCESSED: 127 videos
[ > ] SUCCESS RATE: 98.4% (125/127)
[ > ] TOTAL INPUT: 31.2 GB
[ > ] TOTAL OUTPUT: 11.8 GB (↓ %62.2 avg compression)
[ > ] AVG PROCESSING: 1m 42s
[ > ] STORAGE FREED (Nuke): 28.4 GB
[ > ] ACTIVE AGENT UPTIME: 23h 58m
━━━━━━━━━━━━━━━━━━━━
> STATUS: ALL SYSTEMS NOMINAL ✅
```

---

## 🗺 Yol Haritası

```mermaid
timeline
    title Video Factory — Ürün Yol Haritası 2025

    section Q1 2025 ✅
        Core Infrastructure : Edge API & R2 dual-bucket
                            : FFmpeg Agent & Samaritan
                            : Nuke Protocol & Cron lifecycle
                            : Dashboard SPA & Auth system

    section Q2 2025
        Multi-tenant Support : Tenant isolation (D1 + R2 prefix)
                             : API key per tenant
                             : Usage metering & billing hooks

    section Q3 2025
        AI-powered Features : Workers AI — auto video tagging
                            : Thumbnail quality scoring
                            : Content moderation (NSFW filter)
                            : Vectorize — semantic video search

    section Q4 2025
        White-label SaaS : Self-service onboarding panel
                         : Custom domain per tenant
                         : Webhook system (job events)
                         : Stripe billing integration
```

---

## 🤝 Katkıda Bulunma

Projeye katkıda bulunmak istiyorsanız:

1. Bu repository'yi fork edin
2. Feature branch oluşturun (`git checkout -b feature/amazing-feature`)
3. Değişikliklerinizi commit edin (`git commit -m 'feat: add amazing feature'`)
4. Branch'inizi push edin (`git push origin feature/amazing-feature`)
5. Pull Request açın

Detaylı katkı rehberi için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın.

---

## 📄 Lisans

Bu proje [MIT License](LICENSE) ile lisanslanmıştır.

```
MIT License

Copyright (c) 2025 Video Factory

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

---

<p align="center">
  <sub>Mühendislik ekibi tarafından 🇹🇷 İstanbul'dan tasarlandı ve inşa edildi.</sub><br/>
  <sub>Powered by Cloudflare Workers · R2 · D1 · FFmpeg</sub>
</p>
