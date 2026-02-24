/**
 * Application Configuration
 * BK Video Factory
 * All magic numbers centralized — no hardcoded values in services
 */

/** Video/Upload limits (bytes) — sync with hetner-agent/video_config.py */
export const VIDEO_CONSTANTS = {
    MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024 * 1024,           // 5 GB
    MAX_DIRECT_UPLOAD_BYTES: 100 * 1024 * 1024,            // 100 MB — Worker limit
    JOB_PROCESSING_TIMEOUT_MINUTES: 60,
    JOB_MAX_RETRIES: 3,
    ZOMBIE_TIMEOUT_MINUTES: 45,
};

export const CONFIG = {
    MAIN_SITE: "https://bilgekarga.com.tr",
    /** Worker public URL (presigned redirect, direct upload) — set via env or wrangler vars */
    WORKER_URL: "https://v.bilgekarga.tr",
    /** CDN base URL fallback when R2_PUBLIC_URL / CDN_BASE_URL not set */
    CDN_BASE_URL_FALLBACK: "https://cdn.bilgekarga.tr",
    LOGO_URL: "https://static.ticimax.cloud/31817/uploads/editoruploads/bilgekarga-image/bilge-karga.png",
    MAX_REQUESTS_PER_MINUTE: 60,
    ALLOWED_DOMAINS: ["bilgekarga.com.tr"],
    INDEX_KEY: "sys:links_index",
    LOCK_KEY: "sys:index_lock",
    ALLOWED_ORIGINS: ["https://sales.bilgekarga.tr", "https://bilgekarga.com.tr", "https://v.bilgekarga.tr"],
    SLUG_LENGTH: 7,
    SLUG_CHARSET: "23456789abcdefghjkmnpqrstuvwxyz",
    RESERVED_SLUGS: ["admin", "api", "health", "login", "logs", "favicon", "robots", "assets", "static", "cdn"],
    RATE_LIMITS: {
        SHORTEN_PER_HOUR: 100,
        VERIFY_PER_MINUTE: 10,
        VERIFY_GLOBAL_PER_MINUTE: 10,
        MAX_FAILED_ATTEMPTS: 5,
        BAN_DURATION_SECONDS: 3600,
        VIDEO_PRESIGNED_PER_MINUTE: 30,
        VIDEO_URL_IMPORT_PER_MINUTE: 10,
        /** Strict fallback when DB unavailable — 5 req/min per key */
        DB_FALLBACK_STRICT_PER_MINUTE: 5,
        /** In-memory fallback window in seconds when D1 unavailable (IP-based limits) */
        DB_FALLBACK_WINDOW_SECONDS: 60,
    },
    LOG_RETENTION_DAYS: 0, // 0 = Unlimited (manual cleanup only)
    MAX_LOGS_PER_DAY: 1000,
    // V17: R2 raw immediate delete after processing (anlık temizlik)
    DELETE_RAW_AFTER_PROCESSING: true
};
