/**
 * Authentication Middleware
 * Cookie (bk_session) first, then Bearer token (D1 users.api_token). No Basic auth.
 */

import { AuthService } from '../services/AuthService.js';
import { AuthError } from '../utils/errors.js';
import { SecurityLogRepository } from '../repositories/SecurityLogRepository.js';
import { logger } from '../utils/logger.js';

/**
 * Require authentication (Cookie or Bearer)
 */
export async function requireAuth(request, env) {
    const authService = new AuthService(env);
    const authResult = await authService.verifyAuth(request);

    if (!authResult || !authResult.valid) {
        throw new AuthError('Yetkisiz erisim');
    }

    return authResult;
}

/**
 * Require authentication and log UNAUTHORIZED_ACCESS to security_logs on 401.
 */
export async function requireAuthWithAudit(request, env) {
    try {
        return await requireAuth(request, env);
    } catch (e) {
        if (e instanceof AuthError && e.statusCode === 401 && env?.DB) {
            try {
                const repo = new SecurityLogRepository(env.DB);
                const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
                await repo.insert({
                    ip,
                    action: 'UNAUTHORIZED_ACCESS',
                    status: 'failed',
                    userAgent: request.headers.get('User-Agent') || null,
                    country: request.cf?.country || 'XX',
                    city: request.cf?.city || 'Unknown',
                    details: { path: new URL(request.url).pathname, reason: e.message?.includes('token') ? 'invalid_token' : 'missing_token' },
                    createdBy: null,
                });
            } catch (logErr) {
                logger.warn('UNAUTHORIZED_ACCESS log failed', { message: logErr?.message });
            }
        }
        throw e;
    }
}

/**
 * Require root privileges (uses requireAuthWithAudit so 401 is audited)
 */
export async function requireRoot(request, env) {
    const authResult = await requireAuthWithAudit(request, env);

    if (!authResult.isRoot) {
        throw new AuthError('Bu islem icin root yetkisi gerekli', 403);
    }

    return authResult;
}
