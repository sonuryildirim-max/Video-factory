/**
 * Log Service
 * Handles audit logging
 */

import { sanitizeForLog } from '../utils/security.js';
import { parseUserAgent } from '../utils/userAgent.js';
import { logger } from '../utils/logger.js';

export class LogService {
    constructor(d1Repo) {
        this.d1Repo = d1Repo;
    }

    /**
     * Write audit log
     */
    async writeAuditLog(action, details, request) {
        const ip = details.ip || request.headers.get('CF-Connecting-IP') || 'unknown';
        const ua = details.userAgent || request.headers.get('User-Agent') || 'unknown';
        const country = request.cf ? request.cf.country : 'XX';
        const city = request.cf ? request.cf.city : 'Unknown';
        const timestamp = new Date().toISOString();

        // Sanitize details for XSS protection
        const sanitizedDetails = {};
        for (const key in details) {
            if (details.hasOwnProperty(key)) {
                sanitizedDetails[key] = sanitizeForLog(details[key]);
            }
        }

        try {
            await this.d1Repo.writeLog({
                action,
                details: sanitizedDetails,
                ip,
                ua,
                country,
                city,
                timestamp
            });
        } catch (e) {
            logger.error('Log write error', { error: e?.message ?? String(e) });
            // Don't throw - logging failures shouldn't break the app
        }
    }

    /**
     * Get logs with filters
     */
    async getLogs(filters) {
        return await this.d1Repo.getLogs(filters);
    }

    /**
     * Cleanup old logs
     */
    async cleanupLogs(days) {
        await this.d1Repo.cleanupLogs(days);
    }

    /**
     * Write a structured log entry for a conversion job.
     * Used by JobService to trace job lifecycle events.
     *
     * @param {string} jobId
     * @param {'INFO'|'WARN'|'ERROR'} level
     * @param {string} message
     * @param {string} [stage]  - e.g. 'UPLOAD', 'QUEUE', 'ENCODE', 'COMPLETE'
     * @param {Object} [meta]   - arbitrary structured metadata
     */
    async createJobLog(jobId, level, message, stage = '', meta = {}) {
        const entry = {
            action: 'JOB_LOG',
            details: sanitizeForLog({
                job_id: jobId,
                level,
                message,
                stage,
                ...meta,
            }),
            ip: 'system',
            ua: 'JobService',
            country: 'XX',
            city: 'Internal',
            timestamp: new Date().toISOString(),
        };

        try {
            await this.d1Repo.writeLog(entry);
        } catch (e) {
            logger.error('LogService.createJobLog failed', { jobId, stage, error: e?.message ?? String(e) });
        }
    }

    /**
     * Retrieve log entries for a specific job.
     *
     * @param {string} jobId
     * @param {{ limit?: number, offset?: number }} [options]
     * @returns {Promise<Array>}
     */
    async getJobLogs(jobId, { limit = 50, offset = 0 } = {}) {
        return this.d1Repo.getLogs({
            action: 'JOB_LOG',
            search: jobId,
            limit,
            offset,
        });
    }
}
