/**
 * Statistics and list/CRUD metadata — BK Video Factory
 * getJobs, getJobById, updateJob, getStatistics, cleanupOldVideos
 */

import { VIDEO_CONSTANTS } from '../config/config.js';
import { JOB_STATUS, PROCESSING_STATUSES, QUEUED_STATUSES } from '../config/BK_CONSTANTS.js';
import { StatisticsDTO } from '../utils/dto.js';
import { ValidationError, NotFoundError, AuthError, BK_ERROR_CODES } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getR2RealUsage } from './R2RealStatsService.js';
import { StorageLifecycleLogRepository } from '../repositories/StorageLifecycleLogRepository.js';

const RAW_BUCKET = 'R2_RAW_UPLOADS_BUCKET';

/** Derive R2 public bucket key from public_url (same logic as DeletionService). */
function publicKeyFromUrl(publicUrl, cdnBase) {
    if (!publicUrl || !cdnBase) return '';
    const base = cdnBase.replace(/\/$/, '');
    if (publicUrl.startsWith(base)) return publicUrl.slice(base.length).replace(/^\//, '');
    try {
        return new URL(publicUrl).pathname.replace(/^\/public\/?/, '').replace(/^\//, '');
    } catch {
        return '';
    }
}

export class StatisticsService {
    constructor(env, jobRepo) {
        this.env = env;
        this.jobRepo = jobRepo;
    }

    async getJobs(filters = {}) {
        const search = filters.search && String(filters.search).trim();
        if (search) return await this.jobRepo.searchWithFTS(search, filters);
        return await this.jobRepo.getJobs(filters);
    }

    async getJobById(id) {
        const jobId = parseInt(id, 10);
        if (isNaN(jobId)) throw new ValidationError(`Invalid video id: ${id}`);
        return await this.jobRepo.getById(jobId);
    }

    _validateMetadataPatch(data) {
        const invalid = [];
        const unsafePattern = /["`\\;]|--/;
        const safeString = (v, maxLen) => {
            if (v == null) return null;
            const s = String(v).trim();
            if (s.length > maxLen) return { error: `Max ${maxLen} characters`, code: BK_ERROR_CODES.INVALID_FIELD_VALUE };
            if (unsafePattern.test(s)) return { error: 'Invalid or disallowed characters', code: BK_ERROR_CODES.INVALID_FIELD_VALUE };
            return null;
        };
        if (Object.prototype.hasOwnProperty.call(data, 'original_name')) {
            const err = safeString(data.original_name, 500);
            if (err) invalid.push({ field: 'original_name', error: err.error, error_code: err.code });
        }
        if (Object.prototype.hasOwnProperty.call(data, 'notes')) {
            const err = safeString(data.notes, 2000);
            if (err) invalid.push({ field: 'notes', error: err.error, error_code: err.code });
        }
        if (Object.prototype.hasOwnProperty.call(data, 'tags')) {
            const err = safeString(data.tags, 500);
            if (err) invalid.push({ field: 'tags', error: err.error, error_code: err.code });
        }
        if (Object.prototype.hasOwnProperty.call(data, 'project_name')) {
            const err = safeString(data.project_name, 255);
            if (err) invalid.push({ field: 'project_name', error: err.error, error_code: err.code });
        }
        if (Object.prototype.hasOwnProperty.call(data, 'privacy')) {
            const v = String(data.privacy).toLowerCase();
            if (!['public', 'private', 'unlisted'].includes(v)) {
                invalid.push({ field: 'privacy', error: 'Must be public, private, or unlisted', error_code: BK_ERROR_CODES.INVALID_FIELD_VALUE });
            }
        }
        if (Object.prototype.hasOwnProperty.call(data, 'allow_download')) {
            const v = data.allow_download;
            if (v !== 0 && v !== 1 && v !== true && v !== false) {
                invalid.push({ field: 'allow_download', error: 'Must be 0, 1, or boolean', error_code: BK_ERROR_CODES.INVALID_FIELD_VALUE });
            }
        }
        if (Object.prototype.hasOwnProperty.call(data, 'folder_id')) {
            const v = data.folder_id;
            if (v != null) {
                const n = parseInt(v, 10);
                if (isNaN(n) || n < 0) {
                    invalid.push({ field: 'folder_id', error: 'Must be non-negative integer or null', error_code: BK_ERROR_CODES.INVALID_FIELD_VALUE });
                }
            }
        }
        if (invalid.length) throw new ValidationError('Invalid metadata', invalid);
    }

    async updateJob(id, data, userId, env, isRoot = false) {
        const jobId = parseInt(id, 10);
        if (isNaN(jobId)) throw new ValidationError(`Invalid video id: ${id}`);
        const existing = await this.jobRepo.getById(jobId);
        if (!existing) throw new NotFoundError('Video', id);
        if (!isRoot && existing.uploaded_by !== userId) throw new AuthError('Bu videoya yetkiniz yok', 403);
        this._validateMetadataPatch(data);
        // SQL safety: column names from allow-list only; values bound (no concatenation of user input).
        const EDITABLE = ['original_name', 'notes', 'tags', 'project_name', 'privacy', 'allow_download', 'folder_id'];
        const setClauses = [];
        const params = [];
        for (const field of EDITABLE) {
            if (Object.prototype.hasOwnProperty.call(data, field)) {
                let val = data[field];
                if (field === 'allow_download') val = val === true || val === 1 ? 1 : 0;
                if (field === 'folder_id' && (val === '' || val == null)) val = null;
                setClauses.push(`${field} = ?`);
                params.push(val);
            }
        }
        if (setClauses.length === 0) return existing;
        params.push(jobId);
        await this.env.DB.prepare(`UPDATE conversion_jobs SET ${setClauses.join(', ')} WHERE id = ?`).bind(...params).run();
        await this.jobRepo.updateFTSIndex(jobId);
        return await this.jobRepo.getById(jobId);
    }

    async getStatistics(days = 30) {
        const [summary, activityResult, uploadersResult, storageKeys] = await Promise.all([
            this.jobRepo.getStatistics(),
            this.jobRepo.getRecentActivity(days),
            this.jobRepo.getTopUploaders(10),
            this.jobRepo.getStorageKeysForStats(),
        ]);
        const activity = activityResult?.results || activityResult || [];
        const uploaders = uploadersResult?.results || uploadersResult || [];
        const cdnBase = this.env.R2_PUBLIC_URL || (this.env.CDN_BASE_URL ? String(this.env.CDN_BASE_URL).replace(/\/$/, '') : '') || 'https://cdn.bilgekarga.tr';
        const rawKeysSet = new Set(storageKeys?.rawKeys || []);
        const publicKeysSet = new Set(
            (storageKeys?.publicUrls || []).map(url => publicKeyFromUrl(url, cdnBase)).filter(Boolean)
        );
        const d1Keys = { rawKeys: rawKeysSet, publicKeys: publicKeysSet };
        const r2Real = await getR2RealUsage(this.env, d1Keys);
        const rawMb = Math.round((r2Real.rawTotalBytes / (1024 * 1024)) * 100) / 100;
        const pubMb = Math.round((r2Real.publicTotalBytes / (1024 * 1024)) * 100) / 100;
        const r2Payload = {
            raw_usage_mb:    rawMb,
            public_usage_mb: pubMb,
            total_real_r2:   Math.round((rawMb + pubMb) * 100) / 100,
            sync_error:      r2Real.sync_error,
        };
        if (r2Real.sync_error && this.env.DB) {
            try {
                const storageLog = new StorageLifecycleLogRepository(this.env.DB);
                await storageLog.insert({
                    eventType: 'size_mismatch',
                    reason: 'D1 vs R2 key/size sync error',
                    details: { rawTotalBytes: r2Real.rawTotalBytes, publicTotalBytes: r2Real.publicTotalBytes },
                });
            } catch (e) { logger.warn('StorageLifecycleLog insert (size_mismatch)', { message: e?.message }); }
        }
        return StatisticsDTO.build(summary, activity, uploaders, r2Payload);
    }

    async cleanupOldVideos(days = 3) {
        const zombieThresholdHours = 2;
        const queuedStatuses = [...QUEUED_STATUSES, JOB_STATUS.FAILED];
        const queuedPh = queuedStatuses.map(() => '?').join(',');
        const processingPh = PROCESSING_STATUSES.map(() => '?').join(',');
        const result = await this.env.DB.prepare(`
            SELECT id, r2_raw_key FROM conversion_jobs
            WHERE (
                status IN (${queuedPh})
                AND created_at < datetime('now', '-' || ? || ' days')
            ) OR (
                status IN (${processingPh})
                AND started_at < datetime('now', '-' || ? || ' hours')
            )
        `).bind(...queuedStatuses, days, ...PROCESSING_STATUSES, zombieThresholdHours).all();
        const rows = result.results || [];
        const bucket = this.env[RAW_BUCKET];
        const r2Keys = rows.map(r => r.r2_raw_key).filter(k => k && k !== 'url-import-pending');
        if (bucket && r2Keys.length > 0) {
            const r2Results = await Promise.allSettled(r2Keys.map(key => bucket.delete(key)));
            r2Results.forEach((res, i) => {
                if (res.status === 'rejected') logger.warn('Cleanup R2 delete failed', { key: r2Keys[i], message: res.reason?.message });
            });
        }
        if (rows.length > 0) {
            const placeholders = rows.map(() => '?').join(',');
            await this.env.DB.prepare(`DELETE FROM conversion_jobs WHERE id IN (${placeholders})`).bind(...rows.map(r => r.id)).run();
            try {
                const storageLog = new StorageLifecycleLogRepository(this.env.DB);
                await storageLog.insert({
                    eventType: 'purge',
                    bucket: 'raw',
                    reason: `Eski RAW silindi, ${rows.length} kayıt`,
                    details: { job_ids: rows.map(r => r.id), keys_deleted: r2Keys.length },
                });
            } catch (e) { logger.warn('StorageLifecycleLog insert (purge)', { message: e?.message }); }
        }
        return { cleaned_count: rows.length, job_ids: rows.map(r => r.id) };
    }
}
