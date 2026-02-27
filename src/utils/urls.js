/**
 * R2 URL utilities — central URL generation for raw and public buckets
 */

import { ValidationError, BK_ERROR_CODES } from './errors.js';

/**
 * Build raw bucket download URL for agent to fetch file.
 * @param {string} r2RawKey - R2 raw bucket key (e.g. raw-uploads/timestamp-file.mp4)
 * @param {Object} env - Worker env (R2_RAW_PUBLIC_URL, CDN_BASE_URL)
 * @returns {string|null} Full URL or null if key invalid
 */
export function buildRawDownloadUrl(r2RawKey, env) {
    if (!r2RawKey || typeof r2RawKey !== 'string' || r2RawKey === 'url-import-pending') {
        return null;
    }
    const base = env?.R2_RAW_PUBLIC_URL || env?.CDN_BASE_URL || 'https://cdn.bilgekarga.tr';
    const trimmed = base.replace(/\/$/, '');
    const key = r2RawKey.startsWith('/') ? r2RawKey.slice(1) : r2RawKey;
    return `${trimmed}/${key}`;
}

/**
 * PLAY_01: public_url başında protokol yoksa https:// ekler (MEDIA_ELEMENT_ERROR önlemi).
 * @param {string} url - Tam URL veya path (örn. cdn.bilgekarga.tr/videos/x.mp4)
 * @returns {string} https:// ile başlayan URL veya boş string
 */
export function normalizePublicUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const s = url.trim();
    if (!s) return '';
    if (s.startsWith('https://') || s.startsWith('http://')) return s;
    return 'https://' + s.replace(/^\/+/, '');
}

/**
 * Build CDN public URL for processed video or thumbnail.
 * @param {string} keyOrPath - R2 key (e.g. videos/2026/123_video.mp4) or full path
 * @param {string} cdnBase - CDN base URL (default https://cdn.bilgekarga.tr)
 * @returns {string} Full public URL
 */
export function buildPublicUrl(keyOrPath, cdnBase = 'https://cdn.bilgekarga.tr') {
    if (!keyOrPath || typeof keyOrPath !== 'string') return '';
    const base = (cdnBase || 'https://cdn.bilgekarga.tr').replace(/\/$/, '');
    const path = keyOrPath.startsWith('http') ? keyOrPath : keyOrPath.startsWith('/') ? keyOrPath.slice(1) : keyOrPath;
    return path.startsWith('http') ? path : `${base}/${path}`;
}

/**
 * Validate R2 key for path traversal and safe prefix.
 * @param {string} key - R2 object key
 * @param {string[]} allowedPrefixes - e.g. ['raw-uploads/'] or ['videos/', 'thumbnails/']
 * @throws {import('./errors.js').ValidationError} if invalid
 */
export function validateR2Key(key, allowedPrefixes) {
    if (typeof key !== 'string' || !key.trim()) {
        throw new ValidationError('R2 key must be a non-empty string', [
            { field: 'key', error: 'Required string', error_code: BK_ERROR_CODES.MISSING_FIELD },
        ]);
    }
    const k = key.trim();
    const validPrefix = allowedPrefixes.some(p => k.startsWith(p));
    if (!validPrefix) {
        throw new ValidationError(`R2 key must start with one of: ${allowedPrefixes.join(', ')}`, [
            { field: 'key', error: 'Invalid prefix', error_code: BK_ERROR_CODES.INVALID_FIELD_VALUE },
        ]);
    }
    if (k.includes('..')) {
        throw new ValidationError('R2 key must not contain path traversal', [
            { field: 'key', error: 'Path traversal not allowed', error_code: BK_ERROR_CODES.INVALID_FIELD_VALUE },
        ]);
    }
    if (!/^[a-zA-Z0-9_./-]+$/.test(k)) {
        throw new ValidationError('R2 key contains invalid characters', [
            { field: 'key', error: 'Invalid characters', error_code: BK_ERROR_CODES.INVALID_FIELD_VALUE },
        ]);
    }
    if (k.length > 512) {
        throw new ValidationError('R2 key too long', [
            { field: 'key', error: 'Max 512 chars', error_code: BK_ERROR_CODES.INVALID_FIELD_VALUE },
        ]);
    }
}
