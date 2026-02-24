/**
 * Video Import Module
 */
import { requireAuth } from '../../middleware/auth.js';
import { CONFIG } from '../../config/config.js';
import { ValidationError, RateLimitError, BK_ERROR_CODES } from '../../utils/errors.js';
import { checkRateLimit } from '../../middleware/rateLimit.js';
import { jsonResponse, normalizeQuality, notifyAgentWakeup } from '../videos.js';

export async function routeImportFromUrl(request, svc, env, ctx) {
    const auth = await requireAuth(request, env);
    const userId = auth.user;

    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0] || 'unknown';
    const limit = CONFIG.RATE_LIMITS.VIDEO_URL_IMPORT_PER_MINUTE ?? 10;
    const allowed = await checkRateLimit(env, `video:url-import:${ip}`, limit, 60);
    if (!allowed) throw new RateLimitError('Too many URL imports. Please try again later.', 60);

    const body = await request.json().catch(() => null);
    if (!body) throw new ValidationError('Request body must be JSON');

    const { url, quality, renderPreset, processingProfile, tags, projectName, notes, displayName, folder_id } = body;
    const folderId = parseInt(folder_id, 10) || null;
    const resolvedQuality = normalizeQuality(quality || renderPreset);

    const invalid = [];
    if (!url || typeof url !== 'string')
        invalid.push({ field: 'url', error: 'Required string', error_code: BK_ERROR_CODES.MISSING_FIELD });

    try { new URL(url); } catch {
        invalid.push({ field: 'url', error: 'Invalid URL format', error_code: BK_ERROR_CODES.INVALID_FIELD_VALUE });
    }

    if (!resolvedQuality)
        invalid.push({ field: 'quality', error: 'Must be 720p or 1080p', error_code: BK_ERROR_CODES.INVALID_QUALITY });

    if (invalid.length) throw new ValidationError('Invalid parameters', invalid);

    const result = await svc.importFromUrlSync({
        url, quality: resolvedQuality, processingProfile: processingProfile || 'crf_14',
        tags, projectName, notes, displayName: displayName || null, folderId
    }, userId, env);
    notifyAgentWakeup(env, ctx);
    return jsonResponse(result, 201);
}
