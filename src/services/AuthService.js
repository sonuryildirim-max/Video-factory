/**
 * Authentication Service
 * Zero-trust: Bearer token (D1 users.api_token) and Session Cookie only.
 * Basic Auth is not supported and is disabled for security (no verifyBasicAuth fallback).
 */

import { UserRepository } from '../repositories/UserRepository.js';

export class AuthService {
    constructor(env) {
        this.env = env;
        this.db = env.DB;
        this.userRepo = this.db ? new UserRepository(this.db) : null;
    }

    /**
     * Parse Cookie header and return value for name
     */
    _getCookie(request, name) {
        const raw = request.headers.get('Cookie');
        if (!raw) return null;
        const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(raw);
        return match ? decodeURIComponent(match[1].trim()) : null;
    }

    /**
     * Verify session token from HttpOnly cookie (bk_session)
     */
    async verifySessionCookie(request) {
        const token = this._getCookie(request, 'bk_session');
        if (!token) return null;

        if (!this.userRepo) return null;
        const user = await this.userRepo.findByToken(token);
        if (!user) return null;

        return {
            valid: true,
            user: user.username,
            role: user.role,
            isRoot: user.role === 'root',
            userId: user.id,
            requiresOtp: false,
        };
    }

    /**
     * Verify Bearer token from D1 users table (for agent / API clients)
     */
    async verifyBearerToken(request) {
        const header = request.headers.get('Authorization');
        if (!header || !header.startsWith('Bearer ')) return null;

        const token = header.slice(7).trim();
        if (!token) return null;

        if (!this.userRepo) return null;
        const user = await this.userRepo.findByToken(token);
        if (!user) return null;

        return {
            valid: true,
            user: user.username,
            role: user.role,
            isRoot: user.role === 'root',
            userId: user.id,
            requiresOtp: false,
        };
    }

    /**
     * Unified auth: Cookie first, then Bearer token. Basic Auth is not supported (security).
     */
    async verifyAuth(request) {
        const cookieResult = await this.verifySessionCookie(request);
        if (cookieResult) return cookieResult;
        return this.verifyBearerToken(request);
    }
}
