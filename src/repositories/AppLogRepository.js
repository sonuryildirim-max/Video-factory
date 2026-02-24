/**
 * App Log Repository — Bankacılık / Askeri Seviye Audit Log
 * Append-only, hash chain ile tahrifat tespiti
 */

async function sha256Hex(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class AppLogRepository {
    constructor(db) {
        this.db = db;
    }

    /**
     * Insert audit log with hash chain.
     * @param {Object} opts - { level, action, details, jobId?, ip?, userId?, requestId? }
     */
    async insert(opts) {
        const { level, action, details = {}, jobId, ip, userId, requestId } = opts;
        const detailsJson = typeof details === 'object' ? JSON.stringify(details) : String(details);
        const createdAt = new Date().toISOString();

        const lastRow = await this.db.prepare(
            'SELECT entry_hash FROM app_logs ORDER BY id DESC LIMIT 1'
        ).first();
        const prevHash = lastRow?.entry_hash || 'genesis';

        const payloadStr = `${createdAt}|${level}|${action}|${jobId ?? ''}|${detailsJson}|${prevHash}`;
        const entryHash = await sha256Hex(payloadStr);

        await this.db.prepare(
            `INSERT INTO app_logs (created_at, level, action, job_id, details_json, ip, user_id, request_id, prev_hash, entry_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(createdAt, level, action, jobId ?? null, detailsJson, ip ?? null, userId ?? null, requestId ?? null, prevHash, entryHash).run();
    }

    /**
     * Get app logs with filters.
     */
    async getLogs({ startDate, endDate, action, jobId, limit = 200, offset = 0 } = {}) {
        const where = [];
        const params = [];

        if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
            where.push("created_at >= ?");
            params.push(startDate + 'T00:00:00');
        }
        if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
            where.push("created_at <= ?");
            params.push(endDate + 'T23:59:59.999');
        }
        if (action) {
            where.push('action = ?');
            params.push(action);
        }
        if (jobId != null) {
            where.push('job_id = ?');
            params.push(jobId);
        }

        const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
        const countRes = await this.db.prepare(
            `SELECT COUNT(*) as total FROM app_logs${whereSql}`
        ).bind(...params).first();

        const rows = await this.db.prepare(
            `SELECT id, created_at, level, action, job_id, details_json, ip, user_id, request_id, prev_hash, entry_hash
             FROM app_logs${whereSql}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`
        ).bind(...params, limit, offset).all();

        const results = (rows.results || []).map(r => {
            let details = {};
            try {
                details = r.details_json ? JSON.parse(r.details_json) : {};
            } catch (_) {}
            return {
                id: r.id,
                createdAt: r.created_at,
                level: r.level,
                action: r.action,
                jobId: r.job_id,
                details,
                ip: r.ip,
                userId: r.user_id,
                requestId: r.request_id,
                prevHash: r.prev_hash,
                entryHash: r.entry_hash,
            };
        });

        return {
            logs: results,
            totalCount: countRes?.total ?? 0,
            limit,
            offset,
        };
    }
}
