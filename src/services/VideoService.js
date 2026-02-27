/**
 * Video Service — BK Video Factory (Facade)
 *
 * Orchestrates the full lifecycle via UploadService, ProcessingService,
 * DeletionService, StatisticsService. Single public API for routes.
 */

import { CONFIG } from '../config/config.js';
import { JobRepository } from '../repositories/JobRepository.js';
import { UploadTokenRepository } from '../repositories/UploadTokenRepository.js';
import { UploadService } from './UploadService.js';
import { ProcessingService } from './ProcessingService.js';
import { DeletionService } from './DeletionService.js';
import { StatisticsService } from './StatisticsService.js';
import { validateR2Key as doValidateR2Key, sanitizeFilename as doSanitizeFilename } from '../utils/videoValidation.js';

export class VideoService {
    constructor(env) {
        this.env = env;
        this.jobRepo = new JobRepository(env);
        this.uploadTokenRepo = env.DB ? new UploadTokenRepository(env.DB) : null;
        this.cdnBase = env.R2_PUBLIC_URL || (env.CDN_BASE_URL ? String(env.CDN_BASE_URL).replace(/\/$/, '') : '') || CONFIG.CDN_BASE_URL_FALLBACK;
        this.rawBucket = 'R2_RAW_UPLOADS_BUCKET';
        this.pubBucket = 'R2_PUBLIC_BUCKET';
        this.delBucket = 'R2_DELETED_BUCKET';

        this.uploadService = new UploadService(env, this.jobRepo, this.uploadTokenRepo);
        this.processingService = new ProcessingService(env, this.jobRepo);
        this.deletionService = new DeletionService(env, this.jobRepo, {
            cdnBase: this.cdnBase,
            rawBucket: this.rawBucket,
            pubBucket: this.pubBucket,
            delBucket: this.delBucket,
        });
        this.statisticsService = new StatisticsService(env, this.jobRepo);
    }

    validateR2Key(key, allowedPrefixes) {
        return doValidateR2Key(key, allowedPrefixes);
    }

    sanitizeFilename(filename) {
        return doSanitizeFilename(filename);
    }

    async generatePresignedUrl(params, userId) {
        return this.uploadService.generatePresignedUrl(params, userId);
    }

    async getRawPresignedDownloadUrl(r2RawKey, expiresInSeconds = 3600) {
        return this.processingService.getRawPresignedDownloadUrl(r2RawKey, expiresInSeconds);
    }

    async getPresignedUploadForAgent(jobId, workerId, bucket, key, contentType = 'video/mp4') {
        return this.processingService.getPresignedUploadForAgent(jobId, workerId, bucket, key, contentType);
    }

    async urlImportDone(jobId, workerId, r2RawKey, fileSizeInput) {
        return this.processingService.urlImportDone(jobId, workerId, r2RawKey, fileSizeInput);
    }

    async cancelJobIfOrphan(jobId, userId) {
        return this.processingService.cancelJobIfOrphan(jobId, userId);
    }

    async deleteRawObjectIfExists(r2RawKey) {
        return this.processingService.deleteRawObjectIfExists(r2RawKey);
    }

    async handleDirectUploadComplete(token, request) {
        return this.uploadService.handleDirectUploadComplete(token, request);
    }

    async handleDirectUpload(request, token) {
        return this.uploadService.handleDirectUpload(request, token);
    }

    async handleMultipartUpload(request, userId) {
        return this.uploadService.handleMultipartUpload(request, userId);
    }

    async importFromUrl(params, userId) {
        return this.uploadService.importFromUrl(params, userId);
    }

    async importFromUrlSync(params, userId, env) {
        return this.uploadService.importFromUrlSync(params, userId, env);
    }

    isDriveFolderUrl(url) {
        return this.uploadService.isDriveFolderUrl(url);
    }

    async importFromDriveFolder(params, userId) {
        return this.uploadService.importFromDriveFolder(params, userId);
    }

    async getJobs(filters = {}) {
        return this.statisticsService.getJobs(filters);
    }

    async getJobById(id) {
        return this.statisticsService.getJobById(id);
    }

    async updateJob(id, data, userId, env, isRoot = false) {
        return this.statisticsService.updateJob(id, data, userId, env, isRoot);
    }

    async deleteJob(id, userId, env, isRoot = false) {
        return this.deletionService.deleteJob(id, userId, env, isRoot);
    }

    async permanentDeleteJob(id, userId, env, isRoot = false) {
        return this.deletionService.permanentDeleteJob(id, userId, env, isRoot);
    }

    async deleteJobs(ids, userId, env, isRoot = false) {
        return this.deletionService.deleteJobs(ids, userId, env, isRoot);
    }

    async permanentDeleteJobs(ids, userId, env, isRoot = false) {
        return this.deletionService.permanentDeleteJobs(ids, userId, env, isRoot);
    }

    async restoreJob(id, env, isRoot = false) {
        return this.deletionService.restoreJob(id, env, isRoot);
    }

    async purgeJob(id, env, isRoot = false) {
        return this.deletionService.purgeJob(id, env, isRoot);
    }

    async restoreJobs(ids, env, isRoot = false) {
        return this.deletionService.restoreJobs(ids, env, isRoot);
    }

    async purgeJobs(ids, env, isRoot = false) {
        return this.deletionService.purgeJobs(ids, env, isRoot);
    }

    async bulkMoveJobs(ids, folderId, userId) {
        const result = await this.jobRepo.updateFolderForJobs(ids, folderId == null || folderId === '' ? null : parseInt(folderId, 10));
        return result;
    }

    async retryJob(id, userId, env, isRoot = false) {
        return this.processingService.retryJob(id, userId, env, isRoot);
    }

    async reprocessJobs(jobIds, userId, isRoot = false) {
        return this.processingService.reprocessJobs(jobIds, userId, isRoot);
    }

    async getStatistics(days = 30) {
        return this.statisticsService.getStatistics(days);
    }

    async cleanupOldVideos(days = 3) {
        return this.statisticsService.cleanupOldVideos(days);
    }

    async unstickOrphanedJobs(minutes = 30) {
        return this.processingService.unstickOrphanedJobs(minutes);
    }

    async releaseStaleJobsForWorker(workerId, minutes = 45) {
        return this.processingService.releaseStaleJobsForWorker(workerId, minutes);
    }
}
