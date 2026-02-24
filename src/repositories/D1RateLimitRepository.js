/**
 * D1 Rate Limit Repository
 * Replaces KV for rate limiting, failed attempts, and ban state
 */

export class D1RateLimitRepository {
    constructor(db) {
        this.db = db;
    }

    async checkRateLimit(key, maxRequests, windowSeconds) {
        const fullKey = `rate:${key}`;
        const now = new Date();
        const windowStart = now.toISOString().slice(0, 19);
        const expiresAt = new Date(now.getTime() + windowSeconds * 1000).toISOString().slice(0, 19);

        const row = await this.db.prepare(
            'SELECT count, window_start FROM rate_limit_counters WHERE key = ?'
        ).bind(fullKey).first();

        if (!row) {
            await this.db.prepare(
                'INSERT INTO rate_limit_counters (key, count, window_start, expires_at) VALUES (?, 1, ?, ?)'
            ).bind(fullKey, windowStart, expiresAt).run();
            return true;
        }

        const windowStartMs = new Date(row.window_start).getTime();
        const windowEndMs = windowStartMs + windowSeconds * 1000;

        if (Date.now() >= windowEndMs) {
            await this.db.prepare(
                'UPDATE rate_limit_counters SET count = 1, window_start = ?, expires_at = ? WHERE key = ?'
            ).bind(windowStart, expiresAt, fullKey).run();
            return true;
        }

        if (row.count >= maxRequests) return false;

        await this.db.prepare(
            'UPDATE rate_limit_counters SET count = count + 1, expires_at = ? WHERE key = ?'
        ).bind(expiresAt, fullKey).run();
        return true;
    }

    async incrementFailedAttempts(ip, maxAttempts, banDurationSeconds) {
        const failKey = `fail:${ip}`;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 600 * 1000).toISOString().slice(0, 19);

        const row = await this.db.prepare(
            'SELECT count FROM rate_limit_counters WHERE key = ?'
        ).bind(failKey).first();

        let count = row ? (row.count || 0) + 1 : 1;

        if (count >= maxAttempts) {
            await this.db.prepare('DELETE FROM rate_limit_counters WHERE key = ?').bind(failKey).run();
            return { banned: true, attempts: count };
        }

        await this.db.prepare(
            'INSERT OR REPLACE INTO rate_limit_counters (key, count, window_start, expires_at) VALUES (?, ?, datetime("now"), ?)'
        ).bind(failKey, count, expiresAt).run();
        return { banned: false, attempts: count };
    }

    async resetFailedAttempts(ip) {
        const failKey = `fail:${ip}`;
        await this.db.prepare('DELETE FROM rate_limit_counters WHERE key = ?').bind(failKey).run();
    }

    async deleteExpired() {
        const r = await this.db.prepare(
            "DELETE FROM rate_limit_counters WHERE expires_at <= datetime('now')"
        ).run();
        return r.meta?.changes ?? 0;
    }
}
