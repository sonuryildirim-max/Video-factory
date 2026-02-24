/**
 * User Repository — D1-based user CRUD for RBAC
 */

import { hashPassword } from '../utils/password.js';
import { ValidationError } from '../utils/errors.js';

export class UserRepository {
    constructor(db) {
        this.db = db;
    }

    async findByToken(apiToken) {
        if (!apiToken || typeof apiToken !== 'string') return null;
        return await this.db.prepare(
            'SELECT id, username, role, api_token, is_active FROM users WHERE api_token = ? AND is_active = 1'
        ).bind(apiToken.trim()).first();
    }

    async findByUsername(username) {
        if (!username) return null;
        return await this.db.prepare(
            'SELECT id, username, password_hash, role, api_token, is_active, created_at FROM users WHERE username = ? AND is_active = 1'
        ).bind(String(username).trim()).first();
    }

    async getById(id) {
        try {
            const r = await this.db.prepare(
                'SELECT id, username, role, api_token, is_active, created_at, last_login FROM users WHERE id = ?'
            ).bind(parseInt(id, 10)).first();
            return r || null;
        } catch (e) {
            const r = await this.db.prepare(
                'SELECT id, username, role, api_token, is_active, created_at FROM users WHERE id = ?'
            ).bind(parseInt(id, 10)).first();
            return r ? { ...r, last_login: null, last_activity: null } : null;
        }
    }

    async count() {
        const r = await this.db.prepare('SELECT COUNT(*) as total FROM users').first();
        return r ? (parseInt(r.total, 10) || 0) : 0;
    }

    async list() {
        try {
            const rows = await this.db.prepare(
                'SELECT id, username, role, is_active, created_at, last_login FROM users ORDER BY role ASC, created_at DESC'
            ).all();
            return rows?.results || [];
        } catch (e) {
            const rows = await this.db.prepare(
                'SELECT id, username, role, is_active, created_at FROM users ORDER BY role ASC, created_at DESC'
            ).all();
            return (rows?.results || []).map(u => ({ ...u, last_login: null, last_activity: null }));
        }
    }

    async updateLastLogin(userId) {
        const id = parseInt(userId, 10);
        if (isNaN(id)) return;
        await this.db.prepare('UPDATE users SET last_login = ? WHERE id = ?')
            .bind(new Date().toISOString(), id).run();
    }

    async updateLastActivity(userId) {
        if (!this.db || !userId) return;
        const id = parseInt(userId, 10);
        if (isNaN(id)) return;
        const now = new Date().toISOString();
        await this.db.prepare('UPDATE users SET last_activity = ? WHERE id = ?')
            .bind(now, id).run();
    }

    async create({ username, password, role = 'admin' }) {
        const u = String(username || '').trim();
        if (!u || u.length < 2) throw new ValidationError('username required, min 2 chars');
        const validRoles = ['root', 'admin'];
        if (!validRoles.includes(role)) throw new ValidationError('role must be root or admin');
        const existing = await this.db.prepare('SELECT id FROM users WHERE username = ?').bind(u).first();
        if (existing) throw new ValidationError('username already exists');
        const passwordHash = await hashPassword(password || '');
        if (!passwordHash) throw new ValidationError('password required');
        const apiToken = crypto.randomUUID();
        await this.db.prepare(
            'INSERT INTO users (username, password_hash, role, api_token, is_active) VALUES (?, ?, ?, ?, 1)'
        ).bind(u, passwordHash, role, apiToken).run();
        const row = await this.db.prepare('SELECT id, username, role, api_token, is_active, created_at FROM users WHERE username = ?').bind(u).first();
        return row;
    }

    async updatePassword(id, newPassword) {
        const idNum = parseInt(id, 10);
        if (isNaN(idNum)) return null;
        const hash = await hashPassword(newPassword || '');
        if (!hash) throw new ValidationError('password required');
        await this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, idNum).run();
        return this.getById(idNum);
    }

    async setActive(id, isActive) {
        const idNum = parseInt(id, 10);
        if (isNaN(idNum)) return null;
        const val = isActive ? 1 : 0;
        await this.db.prepare('UPDATE users SET is_active = ? WHERE id = ?').bind(val, idNum).run();
        return this.getById(idNum);
    }

    async delete(id) {
        const idNum = parseInt(id, 10);
        if (isNaN(idNum)) return false;
        const r = await this.db.prepare('DELETE FROM users WHERE id = ?').bind(idNum).run();
        return (r.meta?.changes || 0) > 0;
    }
}
