/**
 * Upload Token Repository
 * D1-based upload token storage (replaces VIDEO_UPLOAD_TOKENS KV)
 */

export class UploadTokenRepository {
    constructor(db) {
        this.db = db;
    }

    async save(token, jobId, payload, expiresInSeconds = 900) {
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString().slice(0, 19);
        const payloadJson = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);

        await this.db.prepare(
            `INSERT INTO upload_tokens (token, job_id, payload_json, expires_at, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
        ).bind(token, jobId, payloadJson, expiresAt).run();
    }

    async get(token) {
        const row = await this.db.prepare(
            `SELECT job_id, payload_json, expires_at FROM upload_tokens
             WHERE token = ? AND expires_at > datetime('now')`
        ).bind(token).first();

        if (!row) return null;

        let payload = {};
        try {
            payload = JSON.parse(row.payload_json || '{}');
        } catch (_) {}

        return {
            jobId: row.job_id,
            payload,
            expiresAt: row.expires_at,
        };
    }

    async delete(token) {
        await this.db.prepare('DELETE FROM upload_tokens WHERE token = ?').bind(token).run();
    }

    async deleteExpired() {
        const r = await this.db.prepare(
            "DELETE FROM upload_tokens WHERE expires_at <= datetime('now')"
        ).run();
        return r.meta?.changes ?? 0;
    }
}
