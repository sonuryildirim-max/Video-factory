/**
 * Processing / agent operations — BK Video Factory
 * Presigned URLs for agent, urlImportDone, cancel, retry, reprocess, unstick
 */

import { AwsClient } from 'aws4fetch';
import { VIDEO_CONSTANTS } from '../config/config.js';
import { JOB_STATUS, PROCESSING_STATUSES } from '../config/BK_CONSTANTS.js';
import { ValidationError, NotFoundError, AuthError, ConflictError, BK_ERROR_CODES } from '../utils/errors.js';
import { validateR2Key } from '../utils/videoValidation.js';
import { logger } from '../utils/logger.js';

const RAW_BUCKET = 'R2_RAW_UPLOADS_BUCKET';

export class ProcessingService {
    constructor(env, jobRepo) {
        this.env = env;
        this.jobRepo = jobRepo;
    }

    async getRawPresignedDownloadUrl(r2RawKey, expiresInSeconds = 3600) {
        if (!r2RawKey || r2RawKey === 'url-import-pending') return null;
        validateR2Key(r2RawKey, ['raw-uploads/']);
        const accountId = this.env.R2_ACCOUNT_ID;
        const accessKeyId = this.env.R2_ACCESS_KEY_ID;
        const secretKey = this.env.R2_SECRET_ACCESS_KEY;
        const bucketName = this.env.R2_RAW_BUCKET_NAME || 'bk-video-raw';
        if (!accountId || !accessKeyId || !secretKey) return null;
        try {
            const client = new AwsClient({ accessKeyId, secretAccessKey: secretKey, region: 'auto', service: 's3' });
            const url = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${r2RawKey}?X-Amz-Expires=${expiresInSeconds}`;
            const signed = await client.sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } });
            return signed.url;
        } catch (e) {
            logger.error('R2 presigned GET failed', { message: e?.message || String(e) });
            return null;
        }
    }

    async getPresignedUploadForAgent(jobId, workerId, bucket, key, contentType = 'video/mp4') {
        const job = await this.jobRepo.getById(jobId);
        if (!job) throw new NotFoundError('Job', String(jobId));
        if (job.worker_id !== workerId) throw new ValidationError('Job not claimed by this worker');
        if (!PROCESSING_STATUSES.includes(job.status)) throw new ValidationError('Job must be in PROCESSING state');
        const allowedPrefixes = bucket === 'raw' ? ['raw-uploads/'] : ['videos/', 'thumbnails/'];
        validateR2Key(key, allowedPrefixes);
        const accountId = this.env.R2_ACCOUNT_ID;
        const accessKeyId = this.env.R2_ACCESS_KEY_ID;
        const secretKey = this.env.R2_SECRET_ACCESS_KEY;
        const bucketName = bucket === 'raw' ? (this.env.R2_RAW_BUCKET_NAME || 'bk-video-raw') : (this.env.R2_PUBLIC_BUCKET_NAME || 'bk-video-public');
        if (accountId && accessKeyId && secretKey) {
            try {
                const client = new AwsClient({ accessKeyId, secretAccessKey: secretKey, region: 'auto', service: 's3' });
                const expiresIn = 3600;
                const url = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${key}?X-Amz-Expires=${expiresIn}`;
                const signed = await client.sign(new Request(url, { method: 'PUT' }), { aws: { signQuery: true } });
                return { upload_url: signed.url, expires_in: expiresIn };
            } catch (e) {
                logger.error('R2 presigned upload failed', { message: e?.message || String(e) });
            }
        }
        const err = new ValidationError('R2 presigned upload URL could not be generated. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
        err.errorCode = BK_ERROR_CODES.R2_BUCKET_NOT_FOUND;
        throw err;
    }

    async urlImportDone(jobId, workerId, r2RawKey, fileSizeInput) {
        validateR2Key(r2RawKey, ['raw-uploads/']);
        const updated = await this.jobRepo.updateJobRawKeyAfterUrlImport(jobId, workerId, r2RawKey, fileSizeInput);
        await this.jobRepo.updateFTSIndex(jobId);
        return updated;
    }

    async cancelJobIfOrphan(jobId, userId) {
        const job = await this.jobRepo.getById(jobId);
        if (!job || job.status !== JOB_STATUS.PENDING) return false;
        if (userId && job.uploaded_by !== userId) return false;
        const result = await this.jobRepo.cancelOrphanJob(jobId);
        return !!result;
    }

    async deleteRawObjectIfExists(r2RawKey) {
        if (!r2RawKey || r2RawKey === 'url-import-pending') return;
        try {
            const bucket = this.env[RAW_BUCKET];
            if (bucket) await bucket.delete(r2RawKey);
            logger.info('R2 raw object deleted', { r2RawKey });
        } catch (e) {
            logger.warn('R2 raw delete failed', { r2RawKey, message: e?.message });
        }
    }

    async retryJob(id, userId, env, isRoot = false) {
        const jobId = parseInt(id, 10);
        if (isNaN(jobId)) throw new ValidationError(`Invalid video id: ${id}`);
        const job = await this.jobRepo.getById(jobId);
        if (!job) throw new NotFoundError('Video', id);
        if (!isRoot && job.uploaded_by !== userId) throw new AuthError('Bu videoya yetkiniz yok', 403);
        if (job.status !== JOB_STATUS.FAILED) {
            const err = new ConflictError('Only failed jobs can be retried.');
            err.errorCode = BK_ERROR_CODES.JOB_NOT_RETRYABLE;
            throw err;
        }
        if ((job.retry_count || 0) >= VIDEO_CONSTANTS.JOB_MAX_RETRIES) {
            const err = new ConflictError(`Maximum retry attempts (${VIDEO_CONSTANTS.JOB_MAX_RETRIES}) exceeded.`);
            err.errorCode = BK_ERROR_CODES.JOB_NOT_RETRYABLE;
            throw err;
        }
        await this.env.DB.prepare(`
            UPDATE conversion_jobs SET status = ?, worker_id = NULL, error_message = NULL,
                started_at = NULL, completed_at = NULL, retry_count = retry_count + 1 WHERE id = ?
        `).bind(JOB_STATUS.PENDING, jobId).run();
        logger.info('Job re-queued', { jobId, userId, attempt: (job.retry_count || 0) + 1, maxRetries: VIDEO_CONSTANTS.JOB_MAX_RETRIES });
        return await this.jobRepo.getById(jobId);
    }

    async reprocessJobs(jobIds, userId, isRoot = false) {
        const ids = jobIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n) && n > 0);
        if (ids.length === 0) return { reprocessed: 0, job_ids: [] };
        const placeholders = ids.map(() => '?').join(',');
        const rows = (await this.env.DB.prepare(`
            SELECT id, status, uploaded_by, retry_count FROM conversion_jobs
            WHERE id IN (${placeholders}) AND deleted_at IS NULL
        `).bind(...ids).all()).results || [];
        const allowedStatuses = [JOB_STATUS.PENDING, JOB_STATUS.FAILED, ...PROCESSING_STATUSES];
        const toReprocess = rows.filter(j => {
            if (!allowedStatuses.includes(j.status)) return false;
            if (!isRoot && j.uploaded_by !== userId) return false;
            if (j.status === JOB_STATUS.FAILED && (j.retry_count || 0) >= VIDEO_CONSTANTS.JOB_MAX_RETRIES) return false;
            return true;
        });
        if (toReprocess.length === 0) return { reprocessed: 0, job_ids: [] };
        const reprocessIds = toReprocess.map(j => j.id);
        const ph = reprocessIds.map(() => '?').join(',');
        await this.env.DB.prepare(`
            UPDATE conversion_jobs SET status = ?, worker_id = NULL, error_message = NULL,
                started_at = NULL, completed_at = NULL,
                retry_count = CASE WHEN status = ? THEN retry_count + 1 ELSE retry_count END
            WHERE id IN (${ph})
        `).bind(JOB_STATUS.PENDING, JOB_STATUS.FAILED, ...reprocessIds).run();
        logger.info('Bulk reprocess', { job_ids: reprocessIds, userId });
        return { reprocessed: reprocessIds.length, job_ids: reprocessIds };
    }

    async unstickOrphanedJobs(minutes = 30) {
        const rows = await this.env.DB.prepare(`
            SELECT id FROM conversion_jobs
            WHERE status IN (${PROCESSING_STATUSES.map(s => `'${s}'`).join(',')})
              AND started_at < datetime('now', '-' || ? || ' minutes')
        `).bind(minutes).all();
        const toUnstick = rows?.results ?? [];
        const jobIds = toUnstick.map(r => r.id);
        if (jobIds.length === 0) return { unstuck_count: 0, job_ids: [] };
        const placeholders = jobIds.map(() => '?').join(',');
        await this.env.DB.prepare(`
            UPDATE conversion_jobs SET status = ?, worker_id = NULL, started_at = NULL,
                error_message = 'Reset for retry (orphaned)' WHERE id IN (${placeholders})
        `).bind(JOB_STATUS.PENDING, ...jobIds).run();
        logger.info('Unstuck jobs', { count: jobIds.length, minutes, job_ids: jobIds });
        return { unstuck_count: jobIds.length, job_ids: jobIds };
    }
}
