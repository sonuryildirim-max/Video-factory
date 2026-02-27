/**
 * Bulk video routes — delete, restore, purge
 */

import { requireAuth, requireRoot } from '../../middleware/auth.js';
import { jsonResponse, ValidationError } from '../../utils/errors.js';
import { SecurityLogRepository } from '../../repositories/SecurityLogRepository.js';
import { logger } from '../../utils/logger.js';
import { writeSystemLog } from '../../utils/systemLog.js';

export async function handleBulkRoutes(request, svc, path, method, env) {
    if (path === '/api/videos/bulk-delete' && method === 'POST') return await routeBulkDelete(request, svc, env);
    if (path === '/api/videos/bulk-restore' && method === 'POST') return await routeBulkRestore(request, svc, env);
    if (path === '/api/videos/bulk-purge' && method === 'POST') return await routeBulkPurge(request, svc, env);
    if (path === '/api/videos/bulk-move' && method === 'POST') return await routeBulkMove(request, svc, env);
    return null;
}

async function routeBulkDelete(request, svc, env) {
    const auth = await requireAuth(request, env);
    const body = await request.json().catch(() => null);
    if (!body) throw new ValidationError('Request body must be JSON');
    const ids = Array.isArray(body.ids) ? body.ids : (body.id != null ? [body.id] : []);
    if (ids.length === 0) throw new ValidationError('ids array required');
    logger.info('BulkDelete request', { ids });
    if (env.DB) {
        try {
            const secLog = new SecurityLogRepository(env.DB);
            const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
            await secLog.insert({
                ip, action: 'BULK_DELETE_STARTED', status: 'success',
                userAgent: request.headers.get('User-Agent') || 'unknown',
                country: request.cf?.country || 'XX', city: request.cf?.city || 'Unknown',
                details: { ids, count: ids.length, userId: auth.user },
                createdBy: auth.user,
            });
        } catch (e) { logger.error('BULK_DELETE_STARTED log failed', { message: e?.message }); }
    }
    try {
        const result = await svc.deleteJobs(ids, auth.user, env, auth.isRoot);
        const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
        writeSystemLog(env, { level: 'INFO', category: 'R2', message: 'Bulk delete', details: { ip, method: request.method, deleted_count: result?.deleted ?? 0, job_ids: ids } }).catch(() => {});
        return jsonResponse(result);
    } catch (e) {
        const stack = e?.stack || '';
        const message = e?.message || String(e);
        logger.error('BulkDelete FAIL', { message, stack });
        if (env.DB) {
            try {
                const secLog = new SecurityLogRepository(env.DB);
                const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
                await secLog.insert({
                    ip, action: 'FULL_ERROR_STACK', status: 'failed',
                    userAgent: request.headers.get('User-Agent') || 'unknown',
                    country: request.cf?.country || 'XX', city: request.cf?.city || 'Unknown',
                    details: { ids, error: message, stack: stack.slice(0, 2000), userId: auth.user },
                    createdBy: auth.user,
                });
            } catch (logErr) { logger.error('FULL_ERROR_STACK log failed', { message: logErr?.message }); }
        }
        throw e;
    }
}

async function routeBulkRestore(request, svc, env) {
    await requireRoot(request, env);
    const body = await request.json().catch(() => null);
    if (!body) throw new ValidationError('Request body must be JSON');
    const ids = Array.isArray(body.ids) ? body.ids : (body.id != null ? [body.id] : []);
    if (ids.length === 0) throw new ValidationError('ids array required');
    const result = await svc.restoreJobs(ids, env, true);
    return jsonResponse(result);
}

async function routeBulkPurge(request, svc, env) {
    await requireRoot(request, env);
    const body = await request.json().catch(() => null);
    if (!body) throw new ValidationError('Request body must be JSON');
    const ids = Array.isArray(body.ids) ? body.ids : (body.id != null ? [body.id] : []);
    if (ids.length === 0) throw new ValidationError('ids array required');
    const result = await svc.purgeJobs(ids, env, true);
    return jsonResponse(result);
}

async function routeBulkMove(request, svc, env) {
    const auth = await requireAuth(request, env);
    const body = await request.json().catch(() => null);
    if (!body) throw new ValidationError('Request body must be JSON');
    const ids = Array.isArray(body.ids) ? body.ids : (body.id != null ? [body.id] : []);
    if (ids.length === 0) throw new ValidationError('ids array required');
    const folderId = body.folder_id != null ? body.folder_id : null;
    const result = await svc.bulkMoveJobs(ids, folderId, auth.user);
    return jsonResponse(result);
}
