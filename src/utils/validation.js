/**
 * Validation Utilities
 */

import { CONFIG } from '../config/config.js';

/**
 * Validate target URL
 */
export function validateTargetUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return { ok: false, error: "Sadece HTTP/HTTPS desteklenir" };
        }
        const hostname = url.hostname.normalize("NFC").toLowerCase();
        const isAllowed = CONFIG.ALLOWED_DOMAINS.some(function (d) {
            return hostname === d || hostname === "www." + d;
        });
        if (!isAllowed) {
            return { ok: false, error: "Sadece bilgekarga.com.tr kisaltilabilir" };
        }
        return { ok: true, url: url.toString() };
    } catch (e) {
        return { ok: false, error: "Gecersiz URL formati" };
    }
}

/**
 * Validate slug format
 */
export function validateSlug(slug) {
    if (!slug || slug.length < 3 || slug.length > 30) {
        return { ok: false, error: "Link adi 3-30 karakter arasinda olmali." };
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
        return { 
            ok: false, 
            error: "Link adinda sadece kucuk harf, rakam ve tire kullanilabilir (bas/sonda tire olamaz)." 
        };
    }
    if (CONFIG.RESERVED_SLUGS.includes(slug)) {
        return { ok: false, error: "Bu isim sistem tarafindan ayrilmis." };
    }
    return { ok: true };
}

/**
 * Generate random slug
 */
export function generateSlug() {
    const arr = new Uint8Array(CONFIG.SLUG_LENGTH);
    crypto.getRandomValues(arr);
    return Array.from(arr, function (b) {
        return CONFIG.SLUG_CHARSET[b % CONFIG.SLUG_CHARSET.length];
    }).join('');
}

/**
 * Hash URL using SHA-256
 */
export async function hashUrl(url) {
    const msgUint8 = new TextEncoder().encode(url);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function (b) {
        return b.toString(16).padStart(2, '0');
    }).join('');
}
