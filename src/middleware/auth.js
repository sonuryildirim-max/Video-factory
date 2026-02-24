/**
 * Authentication Middleware
 * Cookie (bk_session) first, then Bearer token (D1 users.api_token). No Basic auth.
 */

import { AuthService } from '../services/AuthService.js';
import { AuthError } from '../utils/errors.js';

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
 * Require root privileges
 */
export async function requireRoot(request, env) {
    const authResult = await requireAuth(request, env);

    if (!authResult.isRoot) {
        throw new AuthError('Bu islem icin root yetkisi gerekli', 403);
    }

    return authResult;
}
