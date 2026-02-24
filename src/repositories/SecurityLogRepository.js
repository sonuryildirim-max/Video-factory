/**
 * Security Log Repository
 * D1-based security event logging (replaces KV)
 */

export class SecurityLogRepository {
    constructor(db) {
        this.db = db;
    }

    async insert({ ip, action, status, userAgent, country, city, details, createdBy }) {
        const detailsJson = typeof details === 'object' ? JSON.stringify(details) : (details || '{}');
        // Europe/Istanbul saat dilimi (UTC kullanılmıyor)
        const created_at = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Istanbul' }).replace(' ', 'T');
        await this.db.prepare(
            `INSERT INTO security_logs (ip, action, status, user_agent, country, city, details_json, created_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(ip, action, status, userAgent || null, country || 'XX', city || 'Unknown', detailsJson, created_at, createdBy || null).run();
    }

    async getLogs({ startDate, endDate, action, ip, limit = 500, offset = 0 } = {}) {
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
        if (ip) {
            where.push('ip = ?');
            params.push(ip);
        }

        const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
        const countRes = await this.db.prepare(
            `SELECT COUNT(*) as total FROM security_logs${whereSql}`
        ).bind(...params).first();

        const rows = await this.db.prepare(
            `SELECT id, ip, action, status, user_agent, country, city, details_json, created_at
             FROM security_logs${whereSql}
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
                ip: r.ip,
                action: r.action,
                status: r.status,
                userAgent: r.user_agent,
                country: r.country,
                city: r.city,
                details,
                createdAt: r.created_at,
            };
        });

        return {
            logs: results,
            totalCount: countRes?.total ?? 0,
            limit,
            offset,
        };
    }

    async deleteOlderThan(days) {
        const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19);
        const r = await this.db.prepare(
            "DELETE FROM security_logs WHERE created_at < ?"
        ).bind(cutoff).run();
        return r.meta?.changes ?? 0;
    }
}
