/**
 * Security / Monitoring API routes
 * GET /api/security/logs  — security event logs (auth required)
 * GET /api/security/stats — security statistics (auth required)
 * GET /api/security/banned — banned IPs (auth required)
 */

import { SecurityLogRepository } from '../repositories/SecurityLogRepository.js';
import { AppLogRepository } from '../repositories/AppLogRepository.js';
import { BannedIpRepository } from '../repositories/BannedIpRepository.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * GET /api/security/logs
 * Query: startDate, endDate, action, ip, limit, offset
 */
export async function handleSecurityLogs(request, env) {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        await requireAuth(request, env);
    } catch {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const url = new URL(request.url);
    const startDate = url.searchParams.get('startDate') || null;
    const endDate = url.searchParams.get('endDate') || null;
    const action = url.searchParams.get('action') || null;
    const ip = url.searchParams.get('ip') || null;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

    const repo = new SecurityLogRepository(env.DB);
    const result = await repo.getLogs({ startDate, endDate, action, ip, limit, offset });

    return Response.json({
        logs: result.logs,
        totalCount: result.totalCount,
        limit: result.limit,
        offset: result.offset,
    });
}

/**
 * GET /api/security/stats
 * Returns counts for LOGIN_SUCCESS, LOGIN_FAILED, HONEYPOT_TRIGGERED, BANNED, etc.
 */
export async function handleSecurityStats(request, env) {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        await requireAuth(request, env);
    } catch {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const db = env.DB;
    const days = Math.min(parseInt(new URL(request.url).searchParams.get('days') || '7', 10), 90);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19);

    const actions = ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'HONEYPOT_TRIGGERED', 'BANNED', 'RATE_LIMITED', 'BLOCKED_BANNED_IP'];
    const counts = {};

    for (const action of actions) {
        const r = await db.prepare(
            `SELECT COUNT(*) as n FROM security_logs WHERE action = ? AND created_at >= ?`
        ).bind(action, since).first();
        counts[action] = r?.n ?? 0;
    }

    const bannedRepo = new BannedIpRepository(db);
    const bannedList = await bannedRepo.list({ limit: 1000, activeOnly: true });
    const bannedCount = bannedList.length;

    return Response.json({
        counts,
        bannedCount,
        since,
        days,
    });
}

/**
 * GET /api/security/banned
 * Returns list of banned IPs (auth required)
 */
export async function handleSecurityBanned(request, env) {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        await requireAuth(request, env);
    } catch {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));
    const activeOnly = url.searchParams.get('activeOnly') !== 'false';

    const repo = new BannedIpRepository(env.DB);
    const list = await repo.list({ limit, offset, activeOnly });

    return Response.json({ list });
}

/**
 * GET /api/logs/app — Bankacılık seviye uygulama logları (auth required)
 * Query: startDate, endDate, action, jobId, limit, offset
 */
export async function handleAppLogs(request, env) {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        await requireAuth(request, env);
    } catch {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const url = new URL(request.url);
    const startDate = url.searchParams.get('startDate') || new Date().toISOString().slice(0, 10);
    const endDate = url.searchParams.get('endDate') || startDate;
    const action = url.searchParams.get('action') || null;
    const jobId = url.searchParams.get('jobId') ? parseInt(url.searchParams.get('jobId'), 10) : null;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 500);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return new Response(JSON.stringify({ error: 'Hatali tarih formati (YYYY-MM-DD)' }), { status: 400 });
    }

    const repo = new AppLogRepository(env.DB);
    const result = await repo.getLogs({ startDate, endDate, action, jobId, limit, offset });

    return Response.json({
        logs: result.logs,
        totalCount: result.totalCount,
        limit: result.limit,
        offset: result.offset,
    });
}
