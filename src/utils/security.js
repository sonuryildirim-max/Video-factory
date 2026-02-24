/**
 * Security Utilities
 */

/**
 * Timing-safe string comparison to prevent timing attacks
 */
export function timingSafeEqual(a, b) {
    const encoder = new TextEncoder();
    const aBuf = encoder.encode(String(a || ''));
    const bBuf = encoder.encode(String(b || ''));
    const maxLen = Math.max(aBuf.length, bBuf.length);
    let result = aBuf.length ^ bBuf.length;
    for (let i = 0; i < maxLen; i++) {
        result |= (aBuf[i] || 0) ^ (bBuf[i] || 0);
    }
    return result === 0;
}

/**
 * Sanitize input for logging to prevent XSS
 */
export function sanitizeForLog(input) {
    if (input === null || input === undefined) return null;
    if (typeof input !== 'string') return String(input);
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .substring(0, 500);
}
