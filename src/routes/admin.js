/**
 * Admin Routes
 */

import { requireRoot } from '../middleware/auth.js';
import { handleError } from '../utils/errors.js';
import { SECURITY_HEADERS } from '../config/constants.js';
import { cleanupOrphanedUploads } from '../services/R2MultipartCleanup.js';
import { SecurityLogRepository } from '../repositories/SecurityLogRepository.js';
import { logger } from '../utils/logger.js';
import { writeSystemLog } from '../utils/systemLog.js';

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
            const auth = await requireRoot(request, env);

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

            if (env.DB) {
                try {
                    const secLog = new SecurityLogRepository(env.DB);
                    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
                    await secLog.insert({
                        ip,
                        action: 'ADMIN_CLEANUP_R2',
                        status: 'success',
                        userAgent: request.headers.get('User-Agent') || null,
                        country: request.cf?.country || 'XX',
                        city: request.cf?.city || 'Unknown',
                        details: { deleted_raw_count, deleted_trash_count },
                        createdBy: auth?.user || null,
                    });
                } catch (e) { logger.warn('ADMIN_CLEANUP_R2 log failed', { message: e?.message }); }
            }
            const ipCleanup = request.headers.get('CF-Connecting-IP') || 'unknown';
            writeSystemLog(env, { level: 'INFO', category: 'R2', message: 'R2 cleanup (orphans)', details: { ip: ipCleanup, method: request.method, deleted_raw_count, deleted_trash_count } }).catch(() => {});
            return Response.json({ deleted_raw_count, deleted_trash_count });
        }

        // POST /api/admin/purge-raw (NUKE) — R2_RAW_BUCKET içindeki TÜM nesneleri fiziksel sil; D1'de ilgili kayıtları "Storage Cleaned" işaretle. PUBLIC kovanına dokunma.
        if (request.method === 'POST' && url.pathname === '/api/admin/purge-raw') {
            const auth = await requireRoot(request, env);
            const rawBucket = env.R2_RAW_UPLOADS_BUCKET;
            if (!rawBucket) return Response.json({ error: "RAW_BUCKET bulunamadı!" }, { status: 500 });
            if (!env.DB) return Response.json({ error: "DB yapılandırılmadı!" }, { status: 500 });

            const multipartResult = await cleanupOrphanedUploads(env);
            const aborted = multipartResult?.aborted ?? 0;

            // 1) D1: COMPLETED + completed_at < 1 saat, geçerli r2_raw_key, henüz temizlenmemiş — işaretlenecek id'ler
            const rows = await env.DB.prepare(`
                SELECT id, r2_raw_key FROM conversion_jobs
                WHERE status = 'COMPLETED'
                  AND completed_at < datetime('now', '-1 hour')
                  AND r2_raw_key IS NOT NULL AND r2_raw_key != '' AND r2_raw_key != 'url-import-pending'
                  AND (storage_cleaned_at IS NULL)
                  AND (deleted_at IS NULL)
            `).all();
            const jobs = rows?.results ?? rows ?? [];
            const markedIds = [];

            // 2) R2_RAW_BUCKET içindeki TÜM nesneleri fiziksel olarak sil (D1'den bağımsız; yetim/orphan dahil)
            let deletedR2 = 0;
            let rawCursor;
            do {
                const opts = { limit: 1000 };
                if (rawCursor) opts.cursor = rawCursor;
                const listed = await rawBucket.list(opts);
                for (const obj of (listed.objects || [])) {
                    try {
                        await rawBucket.delete(obj.key);
                        deletedR2++;
                    } catch (_) {
                        // Tekil silme hataları yutulur, döngü devam eder
                    }
                }
                rawCursor = listed.truncated ? listed.cursor : undefined;
            } while (rawCursor);

            // 3) D1: Silinen/artık R2'de olmayan tüm ilgili kayıtları "Storage Cleaned" işaretle
            for (const job of jobs) {
                markedIds.push(job.id);
            }
            if (markedIds.length > 0) {
                const placeholders = markedIds.map(() => '?').join(',');
                await env.DB.prepare(
                    `UPDATE conversion_jobs SET storage_cleaned_at = datetime('now') WHERE id IN (${placeholders})`
                ).bind(...markedIds).run();
            }

            const msg = aborted > 0
                ? `Nuke: R2 RAW bucket tamamen boşaltıldı (${deletedR2} dosya silindi). ${markedIds.length} kayıt "Storage Cleaned", ${aborted} multipart iptal.`
                : `Nuke: R2 RAW bucket tamamen boşaltıldı (${deletedR2} dosya silindi). ${markedIds.length} kayıt "Storage Cleaned".`;
            if (env.DB) {
                try {
                    const secLog = new SecurityLogRepository(env.DB);
                    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
                    await secLog.insert({
                        ip,
                        action: 'ADMIN_NUKE',
                        status: 'success',
                        userAgent: request.headers.get('User-Agent') || null,
                        country: request.cf?.country || 'XX',
                        city: request.cf?.city || 'Unknown',
                        details: { deleted_count: deletedR2, marked_count: markedIds.length, aborted_multipart: aborted },
                        createdBy: auth?.user || null,
                    });
                } catch (e) { logger.warn('ADMIN_NUKE log failed', { message: e?.message }); }
            }
            const ipNuke = request.headers.get('CF-Connecting-IP') || 'unknown';
            writeSystemLog(env, { level: 'INFO', category: 'R2', message: 'R2 purge-raw (nuke)', details: { ip: ipNuke, method: request.method, deleted_count: deletedR2, marked_count: markedIds.length } }).catch(() => {});
            return Response.json({ success: true, message: msg, deleted_count: deletedR2, marked_count: markedIds.length });
        }

        // POST /api/admin/cleanup
        if (request.method === 'POST' && url.pathname.includes('/admin/cleanup')) {
            const auth = await requireRoot(request, env);

            const days = parseInt(url.searchParams.get('days')) || 180;
            if (days < 1 || days > 3650) {
                return Response.json({ error: 'Invalid days parameter' }, { status: 400 });
            }

            await env.DB.prepare("DELETE FROM logs WHERE timestamp < datetime('now', '-' || ? || ' days')")
                .bind(days).run();

            if (env.DB) {
                try {
                    const secLog = new SecurityLogRepository(env.DB);
                    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
                    await secLog.insert({
                        ip,
                        action: 'ADMIN_CLEANUP_LOGS',
                        status: 'success',
                        userAgent: request.headers.get('User-Agent') || null,
                        country: request.cf?.country || 'XX',
                        city: request.cf?.city || 'Unknown',
                        details: { days },
                        createdBy: auth?.user || null,
                    });
                } catch (e) { logger.warn('ADMIN_CLEANUP_LOGS log failed', { message: e?.message }); }
            }
            return Response.json({ success: true, message: `${days} günden eski veriler temizlendi` });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
        return handleError(error, request, env, ctx);
    }
}
