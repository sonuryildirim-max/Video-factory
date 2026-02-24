/**
 * BK Video Factory — Main Entry Point
 * Edge-first video processing (Workers, D1, R2, Hetzner agent)
 */

import { routeRequest } from './routes/index.js';
import { VideoService } from './services/VideoService.js';
import { checkSignalLost, sendSignalLostAlert } from './monitoring.js';
import { cleanupOrphanedUploads } from './services/R2MultipartCleanup.js';
import { SECURITY_HEADERS } from './config/constants.js';
import { JOB_STATUS } from './config/BK_CONSTANTS.js';
import { handleCORS } from './middleware/cors.js';
import { handleError } from './utils/errors.js';
import { logger } from './utils/logger.js';

let _schemaVerified = false;
async function ensureSchemaOnce(env) {
    if (_schemaVerified || !env?.DB) return;
    _schemaVerified = true;
    const { ensureSchema } = await import('./utils/schemaVerify.js');
    await ensureSchema(env);
}

export default {
    async fetch(request, env, ctx) {
        try {
            // Redirect ONLY exact hostname v.bilgekarga.tr → bilgekarga.com.tr
            // Excludes: /admin, /api/*, /health, dashboard assets, static files, root
            const url = new URL(request.url);
            if (url.hostname === 'v.bilgekarga.tr') {
                const path = url.pathname.toLowerCase();
                const isWorkerPath = (
                    path === '/' ||
                    path === '/login' ||
                    path.startsWith('/admin') ||
                    path.startsWith('/api') ||
                    path.startsWith('/health') ||
                    path.startsWith('/video-') ||
                    path.startsWith('/library') ||
                    path.startsWith('/folders') ||
                    path.startsWith('/css/') ||
                    path.endsWith('.js') ||
                    path.endsWith('.html')
                );
                if (!isWorkerPath) {
                    return Response.redirect('https://bilgekarga.com.tr/', 302);
                }
            }

            await ensureSchemaOnce(env);

            // Handle CORS preflight
            if (request.method === 'OPTIONS') {
                return handleCORS(request, env);
            }

            // Route request
            const response = await routeRequest(request, env, ctx);

            // Add security headers and X-Request-ID to all responses
            const headers = new Headers(response.headers);
            Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
                headers.set(key, value);
            });
            const reqId = request.headers.get('X-Request-ID') || crypto.randomUUID();
            headers.set('X-Request-ID', reqId);

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: headers
            });

        } catch (error) {
            return handleError(error, request, env, ctx);
        }
    },

    /**
     * Cron trigger: daily cleanup + V17 zombie jobs (45 min processing timeout).
     * Configure in wrangler.toml: [triggers] crons = ["0 2 * * *", "every 15 min"]
     */
    async scheduled(controller, env, ctx) {
        ctx.waitUntil((async () => {
            try {
                await ensureSchemaOnce(env);

                // Signal Lost: 10 min without heartbeat → critical alert (Telegram + backup webhook)
                if (env.DB) {
                    const { lost, minutesAgo } = await checkSignalLost(env);
                    if (lost) {
                        logger.info('Cron: Signal Lost — firing critical alert', { minutesAgo });
                        await sendSignalLostAlert(env);
                    }
                }

                // V17: Mark zombie jobs (45 min processing timeout)
                if (env.DB) {
                    const ZOMBIE_TIMEOUT_MIN = 45;
                    const cutoff = new Date(Date.now() - ZOMBIE_TIMEOUT_MIN * 60 * 1000).toISOString();
                    const result = await env.DB.prepare(`
                        UPDATE conversion_jobs
                        SET status = ?, error_message = 'Zombi: 45 dk timeout'
                        WHERE status = ? AND started_at < ?
                        RETURNING id
                    `).bind(JOB_STATUS.FAILED, JOB_STATUS.PROCESSING, cutoff).all();
                    const count = (result.results || []).length;
                    if (count) {
                        logger.info('Cron: marked zombie jobs as FAILED', { count });
                    }
                }

                // R2: abort orphaned multipart uploads (24h+) on raw bucket
                const multipartResult = await cleanupOrphanedUploads(env);
                if (multipartResult.listed > 0 || multipartResult.aborted > 0) {
                    logger.info('Cron cleanupOrphanedUploads', multipartResult);
                }

                const svc = new VideoService(env);
                const days = 3;
                const result = await svc.cleanupOldVideos(days);
                logger.info('Cron cleanupOldVideos', { days, cleaned_count: result.cleaned_count });
            } catch (e) {
                logger.error('Cron scheduled failed', { error: e?.message ?? String(e) });
            }
        })());
    },
};
