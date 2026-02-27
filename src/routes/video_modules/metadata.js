/**
 * Video Metadata & Management Module
 */
import { requireAuth, requireRoot } from '../../middleware/auth.js';
import { JOB_STATUS } from '../../config/BK_CONSTANTS.js';
import { ValidationError, NotFoundError } from '../../utils/errors.js';
import { SecurityLogRepository } from '../../repositories/SecurityLogRepository.js';
import { VideoDTO, VideoListDTO } from '../../utils/dto.js';
import { logger } from '../../utils/logger.js';
import { writeSystemLog } from '../../utils/systemLog.js';
import { jsonResponse, normalizeQuality, notifyAgentWakeup } from '../videos.js';

export async function routeListVideos(request, svc, url, env) {
    await requireAuth(request, env);

    const sp = url.searchParams;
    const bucket = (sp.get('bucket') || '').toLowerCase();
    const rawStatus = sp.get('status') || '';
    const statusMap = { failed: JOB_STATUS.FAILED, completed: JOB_STATUS.COMPLETED, processing: JOB_STATUS.PROCESSING, uploaded: JOB_STATUS.PENDING, pending: JOB_STATUS.PENDING };
    let status = rawStatus ? (statusMap[rawStatus.toLowerCase()] || rawStatus.toUpperCase()) : '';

    if (bucket === 'public') status = JOB_STATUS.COMPLETED;
    else if (bucket === 'raw') status = '';
    else if (bucket === 'deleted') status = JOB_STATUS.DELETED;

    // Query param: folder veya folder_id (binding ile SQL injection safe)
    const folderParam = sp.get('folder_id') || sp.get('folder');
    const folderId = folderParam ? parseInt(folderParam, 10) : null;
    logger.debug('SQL Param (folder_id)', { folderId, folder_param: folderParam ?? '(yok)' });
    const filters = {
        search: sp.get('search') || '',
        status,
        bucket,
        folder_id: isNaN(folderId) ? null : folderId,
        quality: normalizeQuality(sp.get('quality') || sp.get('render_preset') || ''),
        uploaded_by: sp.get('uploaded_by') || '',
        start_date: sp.get('start_date') || '',
        end_date: sp.get('end_date') || '',
        tags: sp.get('tags') || '',
        project_name: sp.get('project_name') || '',
        page: Math.max(1, parseInt(sp.get('page') || '1')),
        limit: Math.min(100, Math.max(1, parseInt(sp.get('per_page') || sp.get('limit') || '25'))),
        sort_by: sp.get('sort_by') || 'created_at',
        sort_order: (() => {
            const raw = sp.get('sort_order') || sp.get('order') || 'DESC';
            return String(raw).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        })(),
        offset: (() => {
            const raw = sp.get('offset');
            if (raw === null || raw === '') return undefined;
            const n = parseInt(raw, 10);
            return Number.isNaN(n) ? undefined : Math.max(0, n);
        })(),
        include_deleted: bucket === 'deleted' || sp.get('include_deleted') === '1',
        cursor: sp.get('cursor') || undefined,
    };

    if (bucket === 'deleted') {
        await requireRoot(request, env);
        const result = await svc.jobRepo.getDeletedJobs(filters);
        return jsonResponse(VideoListDTO.build(result, '/api/videos', svc.cdnBase));
    }

    const result = await svc.getJobs(filters);
    return jsonResponse(VideoListDTO.build(result, '/api/videos', svc.cdnBase));
}

export async function routeGetVideo(id, request, svc, env) {
    await requireAuth(request, env);
    const job = await svc.getJobById(id);
    if (!job) throw new NotFoundError('Video', id);
    return jsonResponse(VideoDTO.fromJob(job, svc.cdnBase));
}

export async function routeUpdateVideo(id, request, svc, env) {
    const auth = await requireAuth(request, env);
    const body = await request.json().catch(() => null);
    if (!body) throw new ValidationError('Request body must be JSON');

    const allowed = ['name', 'description', 'tags', 'project_name', 'notes', 'privacy', 'allow_download', 'folder_id'];
    const data = {};
    for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
            data[key] = body[key];
        }
    }

    if (data.description !== undefined && data.notes === undefined) {
        data.notes = data.description;
        delete data.description;
    }
    if (data.name !== undefined && data.original_name === undefined) {
        data.original_name = data.name;
        delete data.name;
    }

    const updated = await svc.updateJob(id, data, auth.user, env, auth.isRoot);
    return jsonResponse(VideoDTO.fromJob(updated, svc.cdnBase));
}

export async function routeDeleteVideo(id, request, svc, env) {
    const auth = await requireAuth(request, env);
    await svc.deleteJob(id, auth.user, env, auth.isRoot);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    writeSystemLog(env, { level: 'INFO', category: 'R2', message: 'Job deleted (soft/hard)', details: { ip, method: request.method, job_id: id } }).catch(() => {});
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
}

export async function routeListDeleted(request, svc, url, env) {
    await requireRoot(request, env);
    const sp = url.searchParams;
    const filters = {
        page: Math.max(1, parseInt(sp.get('page') || '1')),
        limit: Math.min(100, Math.max(1, parseInt(sp.get('per_page') || sp.get('limit') || '25'))),
        sort_by: sp.get('sort_by') || 'deleted_at',
        sort_order: sp.get('sort_order') || 'DESC',
    };
    const result = await svc.jobRepo.getDeletedJobs(filters);
    return jsonResponse(VideoListDTO.build(result, '/api/videos/deleted', svc.cdnBase));
}

export async function routeGetTopViewed(request, svc, url, env) {
    await requireAuth(request, env);
    const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') || '5', 10)));
    const jobs = await svc.jobRepo.getTopViewed(limit);
    return jsonResponse(VideoListDTO.build({ jobs, totalCount: jobs.length, page: 1, totalPages: 1, limit }, '/api/videos/top-viewed', svc.cdnBase));
}

export async function routeGetStatistics(request, svc, url, env) {
    await requireAuth(request, env);
    const days = parseInt(url.searchParams.get('days') || '30');
    const stats = await svc.getStatistics(days);
    return jsonResponse(stats);
}

export async function routeVideoHit(id, request, svc, env) {
    const jobId = parseInt(id, 10);
    if (isNaN(jobId)) throw new ValidationError(`Invalid video id: ${id}`);
    const job = await svc.jobRepo.getById(jobId);
    if (!job) throw new NotFoundError('Video', id);
    if (job.status !== JOB_STATUS.COMPLETED || job.deleted_at) {
        return jsonResponse({ success: false, message: 'Video not available' }, 404);
    }
    await svc.jobRepo.incrementViewCount(jobId);
    const updated = await svc.jobRepo.getById(jobId);
    return jsonResponse({ success: true, view_count: updated?.view_count ?? 0 });
}
