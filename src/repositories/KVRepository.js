/**
 * KV Store Repository
 * Handles all KV Store operations
 */

import { CONFIG } from '../config/config.js';

export class KVRepository {
    constructor(kvStore) {
        this.kv = kvStore;
    }

    /**
     * Get link by slug
     */
    async getLink(slug) {
        const data = await this.kv.get(slug, { type: 'json' });
        return data;
    }

    /**
     * Save link
     */
    async saveLink(slug, linkData) {
        await this.kv.put(slug, JSON.stringify(linkData));
    }

    /**
     * Delete link
     */
    async deleteLink(slug) {
        await this.kv.delete(slug);
    }

    /**
     * Get cached slug for URL hash
     */
    async getCachedSlug(urlHash) {
        return await this.kv.get(`cache:${urlHash}`);
    }

    /**
     * Cache slug for URL hash
     */
    async cacheSlug(urlHash, slug, ttl = 86400) {
        await this.kv.put(`cache:${urlHash}`, slug, { expirationTtl: ttl });
    }

    /**
     * Delete cached slug
     */
    async deleteCachedSlug(urlHash) {
        await this.kv.delete(`cache:${urlHash}`);
    }

    /**
     * Get links index
     */
    async getIndex() {
        const index = await this.kv.get(CONFIG.INDEX_KEY, { type: 'json' });
        return index || [];
    }

    /**
     * Save links index
     */
    async saveIndex(index) {
        await this.kv.put(CONFIG.INDEX_KEY, JSON.stringify(index));
    }

    /**
     * Acquire lock for atomic operations
     */
    async acquireLock() {
        const limit = 10;
        for (let i = 0; i < limit; i++) {
            const locked = await this.kv.get(CONFIG.LOCK_KEY);
            if (!locked) {
                await this.kv.put(CONFIG.LOCK_KEY, "1", { expirationTtl: 60 });
                return true;
            }
            await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
        }
        return false;
    }

    /**
     * Release lock
     */
    async releaseLock() {
        await this.kv.delete(CONFIG.LOCK_KEY);
    }

    /**
     * Add slug to index atomically
     */
    async addToIndex(slug) {
        if (!await this.acquireLock()) {
            throw new Error("Index busy, please try again.");
        }
        try {
            const index = await this.getIndex();
            if (index.indexOf(slug) === -1) {
                index.unshift(slug);
                await this.saveIndex(index);
            }
        } finally {
            await this.releaseLock();
        }
    }

    /**
     * Check rate limit
     */
    async checkRateLimit(key, maxRequests, windowSeconds) {
        const countKey = `rate:${key}`;
        const current = await this.kv.get(countKey);
        const count = current ? parseInt(current) : 0;
        if (count >= maxRequests) return false;
        await this.kv.put(countKey, (count + 1).toString(), { expirationTtl: windowSeconds });
        return true;
    }

    /**
     * Check if IP is banned
     */
    async isIpBanned(ip) {
        const banKey = `ban:${ip}`;
        const banned = await this.kv.get(banKey);
        return banned !== null;
    }

    /**
     * Increment failed login attempts
     */
    async incrementFailedAttempts(ip, maxAttempts, banDuration) {
        const failKey = `fail:${ip}`;
        const current = await this.kv.get(failKey);
        let count = current ? parseInt(current) : 0;
        count++;
        
        if (count >= maxAttempts) {
            await this.kv.put(`ban:${ip}`, "1", { expirationTtl: banDuration });
            await this.kv.delete(failKey);
            return { banned: true, attempts: count };
        }
        
        await this.kv.put(failKey, count.toString(), { expirationTtl: 600 });
        return { banned: false, attempts: count };
    }

    /**
     * Reset failed attempts
     */
    async resetFailedAttempts(ip) {
        await this.kv.delete(`fail:${ip}`);
    }

    /**
     * Get OG tag cache
     */
    async getOgCache(slug) {
        return await this.kv.get(`og:${slug}`, { type: 'json' });
    }

    /**
     * Cache OG tags
     */
    async cacheOgTags(slug, ogData, ttl = 86400) {
        await this.kv.put(`og:${slug}`, JSON.stringify(ogData), { expirationTtl: ttl });
    }
}
