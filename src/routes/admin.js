/**
 * Admin Routes
 */

import { requireRoot } from '../middleware/auth.js';
import { handleError } from '../utils/errors.js';
import { SECURITY_HEADERS } from '../config/constants.js';

/**
 * Handle admin routes
 */
export async function handleAdminRoutes(request, env, ctx) {
    const url = new URL(request.url);

    try {
        // GET /admin (HTML page)
        if (url.pathname === '/admin') {
            // Return admin HTML page (will be loaded from views later)
            return new Response('Admin page - HTML to be added', {
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=utf-8' }
            });
        }

        // POST /api/admin/reindex
        if (request.method === 'POST' && url.pathname.includes('/admin/reindex')) {
            await requireRoot(request, env);

            // Video Factory only — D1 single source; no link reindex
            return new Response('Video Factory – reindex N/A (D1 single source).', {
                status: 200,
                headers: SECURITY_HEADERS
            });
        }

        // POST /api/admin/cleanup-r2
        if (request.method === 'POST' && url.pathname === '/api/admin/cleanup-r2') {
            await requireRoot(request, env);

            if (!env.DB) return Response.json({ error: 'DB not configured' }, { status: 500 });
            const rawBucket = env.R2_RAW_UPLOADS_BUCKET;
            const delBucket = env.R2_DELETED_BUCKET;
            if (!rawBucket) return Response.json({ error: 'R2_RAW_UPLOADS_BUCKET not configured' }, { status: 500 });

            let deleted_raw_count = 0;
            let deleted_trash_count = 0;

            // ── RAW bucket orphan cleanup ────────────────────────────────────────
            // Active jobs still need their raw file; everything else is orphaned.
            const ACTIVE_STATUSES = ['PENDING', 'URL_IMPORT_QUEUED', 'PROCESSING', 'DOWNLOADING', 'CONVERTING', 'UPLOADING'];
            const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
            const activeRows = await env.DB.prepare(
                `SELECT r2_raw_key FROM conversion_jobs WHERE status IN (${placeholders}) AND r2_raw_key IS NOT NULL`
            ).bind(...ACTIVE_STATUSES).all();
            const activeRawKeys = new Set((activeRows.results || []).map(r => r.r2_raw_key).filter(Boolean));

            let rawCursor;
            do {
                const opts = { limit: 1000 };
                if (rawCursor) opts.cursor = rawCursor;
                const listed = await rawBucket.list(opts);
                for (const obj of (listed.objects || [])) {
                    if (!activeRawKeys.has(obj.key)) {
                        await rawBucket.delete(obj.key);
                        deleted_raw_count++;
                    }
                }
                rawCursor = listed.truncated ? listed.cursor : undefined;
            } while (rawCursor);

            // ── DELETED bucket orphan cleanup ────────────────────────────────────
            // Keys follow the pattern deleted/{yyyy}/{mm}/{jobId}_... — anything
            // without a matching DELETED job in D1 is orphaned.
            if (delBucket) {
                const deletedRows = await env.DB.prepare(
                    `SELECT id FROM conversion_jobs WHERE status = 'DELETED' AND deleted_at IS NOT NULL`
                ).all();
                const deletedJobIds = new Set((deletedRows.results || []).map(r => String(r.id)));

                let delCursor;
                do {
                    const opts = { limit: 1000 };
                    if (delCursor) opts.cursor = delCursor;
                    const listed = await delBucket.list(opts);
                    for (const obj of (listed.objects || [])) {
                        const match = obj.key.match(/^deleted\/\d{4}\/\d{2}\/(\d+)_/);
                        const jobId = match ? match[1] : null;
                        if (!jobId || !deletedJobIds.has(jobId)) {
                            await delBucket.delete(obj.key);
                            deleted_trash_count++;
                        }
                    }
                    delCursor = listed.truncated ? listed.cursor : undefined;
                } while (delCursor);
            }

            return Response.json({ deleted_raw_count, deleted_trash_count });
        }

        // POST /api/admin/purge-raw (NUCLEAR BUTTON)
        if (request.method === 'POST' && url.pathname === '/api/admin/purge-raw') {
            await requireRoot(request, env);
            const rawBucket = env.R2_RAW_UPLOADS_BUCKET;
            if (!rawBucket) return Response.json({ error: "RAW_BUCKET bulunamadı!" }, { status: 500 });

            let deletedCount = 0;
            let listed;
            do {
                listed = await rawBucket.list({ limit: 500 });
                if (listed.objects) {
                    for (const obj of listed.objects) {
                        await rawBucket.delete(obj.key);
                        deletedCount++;
                    }
                }
            } while (listed.truncated);

            return Response.json({ success: true, message: `Nükleer Temizlik Başarılı! Silinen RAW çöpü: ${deletedCount}` });
        }

        // POST /api/admin/cleanup
        if (request.method === 'POST' && url.pathname.includes('/admin/cleanup')) {
            await requireRoot(request, env);

            const days = parseInt(url.searchParams.get('days')) || 180;
            if (days < 1 || days > 3650) {
                return Response.json({ error: 'Invalid days parameter' }, { status: 400 });
            }

            await env.DB.prepare("DELETE FROM logs WHERE timestamp < datetime('now', '-' || ? || ' days')")
                .bind(days).run();

            return Response.json({ success: true, message: `${days} günden eski veriler temizlendi` });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
        return handleError(error, request, env, ctx);
    }
}
