/**
 * Banned IP Repository
 * D1-based IP ban management (replaces KV ban:ip)
 */

export class BannedIpRepository {
    constructor(db) {
        this.db = db;
    }

    async isBanned(ip) {
        const row = await this.db.prepare(
            `SELECT 1 FROM banned_ips
             WHERE ip = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`
        ).bind(ip).first();
        return !!row;
    }

    async ban(ip, reason, banDurationSeconds = null) {
        const now = new Date().toISOString().slice(0, 19);
        const expiresAt = banDurationSeconds
            ? new Date(Date.now() + banDurationSeconds * 1000).toISOString().slice(0, 19)
            : null;

        await this.db.prepare(
            `INSERT OR REPLACE INTO banned_ips (ip, reason, banned_at, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?)`
        ).bind(ip, reason, now, expiresAt, now).run();
    }

    async unban(ip) {
        await this.db.prepare('DELETE FROM banned_ips WHERE ip = ?').bind(ip).run();
    }

    async list({ limit = 100, offset = 0, activeOnly = true } = {}) {
        let where = '';
        if (activeOnly) {
            where = " WHERE expires_at IS NULL OR expires_at > datetime('now')";
        }
        const rows = await this.db.prepare(
            `SELECT ip, reason, banned_at, expires_at, created_at
             FROM banned_ips${where}
             ORDER BY banned_at DESC
             LIMIT ? OFFSET ?`
        ).bind(limit, offset).all();

        return (rows.results || []).map(r => ({
            ip: r.ip,
            reason: r.reason,
            bannedAt: r.banned_at,
            expiresAt: r.expires_at,
            isPermanent: !r.expires_at,
        }));
    }

    async deleteExpired() {
        const r = await this.db.prepare(
            "DELETE FROM banned_ips WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')"
        ).run();
        return r.meta?.changes ?? 0;
    }
}
