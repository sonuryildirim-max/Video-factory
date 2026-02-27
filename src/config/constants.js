/**
 * Application Constants
 */

export const TRACKING_PARAMS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "_gl", "gclid", "gclsrc", "dclid", "wbraid", "gbraid",
    "fbclid", "fb_action_ids", "fb_action_types", "fb_source",
    "recommended_by", "recommended_code", "r46_merger_code",
    "mc_cid", "mc_eid", "msclkid", "twclid", "igshid", "ref",
    "_ga", "yclid", "_hsenc", "_hsmi", "hsCtaTracking",
    "__hstc", "__hsfp", "__hssc", "email"
];

// PLAY_01/CSP: media-src — R2 CDN (cdn.bilgekarga.tr) video oynatma için güvenli; MEDIA_ELEMENT_ERROR önlemi
export const SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' https://cdn.jsdelivr.net; media-src 'self' blob: data: https://cdn.bilgekarga.tr https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()"
};

export const SOCIAL_BOTS = [
    "WhatsApp", "facebookexternalhit", "Facebot", "Twitterbot",
    "LinkedInBot", "Slackbot", "TelegramBot", "Discordbot",
    "Googlebot", "bingbot", "Applebot"
];
