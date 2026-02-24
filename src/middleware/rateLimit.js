/**
 * Rate Limiting Middleware
 * D1-based (replaces KV)
 * DB unavailable or error → deny (return false), no bypass.
 */

import { CONFIG } from '../config/config.js';
import { D1RateLimitRepository } from '../repositories/D1RateLimitRepository.js';
import { BannedIpRepository } from '../repositories/BannedIpRepository.js';

/**
 * Check rate limit. When DB unavailable or D1 throws, returns false (deny).
 */
export async function checkRateLimit(env, key, maxRequests, windowSeconds) {
    if (!env.DB) return false;
    try {
        const repo = new D1RateLimitRepository(env.DB);
        return await repo.checkRateLimit(key, maxRequests, windowSeconds);
    } catch (e) {
        return false;
    }
}

/**
 * Check if IP is banned
 */
export async function isIpBanned(env, ip) {
    if (!env.DB) return false;
    try {
        const repo = new BannedIpRepository(env.DB);
        return await repo.isBanned(ip);
    } catch {
        return false;
    }
}

/**
 * Increment failed attempts (returns { banned, attempts })
 * When banned, caller must call BannedIpRepository.ban()
 */
export async function incrementFailedAttempts(env, ip) {
    if (!env.DB) return { banned: false, attempts: 1 };
    try {
        const repo = new D1RateLimitRepository(env.DB);
        return await repo.incrementFailedAttempts(
            ip,
            CONFIG.RATE_LIMITS.MAX_FAILED_ATTEMPTS,
            CONFIG.RATE_LIMITS.BAN_DURATION_SECONDS
        );
    } catch {
        return { banned: false, attempts: 1 };
    }
}

/**
 * Reset failed attempts
 */
export async function resetFailedAttempts(env, ip) {
    if (!env.DB) return;
    try {
        const repo = new D1RateLimitRepository(env.DB);
        await repo.resetFailedAttempts(ip);
    } catch {
        /* no-op */
    }
}
