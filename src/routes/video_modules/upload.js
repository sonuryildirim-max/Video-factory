/**
 * Video Upload Module
 */
import { requireAuth } from '../../middleware/auth.js';
import { checkRateLimit } from '../../middleware/rateLimit.js';
import { CONFIG } from '../../config/config.js';
import { ValidationError, RateLimitError, BK_ERROR_CODES } from '../../utils/errors.js';
import { SecurityLogRepository } from '../../repositories/SecurityLogRepository.js';
import { UploadLinkDTO } from '../../utils/dto.js';
import { logger } from '../../utils/logger.js';
import { jsonResponse, normalizeQuality, notifyAgentWakeup } from '../videos.js';

export async function routeGeneratePresignedUrl(request, svc, env) {
    const auth = await requireAuth(request, env);
    const userId = auth.user;

    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0] || 'unknown';
    const limit = CONFIG.RATE_LIMITS.VIDEO_PRESIGNED_PER_MINUTE ?? 30;
    const allowed = await checkRateLimit(env, `video:presigned:${ip}`, limit, 60);
    if (!allowed) throw new RateLimitError('Too many presigned requests. Please try again later.', 60);

    const body = await request.json().catch(() => null);
    if (!body) throw new ValidationError('Request body must be JSON');

    const { fileName, fileSize, quality, renderPreset, processingProfile, tags, projectName, notes, displayName, folder_id } = body;
    const folderId = parseInt(folder_id, 10) || null;

    const resolvedQuality = normalizeQuality(quality || renderPreset);

    const invalid = [];
    if (!fileName || typeof fileName !== 'string')
        invalid.push({ field: 'fileName', error: 'Required string', error_code: BK_ERROR_CODES.MISSING_FIELD });
    if (!fileSize || fileSize <= 0)
        invalid.push({ field: 'fileSize', error: 'Must be a positive integer', error_code: BK_ERROR_CODES.MISSING_FIELD });
    if (!resolvedQuality)
        invalid.push({ field: 'quality', error: 'Must be 720p or 1080p (or 720p_web / 1080p_web)', error_code: BK_ERROR_CODES.INVALID_QUALITY });

    if (invalid.length) throw new ValidationError('Invalid upload parameters', invalid);

    const result = await svc.generatePresignedUrl({
        fileName, fileSize, quality: resolvedQuality, processingProfile: processingProfile || '12',
        tags, projectName, notes, displayName: displayName || null, folderId
    }, userId);

    if (env.DB) {
        try {
            const secLog = new SecurityLogRepository(env.DB);
            const approach = result.uploadUrl?.includes('r2.cloudflarestorage.com') ? 'presigned' : 'direct';
            await secLog.insert({
                ip, action: 'VIDEO_PRESIGNED_REQUEST', status: 'success',
                userAgent: request.headers.get('User-Agent') || 'unknown',
                country: request.cf?.country || 'XX', city: request.cf?.city || 'Unknown',
                details: { fileName, fileSize, quality: resolvedQuality, jobId: result.jobId, approach, userId },
            });
        } catch (e) { logger.error('VIDEO_PRESIGNED_REQUEST log', { message: e?.message }); }
    }

    return jsonResponse(UploadLinkDTO.build(result));
}

export async function routeDirectUpload(request, svc, token, env) {
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
    try {
        const res = await svc.handleDirectUpload(request, token);
        if (res.ok && env.DB) {
            try {
                const secLog = new SecurityLogRepository(env.DB);
                await secLog.insert({
                    ip, action: 'VIDEO_DIRECT_UPLOAD_OK', status: 'success',
                    userAgent: request.headers.get('User-Agent') || 'unknown',
                    country: request.cf?.country || 'XX', city: request.cf?.city || 'Unknown',
                    details: { endpoint: 'direct', tokenPrefix: token.slice(0, 8) },
                });
            } catch (e) { logger.error('VIDEO_DIRECT_UPLOAD_OK log', { message: e?.message }); }
        }
        return res;
    } catch (e) {
        if (env.DB) {
            try {
                const secLog = new SecurityLogRepository(env.DB);
                await secLog.insert({
                    ip, action: 'VIDEO_UPLOAD_FAILED', status: 'failed',
                    userAgent: request.headers.get('User-Agent') || 'unknown',
                    country: request.cf?.country || 'XX', city: request.cf?.city || 'Unknown',
                    details: { error: e?.message || String(e), statusCode: e?.statusCode, endpoint: 'direct', tokenPrefix: token.slice(0, 8) },
                });
            } catch (logErr) { logger.error('VIDEO_UPLOAD_FAILED log', { message: logErr?.message }); }
        }
        throw e;
    }
}

export async function routeMultipartUpload(request, svc, env, ctx) {
    const auth = await requireAuth(request, env);
    const userId = auth.user;

    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0] || 'unknown';
    const limit = CONFIG.RATE_LIMITS.VIDEO_PRESIGNED_PER_MINUTE ?? 30;
    const allowed = await checkRateLimit(env, `video:multipart:${ip}`, limit, 60);
    if (!allowed) throw new RateLimitError('Too many upload requests. Please try again later.', 60);

    const result = await svc.handleMultipartUpload(request, userId);
    notifyAgentWakeup(env, ctx);

    if (env.DB) {
        try {
            const secLog = new SecurityLogRepository(env.DB);
            await secLog.insert({
                ip, action: 'VIDEO_MULTIPART_UPLOAD', status: 'success',
                userAgent: request.headers.get('User-Agent') || 'unknown',
                country: request.cf?.country || 'XX', city: request.cf?.city || 'Unknown',
                details: { jobId: result.job_id, cleanName: result.clean_name, folder_id: result.folder_id, userId },
            });
        } catch (e) { logger.error('VIDEO_MULTIPART_UPLOAD log', { message: e?.message }); }
    }

    return jsonResponse(result);
}

export async function routeUploadComplete(request, svc, url, env, ctx) {
    const token = url.searchParams.get('token') || '';
    if (!token) throw new ValidationError('Missing upload token', [
        { field: 'token', error: 'Required query parameter', error_code: BK_ERROR_CODES.UPLOAD_TOKEN_INVALID },
    ]);

    const result = await svc.handleDirectUploadComplete(token, request);
    notifyAgentWakeup(env, ctx);

    if (env.DB) {
        try {
            const secLog = new SecurityLogRepository(env.DB);
            const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
            await secLog.insert({
                ip, action: 'VIDEO_UPLOAD_COMPLETE', status: 'success',
                userAgent: request.headers.get('User-Agent') || 'unknown',
                country: request.cf?.country || 'XX', city: request.cf?.city || 'Unknown',
                details: { jobId: result.job_id, cleanName: result.clean_name, actual_file_size: result.actual_file_size, userId: result.uploaded_by },
            });
        } catch (e) { logger.error('VIDEO_UPLOAD_COMPLETE log', { message: e?.message }); }
    }

    return jsonResponse(result);
}
