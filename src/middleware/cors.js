/**
 * CORS Middleware
 */

import { CONFIG } from '../config/config.js';

/**
 * Get CORS headers for request origin
 */
export function getCorsHeaders(requestOrigin) {
    const trimmedOrigin = (requestOrigin || "").trim();
    const allowedOrigins = CONFIG.ALLOWED_ORIGINS.map(o => o.trim());
    if (!allowedOrigins.includes(trimmedOrigin)) return {};
    return {
        "Access-Control-Allow-Origin": trimmedOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin"
    };
}

/**
 * Handle CORS preflight
 */
export function handleCORS(request, env) {
    const corsHeaders = getCorsHeaders(request.headers.get("Origin"));
    if (Object.keys(corsHeaders).length === 0) {
        return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
}
