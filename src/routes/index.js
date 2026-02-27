/**
 * Route Dispatcher — BK Video Factory
 */

import { handleAuthRoutes } from './auth.js';
import { handleUserRoutes } from './users.js';
import { handleR2Routes } from './r2.js';
import { handleVideoRoutes } from './videos.js';
import { handleFolderRoutes } from './folders.js';
import { handleAdminRoutes } from './admin.js';
import { handleSecurityLogs, handleSecurityStats, handleSecurityBanned, handleAppLogs, handleLogsProcessing, handleLogsStorage, handleLogsAgentHealth } from './security.js';
import { AgentHealthLogRepository } from '../repositories/AgentHealthLogRepository.js';
import { JobRepository } from '../repositories/JobRepository.js';
import { handleError, sendSamaritanIntrusionAlert } from '../utils/errors.js';
import { timingSafeEqual } from '../utils/security.js';
import { CONFIG } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { writeSystemLog } from '../utils/systemLog.js';

/** Get R2 storage stats using Worker bucket bindings (no S3 API needed). Returns { rawBytes, rawCount, pubBytes, pubCount }. */
async function getR2StorageFromBindings(env) {
    const out = { rawBytes: 0, rawCount: 0, pubBytes: 0, pubCount: 0 };
    const rawBucket = env.R2_RAW_UPLOADS_BUCKET;
    const pubBucket = env.R2_PUBLIC_BUCKET;
    if (rawBucket) {
        let cursor;
        do {
            const opts = { limit: 1000 };
            if (cursor) opts.cursor = cursor;
            const listed = await rawBucket.list(opts);
            for (const obj of listed.objects || []) {
                out.rawBytes += Number(obj.size) || 0;
                out.rawCount += 1;
            }
            cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);
    }
    if (pubBucket) {
        let cursor;
        do {
            const opts = { limit: 1000 };
            if (cursor) opts.cursor = cursor;
            const listed = await pubBucket.list(opts);
            for (const obj of listed.objects || []) {
                out.pubBytes += Number(obj.size) || 0;
                out.pubCount += 1;
            }
            cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);
    }
    return out;
}

/** Samaritan ping — agent telemetry; X-Samaritan-Secret required; stores last_agent_telemetry (JSON) */
async function handleSamaritanPing(request, env) {
    const secret = request.headers.get('X-Samaritan-Secret') || '';
    const expected = env?.SAMARITAN_SECRET || '';
    if (!expected || !timingSafeEqual(secret, expected)) {
        const ip = request?.headers?.get?.('CF-Connecting-IP') || 'unknown';
        let path = '';
        try { path = new URL(request?.url || '').pathname; } catch (_) {}
        writeSystemLog(env, { level: 'ERROR', category: 'AUTH', message: 'Unauthorized (Samaritan ping)', details: { ip, method: request?.method || 'unknown', path } }).catch(() => {});
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!env.DB) {
        return Response.json({ error: 'DB not configured' }, { status: 503 });
    }
    let telemetry = { timestamp: new Date().toISOString() };
    try {
        const ct = request.headers.get('Content-Type') || '';
        if (ct.includes('application/json')) {
            const body = await request.json();
            telemetry = {
                cpu: body.cpu ?? 0,
                ram: body.ram ?? 0,
                uptime_hours: body.uptime_hours ?? 0,
                jobs: body.jobs ?? 0,
                node: body.node ?? 'Primary Core',
                timestamp: body.timestamp || telemetry.timestamp,
            };
        }
    } catch (_) {}
    const valueJson = JSON.stringify(telemetry);
    await env.DB.prepare(
        `INSERT OR REPLACE INTO config (key, value, description) VALUES ('last_agent_telemetry', ?, 'Last agent telemetry (JSON)')`
    ).bind(valueJson).run();
    try {
        const healthLog = new AgentHealthLogRepository(env.DB);
        const workerId = telemetry.node || 'Primary Core';
        const ramPct = typeof telemetry.ram === 'number' && telemetry.ram >= 0 && telemetry.ram <= 100 ? telemetry.ram : null;
        await healthLog.insert({
            workerId,
            status: 'ACTIVE',
            ramUsedPct: ramPct,
            details: { cpu: telemetry.cpu, uptime_hours: telemetry.uptime_hours, jobs: telemetry.jobs, timestamp: telemetry.timestamp },
        });
    } catch (e) { logger.warn('AgentHealthLog insert (Samaritan)', { message: e?.message }); }
    return Response.json({ ok: true, timestamp: telemetry.timestamp });
}

/** Send a Telegram message (HTML). */
async function sendTelegramMessage(token, chatId, text) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    if (!res.ok) throw new Error(`Telegram ${res.status}`);
}

/** Build D1 keys for R2 sync (public URLs -> bucket keys). */
function publicKeysFromUrls(publicUrls, cdnBase) {
    const base = (cdnBase || '').replace(/\/$/, '');
    return new Set(
        (publicUrls || [])
            .map(url => {
                if (!url || !base) return '';
                const s = String(url).trim();
                if (s.startsWith(base)) return s.slice(base.length).replace(/^\//, '');
                try {
                    return new URL(s).pathname.replace(/^\/public\/?/, '').replace(/^\//, '');
                } catch {
                    return '';
                }
            })
            .filter(Boolean)
    );
}

/** Format bytes as MB or GB for Telegram. */
function formatBytes(bytes) {
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${Math.round(mb * 100) / 100} MB`;
}

/** Escape for Telegram HTML parse_mode (avoid breaking on < > &). */
function escapeHtml(s) {
    if (s == null || s === '') return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Fetch stats from D1 for Telegram /stats and gün sonu raporu.
 * @param {object} env - Worker env (DB)
 * @returns {Promise<{ completedToday: number, failedToday: number, avgProcessingTimeSeconds: number, queueCount: number }>}
 */
export async function getStatsFromD1(env) {
    const jobRepo = new JobRepository(env);
    const [today, stats, avgSec] = await Promise.all([
        jobRepo.getTodayJobMetrics(),
        jobRepo.getStatistics(),
        jobRepo.getTodayAvgProcessingTimeSeconds(),
    ]);
    const queueCount = (Number(stats.pending_jobs) || 0) + (Number(stats.url_import_queued_jobs) || 0) + (Number(stats.processing_jobs) || 0);
    return {
        completedToday: today.completedToday ?? 0,
        failedToday: today.failedToday ?? 0,
        avgProcessingTimeSeconds: avgSec,
        queueCount,
    };
}

/**
 * Format stats as Telegram HTML message.
 * @param {object} stats - From getStatsFromD1()
 * @param {boolean} forEndOfDay - If true, do not add a title (caller adds GÜN SONU RAPORU).
 */
export function formatStatsMessage(stats, forEndOfDay = false) {
    const avgSec = stats.avgProcessingTimeSeconds ?? 0;
    const avgMin = avgSec >= 60 ? `${Math.floor(avgSec / 60)} dk ${avgSec % 60} sn` : `${avgSec} sn`;
    const lines = [
        `   📹 Bugun islenen video: ${stats.completedToday ?? 0}`,
        `   ⏱ Ortalama isleme suresi: ${avgMin}`,
        `   ⏳ Kuyrukta bekleyenler: ${stats.queueCount ?? 0}`,
    ];
    if (!forEndOfDay) {
        lines.unshift('<b>Istatistik</b>');
    }
    return lines.join('\n');
}

/** Telegram webhook — /start (help) and /status (full system check); only accept from TELEGRAM_CHAT_ID */
async function handleTelegramWebhook(request, env, ctx) {
    const token = env?.TELEGRAM_TOKEN;
    const allowedChatId = String(env?.TELEGRAM_CHAT_ID || '').trim();
    if (!token || !allowedChatId || !env.DB) {
        return Response.json({ ok: false }, { status: 400 });
    }
    let body;
    try {
        body = await request.json();
    } catch (_) {
        return Response.json({ ok: false }, { status: 400 });
    }
    const chatId = body?.message?.chat?.id;
    if (String(chatId) !== allowedChatId) {
        if (ctx?.waitUntil) {
            ctx.waitUntil(sendSamaritanIntrusionAlert(env, String(chatId), body?.message?.text || ''));
        } else {
            sendSamaritanIntrusionAlert(env, String(chatId), body?.message?.text || '');
        }
        return Response.json({ ok: false }, { status: 403 });
    }
    const text = (body?.message?.text || '').trim();
    const normalized = text.toLowerCase();

    // ——— /start or "Start" → full help (commands + notifications) ———
    if (normalized === '/start' || normalized === 'start') {
        const helpLines = [
            '<b>Sorabilecegin komutlar</b>',
            '/status — Tam sistem ozeti (depolama, kuyruk, ajanlar, hatalar)',
            '/depolama — R2 depolama: Public/Raw dosya sayisi ve boyut',
            '/kuyruk — Kuyruktaki is sayisi',
            '/videos — Toplam video sayisi',
            '/bugun — Bugun tamamlanan ve basarisiz is sayisi',
            '/stats — Bugun islenen video, ortalama isleme suresi, kuyruk',
            '/ajanlar — Son 5 dk heartbeat atan ajanlar',
            '/hatalar — Son 5 hata',
            '',
            '<b>Alabilecegin bildirimler</b>',
            '• Sistem acilisi (Wakeup)',
            '• Rutin kontrol (6 saatte bir: CPU, RAM, uptime)',
            '• Sinyal kaybi (12 dk heartbeat yok)',
            '• Video tamamlandi (Asset Acquired, thumbnail)',
            '• Kesilmis isler / otomatik retry',
            '• Yetkisiz webhook erisimi (Intrusion)',
            '• API guvenlik uyarisi (401/403)',
            '• Edge 500 hatasi (System Anomaly)',
            '• Kritik baglanti hatasi, RAM uyari'
        ];
        try {
            await sendTelegramMessage(token, chatId, helpLines.join('\n'));
        } catch (e) {
            logger.error('Telegram sendMessage error', { message: e?.message });
        }
        return Response.json({ ok: true });
    }

    const jobRepo = new JobRepository(env);

    // ——— /depolama ———
    if (text === '/depolama') {
        try {
            const r2 = await getR2StorageFromBindings(env);
            const rawBytes = r2.rawBytes ?? 0;
            const pubBytes = r2.pubBytes ?? 0;
            const rawCount = r2.rawCount ?? 0;
            const pubCount = r2.pubCount ?? 0;
            const totalMb = Math.round(((rawBytes + pubBytes) / (1024 * 1024)) * 100) / 100;
            const msg = [
                '📁 <b>Depolama</b>',
                `   Toplam: ${rawCount + pubCount} dosya, ${totalMb} MB`,
                `   🟢 Public: ${formatBytes(pubBytes)} (${pubCount} dosya)`,
                `   🟡 Raw: ${formatBytes(rawBytes)} (${rawCount} dosya)`
            ].join('\n');
            await sendTelegramMessage(token, chatId, msg);
        } catch (e) {
            logger.error('Telegram /depolama failed', { message: e?.message });
            try { await sendTelegramMessage(token, chatId, '⚠️ Depolama verisi alinamadi.'); } catch (_) {}
        }
        return Response.json({ ok: true });
    }

    // ——— /kuyruk ———
    if (text === '/kuyruk') {
        try {
            const s = await jobRepo.getStatistics();
            const queue = (Number(s.pending_jobs) || 0) + (Number(s.url_import_queued_jobs) || 0) + (Number(s.processing_jobs) || 0);
            const msg = `⏳ <b>Kuyruk</b>\n   Bekleyen + islemdeki is: ${queue}`;
            await sendTelegramMessage(token, chatId, msg);
        } catch (e) {
            logger.error('Telegram /kuyruk failed', { message: e?.message });
            try { await sendTelegramMessage(token, chatId, '⚠️ Kuyruk verisi alinamadi.'); } catch (_) {}
        }
        return Response.json({ ok: true });
    }

    // ——— /videos ———
    if (text === '/videos') {
        try {
            const s = await jobRepo.getStatistics();
            const total = Number(s.total_jobs) || 0;
            const msg = `🎬 <b>Videos</b>\n   Toplam video (silinenler haric): ${total}`;
            await sendTelegramMessage(token, chatId, msg);
        } catch (e) {
            logger.error('Telegram /videos failed', { message: e?.message });
            try { await sendTelegramMessage(token, chatId, '⚠️ Video sayisi alinamadi.'); } catch (_) {}
        }
        return Response.json({ ok: true });
    }

    // ——— /bugun ———
    if (text === '/bugun') {
        try {
            const today = await jobRepo.getTodayJobMetrics();
            const msg = [
                '🎬 <b>Bugun</b>',
                `   ✅ Tamamlanan: ${today.completedToday ?? 0}`,
                `   ❌ Basarisiz: ${today.failedToday ?? 0}`
            ].join('\n');
            await sendTelegramMessage(token, chatId, msg);
        } catch (e) {
            logger.error('Telegram /bugun failed', { message: e?.message });
            try { await sendTelegramMessage(token, chatId, '⚠️ Bugun verisi alinamadi.'); } catch (_) {}
        }
        return Response.json({ ok: true });
    }

    // ——— /stats ———
    if (text === '/stats') {
        try {
            const stats = await getStatsFromD1(env);
            const msg = formatStatsMessage(stats, false);
            await sendTelegramMessage(token, chatId, msg);
        } catch (e) {
            logger.error('Telegram /stats failed', { message: e?.message });
            try { await sendTelegramMessage(token, chatId, '⚠️ Istatistik alinamadi.'); } catch (_) {}
        }
        return Response.json({ ok: true });
    }

    // ——— /ajanlar ———
    if (text === '/ajanlar') {
        try {
            const agents = await jobRepo.getRecentWorkerHeartbeats(5);
            const lines = ['🤖 <b>Ajanlar</b> (son 5 dk heartbeat)'];
            if (agents.length === 0) {
                lines.push('   Aktif ajan yok.');
            } else {
                for (const a of agents) {
                    let timeAgo = '—';
                    if (a.last_heartbeat) {
                        const ms = Date.now() - new Date(a.last_heartbeat).getTime();
                        const mins = Math.floor(ms / 60000);
                        timeAgo = mins < 1 ? 'simdi' : `${mins} dk once`;
                    }
                    const ip = (a.ip_address || '').trim() || '—';
                    lines.push(`   ${escapeHtml(a.worker_id || '?')} | IP: ${escapeHtml(ip)} | ${timeAgo}`);
                }
            }
            await sendTelegramMessage(token, chatId, lines.join('\n'));
        } catch (e) {
            logger.error('Telegram /ajanlar failed', { message: e?.message });
            try { await sendTelegramMessage(token, chatId, '⚠️ Ajan verisi alinamadi.'); } catch (_) {}
        }
        return Response.json({ ok: true });
    }

    // ——— /hatalar ———
    if (text === '/hatalar') {
        try {
            const errorRows = (await env.DB.prepare(
                'SELECT created_at, message, status_code FROM errors ORDER BY created_at DESC LIMIT 5'
            ).all()).results || [];
            const lines = ['⚠️ <b>Son 5 Hata</b>'];
            if (errorRows.length === 0) {
                lines.push('   (kayit yok)');
            } else {
                for (const row of errorRows) {
                    const when = row.created_at ? new Date(row.created_at).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
                    const msg = (row.message || '').slice(0, 60) + ((row.message || '').length > 60 ? '…' : '');
                    lines.push(`   [${when}] ${row.status_code}: ${escapeHtml(msg)}`);
                }
            }
            await sendTelegramMessage(token, chatId, lines.join('\n'));
        } catch (e) {
            logger.error('Telegram /hatalar failed', { message: e?.message });
            try { await sendTelegramMessage(token, chatId, '⚠️ Hata listesi alinamadi.'); } catch (_) {}
        }
        return Response.json({ ok: true });
    }

    // ——— /status → full system check ———
    if (text === '/status') {
    const SPLIT_THRESHOLD = 4000;

    try {
        // ——— Data: errors (last 5), R2, today metrics, agents ———
        let errorRows = [];
        let rawBytes = 0, pubBytes = 0, rawCount = 0, pubCount = 0;
        let completedToday = 0, failedToday = 0;
        let agents = [];

        try {
            errorRows = (await env.DB.prepare(
                'SELECT created_at, message, status_code FROM errors ORDER BY created_at DESC LIMIT 5'
            ).all()).results || [];
        } catch (_) {}

        try {
            const r2 = await getR2StorageFromBindings(env);
            rawBytes = r2.rawBytes ?? 0;
            pubBytes = r2.pubBytes ?? 0;
            rawCount = r2.rawCount ?? 0;
            pubCount = r2.pubCount ?? 0;
        } catch (e) {
            logger.warn('R2 status failed', { message: e?.message });
        }

        try {
            const today = await jobRepo.getTodayJobMetrics();
            completedToday = today.completedToday;
            failedToday = today.failedToday;
        } catch (_) {}

        try {
            agents = await jobRepo.getRecentWorkerHeartbeats(5);
        } catch (_) {}

        const totalFiles = rawCount + pubCount;
        const totalMb = Math.round(((rawBytes + pubBytes) / (1024 * 1024)) * 100) / 100;

        // ——— Son 5 Olay (Live Feed): time, category, message; errors with red emoji ———
        const liveFeedLines = ['📡 <b>Son 5 Olay (Live Feed)</b>'];
        for (const row of errorRows) {
            const when = row.created_at ? new Date(row.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
            const category = (row.status_code >= 500) ? 'error' : 'info';
            const msg = (row.message || '').slice(0, 80) + ((row.message || '').length > 80 ? '…' : '');
            const prefix = row.status_code >= 500 ? '🔴 ' : '';
            liveFeedLines.push(`   ${prefix}[${when}] ${category}: ${escapeHtml(msg)}`);
        }
        if (errorRows.length === 0) {
            liveFeedLines.push('   (kayit yok)');
        }

        // ——— Depolama Gerçeği ———
        const storageLines = [
            '📁 <b>Depolama Gerçeği</b>',
            `   Toplam: ${totalFiles} dosya, ${totalMb} MB`,
            `   🟢 Public: ${formatBytes(pubBytes)} (${pubCount} dosya)`,
            `   🟡 Raw: ${formatBytes(rawBytes)} (${rawCount} dosya)`
        ];

        // ——— İşlem Metrikleri (bugün) ———
        const metricsLines = [
            '🎬 <b>İşlem Metrikleri</b>',
            `   Bugün: ✅ ${completedToday} başarılı, ❌ ${failedToday} failed`
        ];

        // ——— Ajan Bilgisi: IP, son görülme, son işlenen job ID ———
        const agentLines = ['🤖 <b>Ajan Bilgisi</b>'];
        if (agents.length === 0) {
            agentLines.push('   Aktif ajan: 0');
        } else {
            for (const a of agents) {
                let timeAgo = '—';
                if (a.last_heartbeat) {
                    const ms = Date.now() - new Date(a.last_heartbeat).getTime();
                    const mins = Math.floor(ms / 60000);
                    timeAgo = mins < 1 ? 'şimdi' : `${mins} dk önce`;
                }
                const jobInfo = a.current_job_id != null ? `Son iş: #${a.current_job_id}` : 'Son iş: —';
                const ip = (a.ip_address || '').trim() || '—';
                agentLines.push(`   IP: ${escapeHtml(ip)} | Son görülme: ${timeAgo} | ${jobInfo}`);
            }
        }

        // ——— Özet (short) ———
        const agentSummary = agents.length === 0
            ? '🤖 Ajan: 0 aktif'
            : (() => {
                const a = agents[0];
                let t = '—';
                if (a?.last_heartbeat) {
                    const ms = Date.now() - new Date(a.last_heartbeat).getTime();
                    const m = Math.floor(ms / 60000);
                    t = m < 1 ? 'şimdi' : `${m} dk önce`;
                }
                return `🤖 Ajan: ${agents.length} aktif, son görülme: ${t}`;
            })();
        const summaryLines = [
            '🔎 <b>ÖZET</b>',
            `📁 Depolama: ${totalFiles} dosya, ${totalMb} MB`,
            `🎬 Bugün: ${completedToday} başarılı, ${failedToday} failed`,
            agentSummary
        ];

        // ——— Detay (full) ———
        const detailLines = [
            '📋 <b>DETAY</b>',
            '',
            ...liveFeedLines,
            '',
            ...storageLines,
            '',
            ...metricsLines,
            '',
            ...agentLines
        ];

        const summaryMessage = summaryLines.join('\n');
        const detailMessage = detailLines.join('\n');
        const fullMessage = ['🚀 <b>BKVF SISTEM DURUMU</b>', '', summaryMessage, '', detailMessage].join('\n');

        if (fullMessage.length > SPLIT_THRESHOLD) {
            await sendTelegramMessage(token, chatId, summaryMessage);
            await sendTelegramMessage(token, chatId, detailMessage);
        } else {
            await sendTelegramMessage(token, chatId, fullMessage);
        }
    } catch (e) {
        logger.error('Telegram status build failed', { message: e?.message });
        try {
            await sendTelegramMessage(token, chatId, '⚠️ Veri toplanirken hata.');
        } catch (e2) {
            logger.error('Telegram sendMessage error', { message: e2?.message });
        }
    }
    return Response.json({ ok: true });
    }

    return Response.json({ ok: true });
}

/**
 * Route request to appropriate handler
 */
export async function routeRequest(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.slice(1).split('/')[0];
    const fullPath = url.pathname;

    try {
        // Health check
        if (path === 'health') {
            return Response.json({
                status: 'healthy',
                version: '2.0.0',
                timestamp: Date.now()
            });
        }

        // Dashboard / — serve video-dashboard.html (root SPA entry)
        if (!path || path === '') {
            if (env.ASSETS) {
                const dashUrl = new URL('/video-dashboard.html', request.url);
                const res = await env.ASSETS.fetch(dashUrl);
                if (res.status !== 404) return res;
            }
        }

        // Auth routes
        if (fullPath === '/login' || fullPath === '/api/login' || fullPath === '/api/logout' || fullPath === '/api/me' || fullPath === '/api/verify-otp') {
            return await handleAuthRoutes(request, env, ctx);
        }

        // User management (root only)
        if (fullPath.startsWith('/api/users')) {
            return await handleUserRoutes(request, env, ctx);
        }

        // R2 admin (root only) — includes bucket list
        if (fullPath.startsWith('/api/r2')) {
            return await handleR2Routes(request, env, ctx);
        }

        // Security / Monitoring routes (auth required)
        if (fullPath === '/api/security/logs') return await handleSecurityLogs(request, env);
        if (fullPath === '/api/security/stats') return await handleSecurityStats(request, env);
        if (fullPath === '/api/security/banned') return await handleSecurityBanned(request, env);
        if (fullPath === '/api/logs/app') return await handleAppLogs(request, env);
        if (fullPath === '/api/logs/processing') return await handleLogsProcessing(request, env);
        if (fullPath === '/api/logs/storage') return await handleLogsStorage(request, env);
        if (fullPath === '/api/logs/agent-health') return await handleLogsAgentHealth(request, env);

        // Folders API
        if (fullPath.startsWith('/api/folders')) {
            return await handleFolderRoutes(request, env);
        }

        // Samaritan ping (agent telemetry) — X-Samaritan-Secret required
        if (fullPath === '/api/samaritan/ping') {
            return await handleSamaritanPing(request, env);
        }

        // Telegram webhook — /status command (TELEGRAM_CHAT_ID only)
        if (fullPath === '/api/telegram/webhook') {
            return await handleTelegramWebhook(request, env, ctx);
        }

        // Video Factory routes
        if (fullPath.startsWith('/api/videos') || fullPath.startsWith('/api/jobs') || fullPath === '/api/heartbeat' || fullPath === '/api/status' || fullPath === '/api/upload') {
            return await handleVideoRoutes(request, env, ctx);
        }

        // Admin — redirect to Video Factory dashboard
        if (fullPath === '/admin') {
            return Response.redirect(new URL('/video-dashboard.html', request.url).toString(), 302);
        }

        // Admin routes (root only) — must come before legacy redirect
        if (fullPath.startsWith('/api/admin/')) {
            return await handleAdminRoutes(request, env, ctx);
        }

        // Legacy API routes — redirect to main site
        if (fullPath.startsWith('/api/shorten') ||
            fullPath.startsWith('/api/stats') || fullPath.startsWith('/api/links') ||
            fullPath.startsWith('/api/analytics') || fullPath === '/logs' || fullPath === '/api/logs') {
            return Response.redirect(CONFIG.MAIN_SITE, 302);
        }

        // /library → serve video-dashboard.html (URL stays /library)
        if (fullPath === '/library') {
            if (env.ASSETS) {
                const dashUrl = new URL('/video-dashboard.html', request.url);
                const res = await env.ASSETS.fetch(dashUrl);
                if (res.status !== 404) return res;
            }
        }

        // /folders → serve video-dashboard.html (URL stays /folders)
        if (fullPath === '/folders') {
            if (env.ASSETS) {
                const dashUrl = new URL('/video-dashboard.html', request.url);
                const res = await env.ASSETS.fetch(dashUrl);
                if (res.status !== 404) return res;
            }
        }

        // Static assets fallback (video-dashboard.html, video-upload.html, *.js, etc.)
        if (env.ASSETS) {
            const assetRes = await env.ASSETS.fetch(request);
            if (assetRes.status !== 404) return assetRes;
        }

        return Response.redirect(CONFIG.MAIN_SITE, 302);

    } catch (error) {
        return handleError(error, request, env, ctx);
    }
}