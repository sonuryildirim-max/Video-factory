/**
 * Video Import Module
 */
import { requireAuth } from '../../middleware/auth.js';
import { CONFIG } from '../../config/config.js';
import { ValidationError, RateLimitError, BK_ERROR_CODES } from '../../utils/errors.js';
import { checkRateLimit } from '../../middleware/rateLimit.js';
import { jsonResponse, normalizeQuality, notifyAgentWakeup } from '../videos.js';
import { writeSystemLog } from '../../utils/systemLog.js';
import { sendTelegram } from '../../utils/telegram.js';

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

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/6e5419c3-da58-4eff-91a7-eca90285816f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'import.js:before isDriveFolderUrl', message: 'svc type and method check', data: { svcType: svc?.constructor?.name, hasIsDriveFolderUrl: typeof svc?.isDriveFolderUrl, hasUploadService: !!svc?.uploadService, uploadServiceHasMethod: typeof svc?.uploadService?.isDriveFolderUrl }, timestamp: Date.now(), hypothesisId: 'H1' }) }).catch(() => {});
    // #endregion

    let result;
    const driveFolder = svc.isDriveFolderUrl(url);
    const driveApiKey = env.GOOGLE_DRIVE_API_KEY && String(env.GOOGLE_DRIVE_API_KEY).trim();
    if (driveFolder && driveApiKey) {
        result = await svc.importFromDriveFolder({
            folderUrl: url,
            quality: resolvedQuality,
            tags,
            projectName,
            notes,
            folderId,
        }, userId);
    } else {
        if (driveFolder && !driveApiKey) {
            throw new ValidationError('Google Drive klasör linki için GOOGLE_DRIVE_API_KEY ortam değişkeni tanımlanmalı. Tek dosya linki kullanabilirsiniz.');
        }
        result = await svc.importFromUrlSync({
            url, quality: resolvedQuality, processingProfile: processingProfile || '12',
            tags, projectName, notes, displayName: displayName || null, folderId
        }, userId, env);
    }

    const jobCount = result?.job_count ?? 1;
    let urlShort = url;
    try {
        const u = new URL(url);
        urlShort = u.hostname + (u.pathname?.length > 60 ? u.pathname.slice(0, 60) + '…' : u.pathname || '');
    } catch (_) {}
    const logAndNotify = () => Promise.all([
        writeSystemLog(env, {
            level: 'INFO',
            category: 'IMPORT',
            message: 'URL import',
            details: { url: urlShort, job_count: jobCount, folder_id: folderId, user_id: userId }
        }).catch(() => {}),
        sendTelegram(env, `📥 URL import: ${jobCount} video kuyruğa alındı${urlShort ? ` — ${urlShort}` : ''}`).catch(() => {})
    ]);
    if (ctx?.waitUntil) ctx.waitUntil(logAndNotify());
    else logAndNotify().catch(() => {});

    notifyAgentWakeup(env, ctx);
    return jsonResponse(result, 201);
}
