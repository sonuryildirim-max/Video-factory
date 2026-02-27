/**
 * Deletion, restore, purge — BK Video Factory
 * Soft/hard delete, restore, purge (single + bulk); R2 move/copy/delete helpers
 */

import { ValidationError, NotFoundError, AuthError, ConflictError, BK_ERROR_CODES } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { SecurityLogRepository } from '../repositories/SecurityLogRepository.js';
import { StorageLifecycleLogRepository } from '../repositories/StorageLifecycleLogRepository.js';
import { JOB_STATUS, PROCESSING_STATUSES } from '../config/BK_CONSTANTS.js';

export class DeletionService {
    constructor(env, jobRepo, bucketNames) {
        this.env = env;
        this.jobRepo = jobRepo;
        this.rawBucket = bucketNames?.rawBucket ?? 'R2_RAW_UPLOADS_BUCKET';
        this.pubBucket = bucketNames?.pubBucket ?? 'R2_PUBLIC_BUCKET';
        this.delBucket = bucketNames?.delBucket ?? 'R2_DELETED_BUCKET';
        this.cdnBase = bucketNames?.cdnBase ?? '';
    }

    _publicKeyFromJob(job, kind = 'video') {
        if (kind === 'thumbnail') return (job.thumbnail_key && String(job.thumbnail_key).trim()) || '';
        if (!job.public_url) return '';
        let pubKey = job.public_url.startsWith(this.cdnBase) ? job.public_url.slice(this.cdnBase.length).replace(/^\//, '') : '';
        if (!pubKey && job.public_url) {
            try {
                pubKey = new URL(job.public_url).pathname.replace(/^\/public\/?/, '').replace(/^\//, '');
            } catch (e) {
                logger.warn('_publicKeyFromJob: invalid public_url', { jobId: job.id, public_url: job.public_url, message: e?.message });
            }
        }
        return pubKey || '';
    }

    /**
     * Atomic move: copy object to deleted bucket, then delete from source.
     * Source is only deleted after put to destination has completed successfully.
     * Throws on failure so Saga caller can rollback D1.
     */
    async _moveToDeletedBucket(sourceBucket, deletedBucket, sourceKey, deletedKey) {
        if (!sourceBucket || !deletedBucket || !sourceKey || !deletedKey) return;
        try {
            const obj = await sourceBucket.get(sourceKey);
            if (!obj) return;
            const metadata = {
                httpMetadata: obj.httpMetadata || {},
                customMetadata: { ...(obj.customMetadata || {}), originalKey: sourceKey },
            };
            await deletedBucket.put(deletedKey, obj.body, metadata);
            await sourceBucket.delete(sourceKey);
            logger.info('Moved to deleted', { sourceKey, deletedKey });
        } catch (e) {
            logger.warn('R2 move to deleted failed', { sourceKey, deletedKey, message: e?.message });
            throw e;
        }
    }

    async _copyFromDeletedToBucket(delBucket, targetBucket, delKey, targetKey) {
        if (!delBucket || !targetBucket || !delKey || !targetKey) return;
        try {
            const obj = await delBucket.get(delKey);
            if (obj) {
                await targetBucket.put(targetKey, obj.body, {
                    httpMetadata: obj.httpMetadata || {},
                    customMetadata: obj.customMetadata || {},
                });
                await delBucket.delete(delKey);
                logger.info('Restored', { delKey, targetKey });
            }
        } catch (e) {
            logger.warn('R2 restore failed', { delKey, message: e?.message });
        }
    }

    async _deleteR2Keys(bucket, keys, batchSize = 20) {
        if (!bucket || !keys?.length) return;
        const validKeys = keys.filter(Boolean);
        for (let i = 0; i < validKeys.length; i += batchSize) {
            const chunk = validKeys.slice(i, i + batchSize);
            const results = await Promise.allSettled(chunk.map(key => bucket.delete(key)));
            const failed = [];
            results.forEach((res, idx) => {
                if (res.status === 'fulfilled') {
                    logger.info('R2 deleted', { key: chunk[idx] });
                } else {
                    const msg = res.reason?.message || String(res.reason);
                    logger.error('R2 delete failed', { key: chunk[idx], reason: msg });
                    failed.push(chunk[idx]);
                }
            });
            if (failed.length > 0) {
                throw new Error(`R2 delete failed for keys: ${failed.join(', ')}`);
            }
        }
    }

    async deleteJob(id, userId, env, isRoot = false) {
        const jobId = parseInt(id, 10);
        if (isNaN(jobId)) throw new ValidationError(`Invalid video id: ${id}`);
        const job = await this.jobRepo.getById(jobId);
        if (!job) throw new NotFoundError('Video', id);
        if (!isRoot && job.uploaded_by !== userId) throw new AuthError('Bu videoya yetkiniz yok', 403);
        if (PROCESSING_STATUSES.includes(job.status)) {
            const err = new ConflictError('Cannot delete a video that is currently being processed.');
            err.errorCode = BK_ERROR_CODES.JOB_DELETE_DENIED;
            throw err;
        }
        const rawBucket = env?.[this.rawBucket] || this.env[this.rawBucket];
        const pubBucket = env?.[this.pubBucket] || this.env[this.pubBucket];
        const delBucket = env?.[this.delBucket] || this.env[this.delBucket];
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const prefix = `deleted/${yyyy}/${mm}/${jobId}_`;

        // Saga: 1) Mark D1 DELETING so we can rollback if R2 fails
        const jobBefore = await this.jobRepo.markJobDeleting(jobId);
        if (!jobBefore) throw new ConflictError('Video silinemedi');
        const originalStatus = jobBefore.status;

        const movePromises = [];
        const moveLabels = [];
        if (job.r2_raw_key && job.r2_raw_key !== 'url-import-pending' && rawBucket && delBucket) {
            const delKey = prefix + job.r2_raw_key.replace(/\//g, '-');
            movePromises.push(this._moveToDeletedBucket(rawBucket, delBucket, job.r2_raw_key, delKey));
            moveLabels.push(`raw:${job.r2_raw_key}`);
        }
        if (job.public_url && job.status === JOB_STATUS.COMPLETED && pubBucket && delBucket) {
            const pubKey = this._publicKeyFromJob(job, 'video');
            if (pubKey) {
                const delKey = prefix + pubKey.replace(/\//g, '-');
                movePromises.push(this._moveToDeletedBucket(pubBucket, delBucket, pubKey, delKey));
                moveLabels.push(`public:${pubKey}`);
            }
        }
        if (job.thumbnail_key && pubBucket && delBucket) {
            const delKey = prefix + 'thumb_' + job.thumbnail_key.replace(/\//g, '-');
            movePromises.push(this._moveToDeletedBucket(pubBucket, delBucket, job.thumbnail_key, delKey));
            moveLabels.push(`thumb:${job.thumbnail_key}`);
        }

        const results = await Promise.allSettled(movePromises);
        const failed = results.map((r, i) => (r.status === 'rejected' ? { label: moveLabels[i], reason: r.reason } : null)).filter(Boolean);
        if (failed.length > 0) {
            await this.jobRepo.rollbackJobDeleting(jobId, originalStatus);
            failed.forEach(({ label, reason }) => logger.error('R2 move failed (Saga rollback)', { jobId, key: label, reason: reason?.message || String(reason) }));
            throw new ConflictError('R2 taşıma başarısız; silme geri alındı.');
        }

        const softDeleted = await this.jobRepo.softDeleteJob(jobId);
        if (!softDeleted) {
            await this.jobRepo.rollbackJobDeleting(jobId, originalStatus);
            throw new ConflictError('Video silinemedi');
        }
        logger.info('Soft deleted job', { jobId, userId });

        if (env?.DB) {
            try {
                const secLog = new SecurityLogRepository(env.DB);
                await secLog.insert({
                    ip: 'system',
                    action: 'MOVED_TO_TRASH',
                    status: 'success',
                    userAgent: null,
                    country: 'XX',
                    city: 'Unknown',
                    details: { job_id: jobId, user_id: userId, is_root: isRoot },
                    createdBy: userId,
                });
            } catch (e) {
                logger.warn('MOVED_TO_TRASH log failed', { message: e?.message });
            }
            try {
                const storageLog = new StorageLifecycleLogRepository(env.DB);
                await storageLog.insert({
                    jobId,
                    eventType: 'moved_to_deleted',
                    bucket: 'deleted',
                    reason: 'Soft delete: moved to deleted bucket',
                    details: { keys: moveLabels },
                });
            } catch (e) { logger.warn('StorageLifecycleLog insert (deleteJob)', { message: e?.message }); }
        }
    }

    async permanentDeleteJob(id, userId, env, isRoot = false) {
        const jobId = parseInt(id, 10);
        if (isNaN(jobId)) throw new ValidationError(`Invalid video id: ${id}`);
        const job = await this.jobRepo.getById(jobId);
        if (!job) throw new NotFoundError('Video', id);
        if (!isRoot && job.uploaded_by !== userId) throw new AuthError('Bu videoya yetkiniz yok', 403);
        const rawBucket = env?.[this.rawBucket] || this.env[this.rawBucket];
        const pubBucket = env?.[this.pubBucket] || this.env[this.pubBucket];
        const delBucket = env?.[this.delBucket] || this.env[this.delBucket];
        const keysToDeleteRaw = [];
        const keysToDeletePublic = [];
        const keysToDeleteDeleted = [];
const isSoftDeleted = job.deleted_at != null && job.status === JOB_STATUS.DELETED;
            if (isSoftDeleted && delBucket) {
                const d = new Date(job.deleted_at);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const prefix = `deleted/${yyyy}/${mm}/${jobId}_`;
            if (job.r2_raw_key && job.r2_raw_key !== 'url-import-pending') keysToDeleteDeleted.push(prefix + job.r2_raw_key.replace(/\//g, '-'));
            const pubKey = this._publicKeyFromJob(job, 'video');
            if (pubKey) keysToDeleteDeleted.push(prefix + pubKey.replace(/\//g, '-'));
            if (job.thumbnail_key) keysToDeleteDeleted.push(prefix + 'thumb_' + job.thumbnail_key.replace(/\//g, '-'));
        } else {
            if (job.r2_raw_key && job.r2_raw_key !== 'url-import-pending') keysToDeleteRaw.push(job.r2_raw_key);
            const pubKey = this._publicKeyFromJob(job, 'video');
            if (pubKey) keysToDeletePublic.push(pubKey);
            const thumbKey = this._publicKeyFromJob(job, 'thumbnail');
            if (thumbKey) keysToDeletePublic.push(thumbKey);
        }
        if (rawBucket && keysToDeleteRaw.length) await this._deleteR2Keys(rawBucket, keysToDeleteRaw);
        if (pubBucket && keysToDeletePublic.length) await this._deleteR2Keys(pubBucket, keysToDeletePublic);
        if (delBucket && keysToDeleteDeleted.length) await this._deleteR2Keys(delBucket, keysToDeleteDeleted);
        const db = env?.DB || this.env?.DB;
        if (db) {
            try {
                const storageLog = new StorageLifecycleLogRepository(db);
                if (keysToDeleteRaw.length) await storageLog.insert({ jobId, eventType: 'r2_delete', bucket: 'raw', reason: 'Permanent delete', details: { key_count: keysToDeleteRaw.length, keys: keysToDeleteRaw } });
                if (keysToDeletePublic.length) await storageLog.insert({ jobId, eventType: 'r2_delete', bucket: 'public', reason: 'Permanent delete', details: { key_count: keysToDeletePublic.length, keys: keysToDeletePublic } });
                if (keysToDeleteDeleted.length) await storageLog.insert({ jobId, eventType: 'r2_delete', bucket: 'deleted', reason: 'Permanent delete', details: { key_count: keysToDeleteDeleted.length, keys: keysToDeleteDeleted } });
            } catch (e) { logger.warn('StorageLifecycleLog insert (permanentDelete)', { message: e?.message }); }
        }
        const deleted = await this.jobRepo.forceHardDeleteJob(jobId);
        if (deleted) logger.info('Permanent delete (idam) job', { jobId, userId });
        if (!deleted) throw new ConflictError('Job could not be deleted from database');
    }

    async deleteJobs(ids, userId, env, isRoot = false) {
        const arr = Array.isArray(ids) ? ids : [];
        const nums = arr.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
        const result = { deleted: 0, skipped: [], errors: [] };
        if (!nums.length) return result;
        const jobs = await this.jobRepo.getByIds(nums);
        const allowedJobs = jobs.filter(j => isRoot || j.uploaded_by === userId);
        const toSoftDeleteIds = allowedJobs.filter(j => !PROCESSING_STATUSES.includes(j.status)).map(j => j.id);
        const skippedIds = nums.filter(id => {
            const job = jobs.find(j => j.id === id);
            if (!job) return true;
            if (!isRoot && job.uploaded_by !== userId) return true;
            if (PROCESSING_STATUSES.includes(job.status)) return true;
            return false;
        });
        const { updatedIds } = await this.jobRepo.softDeleteJobsByIds(toSoftDeleteIds);
        const jobsToMove = jobs.filter(j => updatedIds.includes(j.id));
        const rawBucket = env?.[this.rawBucket] || this.env[this.rawBucket];
        const pubBucket = env?.[this.pubBucket] || this.env[this.pubBucket];
        const delBucket = env?.[this.delBucket] || this.env[this.delBucket];
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        // Build move tasks, then execute in batches of 20 to avoid R2 rate limits
        const moveTasks = [];
        for (const job of jobsToMove) {
            const jobId = job.id;
            const prefix = `deleted/${yyyy}/${mm}/${jobId}_`;
            if (job.r2_raw_key && job.r2_raw_key !== 'url-import-pending' && rawBucket && delBucket) {
                moveTasks.push(() => this._moveToDeletedBucket(rawBucket, delBucket, job.r2_raw_key, prefix + job.r2_raw_key.replace(/\//g, '-')));
            }
            if (job.public_url && job.status === JOB_STATUS.COMPLETED && pubBucket && delBucket) {
                const pubKey = this._publicKeyFromJob(job, 'video');
                if (pubKey) moveTasks.push(() => this._moveToDeletedBucket(pubBucket, delBucket, pubKey, prefix + pubKey.replace(/\//g, '-')));
            }
            if (job.thumbnail_key && pubBucket && delBucket) {
                moveTasks.push(() => this._moveToDeletedBucket(pubBucket, delBucket, job.thumbnail_key, prefix + 'thumb_' + job.thumbnail_key.replace(/\//g, '-')));
            }
        }
        const MOVE_BATCH = 20;
        for (let i = 0; i < moveTasks.length; i += MOVE_BATCH) {
            await Promise.allSettled(moveTasks.slice(i, i + MOVE_BATCH).map(fn => fn()));
        }
        result.deleted = updatedIds.length;
        result.skipped = skippedIds;
        return result;
    }

    async permanentDeleteJobs(ids, userId, env, isRoot = false) {
        const arr = Array.isArray(ids) ? ids : [];
        const nums = arr.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
        const result = { deleted: 0, skipped: [], errors: [] };
        if (!nums.length) return result;
        const jobs = await this.jobRepo.getByIds(nums);
        const allowedJobs = jobs.filter(j => isRoot || j.uploaded_by === userId);
        const toDeleteIds = allowedJobs.map(j => j.id);
        const skippedIds = nums.filter(id => {
            const job = jobs.find(j => j.id === id);
            return !job || (!isRoot && job.uploaded_by !== userId);
        });
        const rawBucket = env?.[this.rawBucket] || this.env[this.rawBucket];
        const pubBucket = env?.[this.pubBucket] || this.env[this.pubBucket];
        const delBucket = env?.[this.delBucket] || this.env[this.delBucket];
        const keysToDeleteRaw = [];
        const keysToDeletePublic = [];
        const keysToDeleteDeleted = [];
        for (const job of allowedJobs) {
            const isSoftDeleted = job.deleted_at != null && job.status === JOB_STATUS.DELETED;
            if (isSoftDeleted && delBucket) {
                const d = new Date(job.deleted_at);
                const prefix = `deleted/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${job.id}_`;
                if (job.r2_raw_key && job.r2_raw_key !== 'url-import-pending') keysToDeleteDeleted.push(prefix + job.r2_raw_key.replace(/\//g, '-'));
                const pubKey = this._publicKeyFromJob(job, 'video');
                if (pubKey) keysToDeleteDeleted.push(prefix + pubKey.replace(/\//g, '-'));
                if (job.thumbnail_key) keysToDeleteDeleted.push(prefix + 'thumb_' + job.thumbnail_key.replace(/\//g, '-'));
            } else {
                if (job.r2_raw_key && job.r2_raw_key !== 'url-import-pending') keysToDeleteRaw.push(job.r2_raw_key);
                const pubKey = this._publicKeyFromJob(job, 'video');
                if (pubKey) keysToDeletePublic.push(pubKey);
                const thumbKey = this._publicKeyFromJob(job, 'thumbnail');
                if (thumbKey) keysToDeletePublic.push(thumbKey);
            }
        }
        if (rawBucket) await this._deleteR2Keys(rawBucket, keysToDeleteRaw);
        if (pubBucket) await this._deleteR2Keys(pubBucket, keysToDeletePublic);
        if (delBucket) await this._deleteR2Keys(delBucket, keysToDeleteDeleted);
        await this.jobRepo.forceHardDeleteJobByIds(toDeleteIds);
        result.deleted = toDeleteIds.length;
        result.skipped = skippedIds;
        return result;
    }

    async restoreJob(id, env, isRoot = false) {
        if (!isRoot) throw new AuthError('Sadece root kullanıcı geri yükleyebilir', 403);
        const jobId = parseInt(id, 10);
        if (isNaN(jobId)) throw new ValidationError(`Invalid video id: ${id}`);
        const job = await this.jobRepo.getById(jobId);
        if (!job) throw new NotFoundError('Video', id);
        if (!job.deleted_at || job.status !== JOB_STATUS.DELETED) throw new ConflictError('Bu video silinmiş değil veya zaten geri yüklenmiş');
        const rawBucket = env?.[this.rawBucket] || this.env[this.rawBucket];
        const pubBucket = env?.[this.pubBucket] || this.env[this.pubBucket];
        const delBucket = env?.[this.delBucket] || this.env[this.delBucket];
        const d = new Date(job.deleted_at);
        const prefix = `deleted/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${jobId}_`;
        if (job.r2_raw_key && job.r2_raw_key !== 'url-import-pending' && rawBucket && delBucket) {
            const delKey = prefix + job.r2_raw_key.replace(/\//g, '-');
            await this._copyFromDeletedToBucket(delBucket, rawBucket, delKey, job.r2_raw_key);
        }
        let pubKey = this._publicKeyFromJob(job, 'video');
        if (job.public_url && pubBucket && delBucket) {
            if (!pubKey && job.public_url) {
                try {
                    pubKey = new URL(job.public_url).pathname.replace(/^\/public\/?/, '').replace(/^\//, '');
                } catch (e) {
                    logger.warn('restoreJob: invalid public_url', { jobId, public_url: job.public_url, message: e?.message });
                }
            }
            if (pubKey) {
                const delKey = prefix + pubKey.replace(/\//g, '-');
                await this._copyFromDeletedToBucket(delBucket, pubBucket, delKey, pubKey);
            }
        }
        if (job.thumbnail_key && pubBucket && delBucket) {
            const delKey = prefix + 'thumb_' + job.thumbnail_key.replace(/\//g, '-');
            await this._copyFromDeletedToBucket(delBucket, pubBucket, delKey, job.thumbnail_key);
        }
        const restored = await this.jobRepo.restoreJob(jobId);
        if (!restored) throw new ConflictError('Geri yükleme başarısız');
        logger.info('Restored job', { jobId });
        return restored;
    }

    async purgeJob(id, env, isRoot = false) {
        if (!isRoot) throw new AuthError('Sadece root kullanıcı kalıcı silebilir', 403);
        const jobId = parseInt(id, 10);
        if (isNaN(jobId)) throw new ValidationError(`Invalid video id: ${id}`);
        const job = await this.jobRepo.getById(jobId);
        if (!job) throw new NotFoundError('Video', id);
        if (!job.deleted_at || job.status !== JOB_STATUS.DELETED) throw new ConflictError('Bu video silinmiş değil');
        const delBucket = env?.[this.delBucket] || this.env[this.delBucket];
        const d = new Date(job.deleted_at);
        const prefix = `deleted/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${jobId}_`;
        const keysToDelete = [];
        if (job.r2_raw_key && job.r2_raw_key !== 'url-import-pending') keysToDelete.push(prefix + job.r2_raw_key.replace(/\//g, '-'));
        const pubKey = this._publicKeyFromJob(job, 'video');
        if (pubKey) keysToDelete.push(prefix + pubKey.replace(/\//g, '-'));
        if (job.thumbnail_key) keysToDelete.push(prefix + 'thumb_' + job.thumbnail_key.replace(/\//g, '-'));
        if (delBucket) for (const key of keysToDelete) {
            await delBucket.delete(key);
            logger.info('Purged R2', { key });
        }
        const ok = await this.jobRepo.hardDeleteJob(jobId);
        if (ok) logger.info('Purged job from DB', { jobId });
        return ok;
    }

    async restoreJobs(ids, env, isRoot = false) {
        if (!isRoot) throw new AuthError('Sadece root kullanıcı geri yükleyebilir', 403);
        const arr = Array.isArray(ids) ? ids : [];
        const nums = arr.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
        const result = { restored: 0, errors: [] };
        for (const id of nums) {
            try {
                await this.restoreJob(id, env, true);
                result.restored++;
            } catch (e) {
                result.errors.push(`${id}: ${e?.message || e}`);
            }
        }
        return result;
    }

    async purgeJobs(ids, env, isRoot = false) {
        if (!isRoot) throw new AuthError('Sadece root kullanıcı kalıcı silebilir', 403);
        const arr = Array.isArray(ids) ? ids : [];
        const nums = arr.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
        const result = { purged: 0, errors: [] };
        for (const id of nums) {
            try {
                if (await this.purgeJob(id, env, true)) result.purged++;
            } catch (e) {
                result.errors.push(`${id}: ${e?.message || e}`);
            }
        }
        return result;
    }
}
