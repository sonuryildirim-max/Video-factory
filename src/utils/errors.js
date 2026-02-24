/**
 * Error classes & response helpers — BK API error format
 *
 * {
 *   "error":             "Human-readable error message",
 *   "link":              "https://docs link",
 *   "developer_message": "Technical details for the developer",
 *   "error_code":        2204,
 *   "invalid_parameters": [{ "field": "quality", "error": "Must be 720p or 1080p", "error_code": 2202 }]
 * }
 */

import { logger } from './logger.js';

// ─── Error code catalogue (BK-namespaced, ≥ 2200) ────────────────────────────
export const BK_ERROR_CODES = {
    // Upload errors
    INVALID_FILE_TYPE:       2200,
    FILE_TOO_LARGE:          2201,
    INVALID_QUALITY:         2202,
    MISSING_FIELD:           2203,
    INVALID_FIELD_VALUE:     2204,

    // Job lifecycle errors
    JOB_NOT_FOUND:           2210,
    JOB_ALREADY_PROCESSING:  2211,
    JOB_NOT_RETRYABLE:       2212,   // only FAILED jobs can be retried
    JOB_DELETE_DENIED:       2213,   // cannot delete a PROCESSING job

    // Token / upload flow
    UPLOAD_TOKEN_EXPIRED:    2220,
    UPLOAD_TOKEN_INVALID:    2221,
    UPLOAD_NOT_CONFIRMED:    2222,

    // Worker / agent errors
    WORKER_UNAUTHORIZED:     2230,
    WORKER_NOT_FOUND:        2231,
    JOB_OWNERSHIP_MISMATCH:  2232,   // job owned by different worker

    // Storage / R2
    R2_BUCKET_NOT_FOUND:     2240,
    R2_DELETE_FAILED:        2241,
    R2_PRESIGNED_FAILED:     2242,
    R2_RAW_URL_INVALID:      2243,
    R2_PUBLIC_URL_INVALID:   2244,

    // Polling
    POLL_TIMEOUT:            2250,

    // Internal / unexpected
    INTERNAL:                2299,
};

const API_DOCS_BASE = 'https://bilgekarga.com/api/docs';

// ─── Error Classes ────────────────────────────────────────────────────────────

export class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode       = statusCode;
        this.code             = code;
        this.name             = 'AppError';
        this.errorCode        = 0;
        this.developerMessage = message;
    }
}

export class ValidationError extends AppError {
    /**
     * @param {string}  message
     * @param {Array}   invalidParameters - [{ field, error, error_code }]
     */
    constructor(message, invalidParameters = []) {
        super(message, 400, 'VALIDATION_ERROR');
        this.invalidParameters = invalidParameters;
        this.errorCode         = BK_ERROR_CODES.INVALID_FIELD_VALUE;
    }
}

export class AuthError extends AppError {
    constructor(message = 'Unauthorized', statusCode = 401) {
        super(message, statusCode, 'AUTH_ERROR');
    }
}

export class NotFoundError extends AppError {
    constructor(resource = 'Resource', id = '') {
        const msg = id ? `${resource} not found (id: ${id})` : `${resource} not found`;
        super(msg, 404, 'NOT_FOUND');
        this.errorCode        = BK_ERROR_CODES.JOB_NOT_FOUND;
        this.developerMessage = `The requested ${resource.toLowerCase()} does not exist in the database.`;
    }
}

export class RateLimitError extends AppError {
    constructor(message = 'Rate limit exceeded', retryAfter = 60) {
        super(message, 429, 'RATE_LIMIT');
        this.retryAfter = retryAfter;
    }
}

export class ConflictError extends AppError {
    constructor(message = 'Resource conflict') {
        super(message, 409, 'CONFLICT');
    }
}

export class PayloadTooLargeError extends AppError {
    constructor(message = 'Payload too large', errorCode = BK_ERROR_CODES.FILE_TOO_LARGE) {
        super(message, 413, 'PAYLOAD_TOO_LARGE');
        this.errorCode = errorCode;
    }
}

// ─── Response Helpers ─────────────────────────────────────────────────────────

const CORS_HEADERS = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
};

/**
 * Build a JSON success Response with standard CORS headers.
 * @param {*}      data
 * @param {number} status - HTTP status code (default 200)
 */
export function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: CORS_HEADERS,
    });
}

/**
 * Send Samaritan Edge Alert to Telegram (POI format).
 * Fire-and-forget; does not throw.
 */
export async function sendSamaritanEdgeAlert(env, error) {
    const token = env?.TELEGRAM_TOKEN;
    const chatId = env?.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    const msg = (error?.message || String(error)).slice(0, 500);
    const text = [
        '🔺 <b>SYSTEM ANOMALY DETECTED</b>',
        '[ \\ ] TARGET NODE: Cloudflare Edge Worker',
        `[ ! ] CRITICAL ERROR: ${msg}`,
        '> STATUS: SYSTEM OVERRIDE NEEDED. SEARCHING FOR ADMIN... 🔎'
    ].join('\n');
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        });
        if (!res.ok) logger.error('Samaritan Edge Alert failed', { status: res.status });
    } catch (e) {
        logger.error('Samaritan Edge Alert error', { message: e?.message });
    }
}

/**
 * Send Samaritan Dead Man's Switch alert (POI format).
 * Dual-channel: Telegram + backup webhook (via monitoring.sendAlert).
 * Fire-and-forget; does not throw.
 */
export async function sendSamaritanDMSAlert(env) {
    const { sendAlert } = await import('../monitoring.js');
    await sendAlert(env, {
        level: 'critical',
        title: '🔻 <b>CRITICAL ALERT: LOSS OF SIGNAL</b>',
        body: [
            '[ \\ ] <b>TARGET NODE:</b> Primary Processing Core (Hetzner)',
            '[ ! ] <b>STATUS:</b> MISSING 2 CONSECUTIVE HEARTBEATS.',
            '> <b>DIRECTIVE:</b> NODE PRESUMED DEAD. INITIATING ADMIN WAKE-UP ALARM! 🚨'
        ].join('\n'),
    });
}

/**
 * Send Samaritan Intrusion Alert when Telegram webhook receives message from non-allowed chat.
 * Fire-and-forget; does not throw.
 */
export async function sendSamaritanIntrusionAlert(env, intruderId, intruderText) {
    const token = env?.TELEGRAM_TOKEN;
    const chatId = env?.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    const text = [
        '> 🔻 <b>INTRUSION ATTEMPT DETECTED</b>',
        '[ ! ] <b>WARNING:</b> UNKNOWN ENTITY TRIED TO ACCESS THE MACHINE.',
        `[ \\ ] <b>USER_ID:</b> ${String(intruderId ?? 'unknown')}`,
        `[ \\ ] <b>MESSAGE:</b> ${(intruderText || '').slice(0, 300)}`,
        '> <b>DIRECTIVE:</b> MONITORING AND LOGGING SOURCE IP.'
    ].join('\n');
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        });
        if (!res.ok) logger.error('Samaritan Intrusion Alert failed', { status: res.status });
    } catch (e) {
        logger.error('Samaritan Intrusion Alert error', { message: e?.message });
    }
}

const CRITICAL_PATHS = ['/api/users', '/api/r2', '/api/security/', '/api/folders', '/api/logs/app'];

/**
 * Send Samaritan API Security Alert when 401/403 on critical endpoints.
 * Fire-and-forget; does not throw.
 */
export async function sendSamaritanSecurityAlert(env, request, error) {
    if (!env?.TELEGRAM_TOKEN || !env?.TELEGRAM_CHAT_ID) return;
    let path = '';
    try {
        path = new URL(request?.url || '').pathname;
    } catch (_) { return; }
    if (!CRITICAL_PATHS.some(p => path === p || path.startsWith(p))) return;
    const statusCode = error?.statusCode || 500;
    if (statusCode !== 401 && statusCode !== 403) return;
    const ip = request?.headers?.get?.('CF-Connecting-IP') || 'unknown';
    const msg = (error?.message || String(error)).slice(0, 200);
    const text = [
        '🔺 <b>API SECURITY ALERT</b>',
        `[ \\ ] <b>ENDPOINT:</b> ${path}`,
        `[ \\ ] <b>STATUS:</b> ${statusCode}`,
        `[ \\ ] <b>IP:</b> ${ip}`,
        `[ ! ] <b>MESSAGE:</b> ${msg}`,
        '> <b>DIRECTIVE:</b> UNAUTHORIZED ACCESS ATTEMPT LOGGED.'
    ].join('\n');
    try {
        const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
        });
        if (!res.ok) logger.error('Samaritan Security Alert failed', { status: res.status });
    } catch (e) {
        logger.error('Samaritan Security Alert error', { message: e?.message });
    }
}

/**
 * Handle an error → BK API JSON Response.
 * Unknown errors are logged and returned as 500.
 * When status 500 and ctx.waitUntil available, sends Samaritan Edge Alert to Telegram.
 * @param {Error} error
 * @param {Request} _request
 * @param {object} [env] - Worker env (for TELEGRAM_TOKEN, TELEGRAM_CHAT_ID)
 * @param {object} [ctx] - ExecutionContext (for ctx.waitUntil)
 */
export function handleError(error, _request, env, ctx) {
    const headers = { ...CORS_HEADERS };

    if (error instanceof RateLimitError) {
        headers['Retry-After'] = String(error.retryAfter);
    }

    const statusCode = error.statusCode || 500;

    if (!(error instanceof AppError)) {
        logger.error('Unexpected error', { error: String(error) });
    } else {
        logger.error('AppError', { statusCode, code: error.code, message: error.message });
    }

    const errorCode = error instanceof AppError && error.errorCode != null
        ? error.errorCode
        : BK_ERROR_CODES.INTERNAL;

    // 500 → Samaritan Edge Alert (fire-and-forget)
    if (statusCode === 500 && ctx?.waitUntil && env) {
        ctx.waitUntil(sendSamaritanEdgeAlert(env, error));
    }

    // 401/403 on critical paths → Samaritan Security Alert (fire-and-forget)
    if ((statusCode === 401 || statusCode === 403) && ctx?.waitUntil && env && _request) {
        ctx.waitUntil(sendSamaritanSecurityAlert(env, _request, error));
    }

    const body = {
        error:             error.message || 'Internal server error',
        link:              `${API_DOCS_BASE}/errors#${errorCode}`,
        developer_message: error.developerMessage || error.message || 'An unexpected error occurred',
        error_code:        errorCode,
        ...(error.invalidParameters?.length > 0 && {
            invalid_parameters: error.invalidParameters,
        }),
    };

    return new Response(JSON.stringify(body), { status: statusCode, headers });
}
