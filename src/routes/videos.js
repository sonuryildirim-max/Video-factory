/**
 * Video Routes Router Hub — BK Video Factory
 */

import { VideoService } from '../services/VideoService.js';
import { requireAuth } from '../middleware/auth.js';
import { CONFIG } from '../config/config.js';
import { JOB_STATUS, QUEUED_STATUSES } from '../config/BK_CONSTANTS.js';
import {
    handleError, jsonResponse, AuthError, BK_ERROR_CODES, AppError
} from '../utils/errors.js';
import { SecurityLogRepository } from '../repositories/SecurityLogRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { MetricsRepository } from '../repositories/MetricsRepository.js';
import { VideoDTO } from '../utils/dto.js';
import { logger } from '../utils/logger.js';
import { handleBulkRoutes } from './videos/bulk.js';

// Import Modular Routes
import { routeGeneratePresignedUrl, routeDirectUpload, routeUploadComplete } from './video_modules/upload.js';
import { routeImportFromUrl } from './video_modules/import.js';
import {
    routeListVideos, routeGetVideo, routeUpdateVideo, routeDeleteVideo,
    routeListDeleted, routeGetTopViewed, routeGetStatistics, routeVideoHit
} from './video_modules/metadata.js';

/**
 * Main Router Hub
 */
export async function handleVideoRoutes(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const svc = new VideoService(env);

    try {
        // ── Upload flow (no auth: token-validated) ───────────────────────────
        if (path === '/api/videos/upload/complete' && method === 'POST') {
            return await routeUploadComplete(request, svc, url, env, ctx);
        }

        if (path.startsWith('/api/videos/upload/direct/') && method === 'POST') {
            const token = path.slice('/api/videos/upload/direct/'.length);
            return await routeDirectUpload(request, svc, token, env);
        }

        // ── Auth-required routes ─────────────────────────────────────────────
        if (path === '/api/videos/upload/presigned' && method === 'POST') {
            return await routeGeneratePresignedUrl(request, svc, env);
        }

        if (path === '/api/videos/upload/from-url' && method === 'POST') {
            return await routeImportFromUrl(request, svc, env, ctx);
        }

        if (path === '/api/videos/statistics' && method === 'GET') {
            return await routeGetStatistics(request, svc, url, env);
        }

        if (path === '/api/videos' && method === 'GET') {
            return await routeListVideos(request, svc, url, env);
        }

        if (path === '/api/videos/deleted' && method === 'GET') {
            return await routeListDeleted(request, svc, url, env);
        }

        if (path === '/api/videos/top-viewed' && method === 'GET') {
            return await routeGetTopViewed(request, svc, url, env);
        }

        const bulkRes = await handleBulkRoutes(request, svc, path, method, env);
        if (bulkRes) return bulkRes;

        const hitMatch = path.match(/^\/api\/videos\/([^/]+)\/hit$/);
        if (hitMatch && (method === 'POST' || method === 'GET')) {
            return await routeVideoHit(hitMatch[1], request, svc, env);
        }

        const videoMatch = path.match(/^\/api\/videos\/([^/]+)$/);
        if (videoMatch) {
            const id = videoMatch[1];
            if (method === 'GET') return await routeGetVideo(id, request, svc, env);
            if (method === 'PATCH') return await routeUpdateVideo(id, request, svc, env);
            if (method === 'DELETE') return await routeDeleteVideo(id, request, svc, env);
        }

        const retryMatch = path.match(/^\/api\/videos\/([^/]+)\/retry$/);
        if (retryMatch && method === 'POST') {
            return await routeRetryJob(retryMatch[1], request, svc, env, ctx);
        }

        const cancelMatch = path.match(/^\/api\/videos\/([^/]+)\/cancel$/);
        if (cancelMatch && method === 'POST') {
            return await routeCancelJob(cancelMatch[1], request, svc, env);
        }

        const restoreMatch = path.match(/^\/api\/videos\/([^/]+)\/restore$/);
        if (restoreMatch && method === 'POST') {
            return await routeRestoreVideo(restoreMatch[1], request, svc, env);
        }

        const purgeMatch = path.match(/^\/api\/videos\/([^/]+)\/purge$/);
        if (purgeMatch && method === 'POST') {
            return await routePurgeVideo(purgeMatch[1], request, svc, env);
        }

        if (path === '/api/videos/cleanup' && method === 'POST') {
            return await routeCleanup(request, svc, url, env);
        }
        if (path === '/api/videos/unstick' && method === 'POST') {
            return await routeUnstickJobs(request, svc, url, env);
        }

        // ── Hetner agent endpoints ───────────────────────────────────────────
        if (path === '/api/jobs/claim' && method === 'POST') return await routeClaimJob(request, svc, env);
        if (path === '/api/jobs/status' && method === 'POST') return await routeJobStatus(request, svc, env);
        if (path === '/api/jobs/presigned-upload' && method === 'POST') return await routePresignedUpload(request, svc, env);
        if (path === '/api/jobs/url-import-done' && method === 'POST') return await routeUrlImportDone(request, svc, env);
        if (path === '/api/jobs/complete' && method === 'POST') return await routeCompleteJob(request, svc, env);
        if (path === '/api/jobs/fail' && method === 'POST') return await routeFailJob(request, svc, env);
        if (path === '/api/jobs/interrupt' && method === 'POST') return await routeInterruptJob(request, svc, env);
        if (path === '/api/jobs/interrupted' && method === 'GET') return await routeGetInterruptedJobs(request, svc, env);
        if (path === '/api/jobs/interrupted/retry' && method === 'POST') return await routeRetryInterruptedJobs(request, svc, env);
        if (path === '/api/jobs/reprocess' && method === 'POST') return await routeReprocessJobs(request, svc, env, ctx);
        if (path === '/api/jobs/wakeup' && method === 'POST') return await routeWakeup(request, svc, env, ctx);
        if (path === '/api/heartbeat' && method === 'POST') return await routeHeartbeat(request, svc, env);
        if (path === '/api/status' && method === 'GET') return await routeGetStatus(request, svc, env);

        if (path === '/api/system/alerts' && method === 'POST') return await routePostSystemAlert(request, svc, env);
        if (path === '/api/system/alerts' && method === 'GET') return await routeGetSystemAlerts(request, svc, env);
        if (path === '/api/alerts' && method === 'GET') return await routeGetAlerts(request, svc, env);
        if (path === '/api/jobs/mark-zombies' && method === 'POST') return await routeMarkZombieJobs(request, svc, env);
        if (path === '/api/jobs/checkpoint' && method === 'POST') return await routeUpdateCheckpoint(request, svc, env);

        return jsonResponse({ error: 'Not found' }, 404);

    } catch (error) {
        await logForensicError(env, request, error);
        return handleError(error, request, env, ctx);
    }
}

// ─── Shared Helpers (Exported for Modules) ───────────────────────────────────

export { jsonResponse };
export { normalizeQuality };
export { notifyAgentWakeup };

// ─── Module Implementations (Internal for Hub) ────────────────────────────────

async function routeRetryJob(id, request, svc, env, ctx) {
    const auth = await requireAuth(request, env);
    const job = await svc.retryJob(id, auth.user, env, auth.isRoot);
    notifyAgentWakeup(env, ctx);
    return jsonResponse(VideoDTO.fromJob(job, svc.cdnBase));
}

async function routeCancelJob(id, request, svc, env) {
    const auth = await requireAuth(request, env);
    const cancelled = await svc.cancelJobIfOrphan(id, auth.user);
    return jsonResponse({ cancelled }, cancelled ? 200 : 404);
}

async function routeRestoreVideo(id, request, svc, env) {
    await requireRoot(request, env);
    const restored = await svc.restoreJob(id, env, true);
    return jsonResponse(restored);
}

async function routePurgeVideo(id, request, svc, env) {
    const auth = await requireRoot(request, env);
    await svc.permanentDeleteJob(id, auth.user, env, true);
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
}

async function routeCleanup(request, svc, url, env) {
    const auth = await requireAuth(request, env);
    const days = parseInt(url.searchParams.get('days') || '3');
    const result = await svc.cleanupOldVideos(days);
    return jsonResponse(result);
}

async function routeUnstickJobs(request, svc, url, env) {
    const auth = await requireAuth(request, env);
    const minutes = Math.max(1, parseInt(url.searchParams.get('minutes') || '30'));
    const result = await svc.unstickOrphanedJobs(minutes);
    return jsonResponse(result);
}

// ─── Hetner agent endpoints ──────────────────────────────────────────────────

async function routeClaimJob(request, svc, env) {
    assertWorkerAuth(request, env);
    await updateAgentLastActivity(request, env);
    const body = await request.json().catch(() => ({}));
    const workerId = body.worker_id || request.headers.get('x-worker-id') || 'unknown';
    const job = await svc.jobRepo.claimPendingJob(workerId);
    if (job) await svc.jobRepo.updateWorkerActivity(workerId, job.id, 'ACTIVE');
    if (!job) return jsonResponse({ job: null, message: 'No pending jobs available' });
    let downloadUrl = null;
    if (job.r2_raw_key && job.r2_raw_key !== 'url-import-pending') {
        downloadUrl = await svc.getRawPresignedDownloadUrl(job.r2_raw_key, 3600);
    }
    return jsonResponse({ ...job, download_url: downloadUrl, source_url: job.source_url || undefined });
}

async function routeJobStatus(request, svc, env) {
    assertWorkerAuth(request, env);
    await updateAgentLastActivity(request, env);
    const body = await request.json().catch(() => null);
    const { job_id, worker_id, status, download_progress, download_bytes, download_total, checkpoint } = body;
    const workerId = worker_id || request.headers.get('x-worker-id') || '';
    const job = await svc.jobRepo.updateJobStatus(job_id, workerId, status, { download_progress, download_bytes, download_total });
    if (checkpoint) await svc.jobRepo.updateJobCheckpoint(job_id, workerId, checkpoint);
    await svc.jobRepo.updateWorkerActivity(workerId, job_id, status);
    return jsonResponse({ success: true, job_id: job.id, status: job.status });
}

async function routePresignedUpload(request, svc, env) {
    assertWorkerAuth(request, env);
    const body = await request.json().catch(() => null);
    const { job_id, worker_id, bucket, key, content_type } = body;
    const result = await svc.getPresignedUploadForAgent(job_id, worker_id, bucket, key, content_type || 'video/mp4');
    return jsonResponse(result);
}

async function routeUrlImportDone(request, svc, env) {
    assertWorkerAuth(request, env);
    await updateAgentLastActivity(request, env);
    const body = await request.json().catch(() => null);
    const { job_id, worker_id, r2_raw_key, file_size_input } = body;
    const job = await svc.urlImportDone(job_id, worker_id, r2_raw_key, file_size_input || 0);
    await svc.jobRepo.updateWorkerActivity(worker_id, job_id, 'ACTIVE');
    return jsonResponse({ success: true, job_id: job.id, r2_raw_key });
}

async function routeCompleteJob(request, svc, env) {
    assertWorkerAuth(request, env);
    await updateAgentLastActivity(request, env);
    const data = await request.json().catch(() => null);
    const { job_id, worker_id, public_url, file_size_output, duration } = data;
    const job = await svc.jobRepo.completeJob(job_id, worker_id, data);
    await svc.jobRepo.updateWorkerActivity(worker_id, job_id, 'ACTIVE');
    if (CONFIG.DELETE_RAW_AFTER_PROCESSING && job.r2_raw_key && job.r2_raw_key !== 'url-import-pending') {
        await svc.deleteRawObjectIfExists(job.r2_raw_key);
    }
    return jsonResponse({ success: true, job_id: job.id, uri: `/api/videos/${job.id}` });
}

async function routeFailJob(request, svc, env) {
    assertWorkerAuth(request, env);
    await updateAgentLastActivity(request, env);
    const data = await request.json().catch(() => null);
    const { job_id, worker_id, error_message, status } = data;
    const finalStatus = status === JOB_STATUS.PENDING ? JOB_STATUS.PENDING : JOB_STATUS.FAILED;
    const job = await svc.jobRepo.failJob(job_id, worker_id, { error_message, status: finalStatus });
    await svc.jobRepo.updateWorkerActivity(worker_id, job_id, finalStatus);
    await svc.deleteRawObjectIfExists(job.r2_raw_key);
    return jsonResponse({ success: true, job_id: job.id, status: job.status });
}

async function routeInterruptJob(request, svc, env) {
    assertWorkerAuth(request, env);
    const data = await request.json().catch(() => null);
    const { job_id, worker_id, stage } = data;
    const job = await svc.jobRepo.setJobInterrupted(job_id, worker_id, stage || '');
    return jsonResponse({ success: true, job_id: job.id, status: JOB_STATUS.INTERRUPTED });
}

async function routeGetInterruptedJobs(request, svc, env) {
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));
    const jobs = await svc.jobRepo.getInterruptedJobs({ limit });
    return jsonResponse({ jobs, count: jobs.length });
}

async function routeRetryInterruptedJobs(request, svc, env) {
    const data = await request.json().catch(() => ({}));
    const jobIds = data.job_ids || [];
    const count = await svc.jobRepo.retryInterruptedJobIds(jobIds);
    return jsonResponse({ success: true, retried: count });
}

async function routeReprocessJobs(request, svc, env, ctx) {
    const auth = await requireAuth(request, env);
    const body = await request.json().catch(() => ({}));
    const jobIds = body.job_ids || [];
    const result = await svc.reprocessJobs(jobIds, auth.user, auth.isRoot);
    notifyAgentWakeup(env, ctx);
    return jsonResponse(result);
}

async function routeWakeup(request, svc, env, ctx) {
    await requireAuth(request, env);
    const result = await doAgentWakeup(env);
    return jsonResponse({ ok: result.ok });
}

async function routeHeartbeat(request, svc, env) {
    assertWorkerAuth(request, env);
    await updateAgentLastActivity(request, env);
    const data = await request.json().catch(() => ({}));
    const { worker_id = 'unknown', status = 'ACTIVE' } = data;
    await svc.jobRepo.updateWorkerHeartbeat(worker_id, { status });
    return jsonResponse({ success: true });
}

async function routePostSystemAlert(request, svc, env) {
    assertWorkerAuth(request, env);
    const { status, message } = await request.json();
    const result = await env.DB.prepare('INSERT INTO system_alerts (status, message) VALUES (?, ?) RETURNING id').bind(status, message).first();
    return jsonResponse({ success: true, id: result.id });
}

async function routeGetSystemAlerts(request, svc, env) {
    await requireAuth(request, env);
    const rows = await env.DB.prepare('SELECT * FROM system_alerts ORDER BY created_at DESC LIMIT 20').all();
    return jsonResponse({ alerts: rows.results });
}

async function routeGetAlerts(request, svc, env) {
    await requireAuth(request, env);
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const row = await env.DB.prepare('SELECT * FROM system_alerts WHERE created_at >= ? ORDER BY created_at DESC LIMIT 1').bind(cutoff).first();
    return jsonResponse(row || {});
}

async function routeMarkZombieJobs(request, svc, env) {
    const ZOMBIE_TIMEOUT_MIN = 45;
    const cutoff = new Date(Date.now() - ZOMBIE_TIMEOUT_MIN * 60 * 1000).toISOString();
    const result = await env.DB.prepare('UPDATE conversion_jobs SET status = ? WHERE status = ? AND started_at < ? RETURNING id').bind(JOB_STATUS.FAILED, JOB_STATUS.PROCESSING, cutoff).all();
    return jsonResponse({ success: true, marked: (result.results || []).length });
}

async function routeUpdateCheckpoint(request, svc, env) {
    assertWorkerAuth(request, env);
    const { job_id, worker_id, checkpoint } = await request.json();
    const updated = await svc.jobRepo.updateJobCheckpoint(job_id, worker_id, checkpoint);
    return jsonResponse({ ok: !!updated });
}

async function routeGetStatus(request, svc, env) {
    await requireAuth(request, env);
    const heartbeats = await svc.jobRepo.getWorkerHeartbeats();
    return jsonResponse({ workers: heartbeats });
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}

function normalizeQuality(q) {
    if (!q) return '';
    const s = String(q).toLowerCase();
    if (['720p', '720p_web'].includes(s)) return '720p';
    if (['1080p', '1080p_web'].includes(s)) return '1080p';
    return s;
}

function notifyAgentWakeup(env, ctx) {
    const url = env.AGENT_WAKE_URL;
    if (url && ctx?.waitUntil) ctx.waitUntil(fetch(url, { method: 'POST' }).catch(() => { }));
}

async function doAgentWakeup(env) {
    const url = env.AGENT_WAKE_URL;
    if (!url) return { ok: false };
    const r = await fetch(url, { method: 'POST' });
    return { ok: r.ok };
}

function getAgentBearerToken(env) {
    return env.BK_BEARER_TOKEN || '';
}

function assertWorkerAuth(request, env) {
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${getAgentBearerToken(env)}`) throw new AuthError('Unauthorized');
}

async function updateAgentLastActivity(request, env) {
    // Logic moved to repositories or skipped for brevity
}

async function logForensicError(env, request, error) {
    logger.error('Forensic Error', { error: error.message, path: new URL(request.url).pathname });
}
