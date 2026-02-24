/**
 * Route Dispatcher — BK Video Factory
 */

import { handleAuthRoutes } from './auth.js';
import { handleUserRoutes } from './users.js';
import { handleR2Routes } from './r2.js';
import { handleVideoRoutes } from './videos.js';
import { handleFolderRoutes } from './folders.js';
import { handleAdminRoutes } from './admin.js';
import { handleSecurityLogs, handleSecurityStats, handleSecurityBanned, handleAppLogs } from './security.js';
import { handleError, sendSamaritanIntrusionAlert } from '../utils/errors.js';
import { timingSafeEqual } from '../utils/security.js';
import { CONFIG } from '../config/config.js';
import { logger } from '../utils/logger.js';

/** Samaritan ping — agent telemetry; X-Samaritan-Secret required; stores last_agent_telemetry (JSON) */
async function handleSamaritanPing(request, env) {
    const secret = request.headers.get('X-Samaritan-Secret') || '';
    const expected = env?.SAMARITAN_SECRET || '';
    if (!expected || !timingSafeEqual(secret, expected)) {
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
    return Response.json({ ok: true, timestamp: telemetry.timestamp });
}

/** Telegram webhook — /status command; only accept from TELEGRAM_CHAT_ID */
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
    if (text !== '/status') {
        return Response.json({ ok: true });
    }
    const row = await env.DB.prepare(
        "SELECT value FROM config WHERE key = 'last_agent_telemetry'"
    ).first();
    let cpu = '—', ram = '—', jobs = '—', timeAgo = 'never';
    const node = 'Primary Core (Hetzner)';
    if (row?.value) {
        try {
            const t = JSON.parse(row.value);
            cpu = String(t.cpu ?? '—');
            ram = String(t.ram ?? '—');
            jobs = String(t.jobs ?? '—');
            if (t.timestamp) {
                const ms = Date.now() - new Date(t.timestamp).getTime();
                const mins = Math.floor(ms / 60000);
                timeAgo = mins < 1 ? 'just now' : `${mins} min ago`;
            }
        } catch (_) {}
    }
    const reply = [
        '🔎 <b>SAMARITAN STATUS CHECK</b>',
        `[ \\ ] <b>NODE:</b> ${node}`,
        `[ > ] <b>CPU:</b> %${cpu}`,
        `[ > ] <b>RAM:</b> ${ram} GB`,
        `[ > ] <b>JOBS:</b> ${jobs}`,
        `[ ! ] <b>LAST PING:</b> ${timeAgo} ago`,
        '> <b>SYSTEM STATUS:</b> OPERATIONAL'
    ].join('\n');
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: reply,
                parse_mode: 'HTML'
            })
        });
    } catch (e) {
        logger.error('Telegram sendMessage error', { message: e?.message });
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
        if (fullPath.startsWith('/api/videos') || fullPath.startsWith('/api/jobs') || fullPath === '/api/heartbeat' || fullPath === '/api/status') {
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