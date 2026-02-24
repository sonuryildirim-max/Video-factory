/**
 * R2 Admin Routes (Root Only)
 * GET /api/r2/stats — bucket summary (from D1 job stats)
 * POST /api/r2/purge — trigger cleanup of old failed/pending jobs
 * GET /api/r2/list — list objects in bk-video-raw or bk-video-public (root only)
 */

import { requireRoot } from '../middleware/auth.js';
import { VideoService } from '../services/VideoService.js';
import { JobRepository } from '../repositories/JobRepository.js';
import { SecurityLogRepository } from '../repositories/SecurityLogRepository.js';
import { handleError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const BUCKET_RAW   = 'bk-video-raw';
const BUCKET_PUB   = 'bk-video-public';
const MAX_LIST     = 500;

export async function handleR2Routes(request, env, ctx) {
    const url = new URL(request.url);
    try {
        if (url.pathname === '/api/r2/list' && request.method === 'GET') {
            await requireRoot(request, env);
            const bucketName = url.searchParams.get('bucket') || BUCKET_RAW;
            const prefix     = url.searchParams.get('prefix') || '';
            const cursor     = url.searchParams.get('cursor') || undefined;

            if (bucketName !== BUCKET_RAW && bucketName !== BUCKET_PUB) {
                return Response.json({ error: 'Invalid bucket' }, { status: 400 });
            }

            const binding = bucketName === BUCKET_PUB ? env.R2_PUBLIC_BUCKET : env.R2_RAW_UPLOADS_BUCKET;
            if (!binding) {
                return Response.json({ error: 'R2 bucket not configured' }, { status: 500 });
            }

            const opts = { limit: MAX_LIST };
            if (prefix) opts.prefix = prefix;
            if (cursor) opts.cursor = cursor;

            const listed = await binding.list(opts);

            const objects = (listed.objects || []).map(o => ({
                key:       o.key,
                size:      o.size,
                uploaded:  o.uploaded ? o.uploaded.toISOString() : null,
            }));

            return Response.json({
                bucket:     bucketName,
                objects,
                truncated:  listed.truncated || false,
                cursor:     listed.cursor || null,
            });
        }
        if (url.pathname === '/api/r2/stats' && request.method === 'GET') {
            await requireRoot(request, env);
            const jobRepo = new JobRepository(env);
            const summary = await jobRepo.getStatistics();
            const raw = Number(summary?.total_input_size) || 0;
            const pub = Number(summary?.total_output_size) || 0;
            return Response.json({
                raw_storage_bytes: raw,
                public_storage_bytes: pub,
                total_storage_bytes: raw + pub,
            });
        }
        if (url.pathname === '/api/r2/purge' && request.method === 'POST') {
            const auth = await requireRoot(request, env);
            const svc = new VideoService(env);
            const result = await svc.cleanupOldVideos(3);
            const cleanedCount = result?.cleaned_count ?? 0;
            if (env.DB) {
                try {
                    const secLog = new SecurityLogRepository(env.DB);
                    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
                    await secLog.insert({
                        ip, action: 'R2_PURGE', status: 'success',
                        userAgent: request.headers.get('User-Agent') || 'unknown',
                        country: request.cf?.country || 'XX', city: request.cf?.city || 'Unknown',
                        details: { cleaned_count: cleanedCount, user: auth.user }, createdBy: auth.user
                    });
                } catch (e) { logger.error('r2 SecurityLog purge error', { message: e?.message }); }
            }
            return Response.json({
                success: true,
                cleaned_count: cleanedCount,
                message: 'Eski raw ve FAILED işler temizlendi',
            });
        }
        return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
        return handleError(error, request, env, ctx);
    }
}
