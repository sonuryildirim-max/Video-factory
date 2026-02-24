/**
 * Shared video/R2 validation and filename utilities (SSRF, path traversal, sanitization).
 */

import { ValidationError } from './errors.js';

const TR_MAP = {
    'ç': 'c', 'Ç': 'C',
    'ğ': 'g', 'Ğ': 'G',
    'ı': 'i', 'İ': 'I',
    'ö': 'o', 'Ö': 'O',
    'ş': 's', 'Ş': 'S',
    'ü': 'u', 'Ü': 'U',
};

/**
 * Validate R2 key for path traversal and safe prefix (SSRF/data integrity).
 * @param {string} key - R2 object key
 * @param {string[]} allowedPrefixes - e.g. ['raw-uploads/'] or ['videos/', 'thumbnails/']
 * @throws {ValidationError} if invalid
 */
export function validateR2Key(key, allowedPrefixes) {
    if (typeof key !== 'string' || !key.trim()) {
        throw new ValidationError('R2 key must be a non-empty string');
    }
    const k = key.trim();
    const validPrefix = allowedPrefixes.some(p => k.startsWith(p));
    if (!validPrefix) {
        throw new ValidationError(`R2 key must start with one of: ${allowedPrefixes.join(', ')}`);
    }
    if (k.includes('..')) {
        throw new ValidationError('R2 key must not contain path traversal');
    }
    if (!/^[a-zA-Z0-9_./-]+$/.test(k)) {
        throw new ValidationError('R2 key contains invalid characters');
    }
    if (k.length > 512) {
        throw new ValidationError('R2 key too long');
    }
}

/**
 * Sanitize filename for safe R2 key (Turkish transliteration, lowercase, random suffix).
 */
export function sanitizeFilename(filename) {
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    let sanitized = nameWithoutExt;
    for (const [tr, en] of Object.entries(TR_MAP)) {
        sanitized = sanitized.replace(new RegExp(tr, 'g'), en);
    }
    sanitized = sanitized
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    const randomSuffix = crypto.randomUUID().slice(0, 8);
    return `${sanitized}-${randomSuffix}.mp4`;
}
