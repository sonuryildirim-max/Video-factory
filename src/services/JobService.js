/**
 * Job Service for BK-VF (Bilge Karga Video Factory)
 * Atomic job processing with exponential backoff polling
 * Based on master JSON architecture from conversation with Claude
 */

import { JobRepository } from '../repositories/JobRepository.js';
import { D1Repository } from '../repositories/D1Repository.js';
import { LogService } from './LogService.js';
import { CONFIG } from '../config/config.js';
import { JOB_STATUS } from '../config/BK_CONSTANTS.js';
import { ValidationError, NotFoundError, BK_ERROR_CODES } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const RAW_BUCKET_BINDING = 'R2_RAW_UPLOADS_BUCKET';

export class JobService {
    constructor(env) {
        this.env = env;
        this.jobRepo    = new JobRepository(env);
        this.rawBucket  = env[RAW_BUCKET_BINDING];
        // LogService expects (kvRepo, d1Repo); job logs only need D1.
        this.logService = new LogService(new D1Repository(env.DB));
    }

    /**
     * Create a new conversion job
     * @param {Object} jobData - Job data
     * @returns {Promise<Object>} Created job
     */
    async createJob(jobData) {
        try {
            // Validate required fields
            const invalid = [];
            if (!jobData.original_name || typeof jobData.original_name !== 'string')
                invalid.push({ field: 'original_name', error: 'Required string', error_code: BK_ERROR_CODES.MISSING_FIELD });
            if (!jobData.r2_raw_key || typeof jobData.r2_raw_key !== 'string')
                invalid.push({ field: 'r2_raw_key', error: 'Required string', error_code: BK_ERROR_CODES.MISSING_FIELD });
            if (!jobData.quality || typeof jobData.quality !== 'string')
                invalid.push({ field: 'quality', error: 'Required string', error_code: BK_ERROR_CODES.MISSING_FIELD });
            if (jobData.r2_raw_key && !jobData.r2_raw_key.startsWith('raw-uploads/'))
                invalid.push({ field: 'r2_raw_key', error: 'Must start with raw-uploads/', error_code: BK_ERROR_CODES.R2_RAW_URL_INVALID });
            if (invalid.length) throw new ValidationError('Missing or invalid job fields', invalid);

            // Generate clean name (sanitize original name)
            const cleanName = this.sanitizeFilename(jobData.original_name);
            
            // Create job in database
            const job = await this.jobRepo.create({
                original_name: jobData.original_name,
                clean_name: cleanName,
                r2_raw_key: jobData.r2_raw_key,
                quality: jobData.quality,
                file_size_input: jobData.file_size_input || 0,
                uploaded_by: jobData.uploaded_by || 'admin',
                tags: jobData.tags || '',
                project_name: jobData.project_name || '',
                notes: jobData.notes || ''
            });

            // Log job creation
            await this.logService.createJobLog(job.id, 'INFO', 'Job created', 'UPLOAD', {
                original_name: job.original_name,
                clean_name: job.clean_name,
                quality: job.quality
            });

            return job;
        } catch (error) {
            logger.error('Error creating job', { error: error?.message ?? String(error) });
            throw error;
        }
    }

    /**
     * Claim a pending job (atomic operation)
     * @param {string} workerId - Worker identifier
     * @returns {Promise<Object|null>} Claimed job or null if no jobs available
     */
    async claimJob(workerId) {
        try {
            // Atomic claim: PENDING → PROCESSING
            const job = await this.jobRepo.claimPendingJob(workerId);
            
            if (!job) {
                return null; // No pending jobs
            }

            // Log job claim
            await this.logService.createJobLog(job.id, 'INFO', 'Job claimed by worker', 'CLAIM', {
                worker_id: workerId,
                started_at: job.started_at
            });

            // Generate presigned URL for raw file download
            const downloadUrl = this.rawBucket?.createPresignedUrl
                ? await this.rawBucket.createPresignedUrl(job.r2_raw_key, { method: 'GET', expiresIn: 300 })
                : null;

            return {
                ...job,
                download_url: downloadUrl,
                ffmpeg_preset: this.getFfmpegPreset(job.quality)
            };
        } catch (error) {
            logger.error('Error claiming job', { error: error?.message ?? String(error) });
            throw error;
        }
    }

    /**
     * Complete a job
     * @param {number} jobId - Job ID
     * @param {string} workerId - Worker identifier
     * @param {Object} result - Processing result
     * @returns {Promise<Object>} Updated job
     */
    async completeJob(jobId, workerId, result) {
        try {
            // Validate result
            if (!result.public_url || typeof result.public_url !== 'string') {
                const err = new ValidationError('Missing public_url in result', [
                    { field: 'public_url', error: 'Required string', error_code: BK_ERROR_CODES.R2_PUBLIC_URL_INVALID },
                ]);
                err.errorCode = BK_ERROR_CODES.R2_PUBLIC_URL_INVALID;
                throw err;
            }

            // Fetch current job to get r2_raw_key before D1 update
            const currentJob = await this.jobRepo.getById(jobId);
            if (!currentJob) throw new NotFoundError('Job', String(jobId));

            // Delete raw file from R2 BEFORE marking COMPLETED in D1.
            // If deletion fails it throws — D1 is not updated and the job stays in its current state.
            if (this.rawBucket && currentJob.r2_raw_key && currentJob.r2_raw_key !== 'url-import-pending') {
                await this.rawBucket.delete(currentJob.r2_raw_key);
                await this.logService.createJobLog(jobId, 'INFO', 'Raw file deleted from R2 before COMPLETED', 'CLEANUP');
            }

            // Raw deletion succeeded — now safe to mark COMPLETED in D1
            const job = await this.jobRepo.completeJob(jobId, workerId, {
                public_url: result.public_url,
                file_size_output: result.file_size_output || 0,
                duration: result.duration || 0,
                processing_time_seconds: result.processing_time_seconds || 0,
                resolution: result.resolution || '',
                bitrate: result.bitrate || 0,
                codec: result.codec || 'h264',
                frame_rate: result.frame_rate || 30,
                audio_codec: result.audio_codec || 'aac',
                audio_bitrate: result.audio_bitrate || 128,
                ffmpeg_command: result.ffmpeg_command || '',
                ffmpeg_output: result.ffmpeg_output || ''
            });

            // Log job completion
            await this.logService.createJobLog(jobId, 'INFO', 'Job completed successfully', 'COMPLETE', {
                public_url: result.public_url,
                file_size_output: result.file_size_output,
                processing_time_seconds: result.processing_time_seconds,
                compression_percentage: job.file_size_input > 0 
                    ? Math.round((1 - (result.file_size_output / job.file_size_input)) * 100)
                    : 0
            });

            return job;
        } catch (error) {
            logger.error('Error completing job', { error: error?.message ?? String(error) });
            
            // Log error
            await this.logService.createJobLog(jobId, 'ERROR', `Failed to complete job: ${error.message}`, 'COMPLETE_FAIL', {
                error: error.message,
                result: result
            });

            throw error;
        }
    }

    /**
     * Fail a job
     * @param {number} jobId - Job ID
     * @param {string} workerId - Worker identifier
     * @param {string} errorMessage - Error message
     * @returns {Promise<Object>} Updated job
     */
    async failJob(jobId, workerId, errorMessage) {
        try {
            // Get current job
            const job = await this.jobRepo.getById(jobId);
            
            if (!job) {
                throw new NotFoundError('Job', String(jobId));
            }

            // Check retry count
            const retryCount = job.retry_count + 1;
            const maxRetries = CONFIG.JOB_MAX_RETRIES || 3;

            let newStatus = JOB_STATUS.FAILED;
            if (retryCount < maxRetries) {
                // Retry: set back to PENDING
                newStatus = JOB_STATUS.PENDING;
            }

            // Update job status
            const updatedJob = await this.jobRepo.failJob(jobId, workerId, {
                error_message: errorMessage,
                retry_count: retryCount,
                status: newStatus
            });

            // Log failure
            await this.logService.createJobLog(jobId, 'ERROR', `Job failed: ${errorMessage}`, 'FAIL', {
                worker_id: workerId,
                retry_count: retryCount,
                max_retries: maxRetries,
                new_status: newStatus
            });

            return updatedJob;
        } catch (error) {
            logger.error('Error failing job', { error: error?.message ?? String(error) });
            throw error;
        }
    }

    /**
     * Get job statistics
     * @returns {Promise<Object>} Statistics
     */
    async getStatistics() {
        try {
            const stats = await this.jobRepo.getStatistics();
            
            // Calculate additional metrics
            const totalJobs = stats.total_jobs || 0;
            const completedJobs = stats.completed_jobs || 0;
            const failedJobs = stats.failed_jobs || 0;
            const pendingJobs = stats.pending_jobs || 0;
            
            return {
                summary: {
                    total_jobs: totalJobs,
                    completed: completedJobs,
                    failed: failedJobs,
                    processing: pendingJobs,
                    success_rate: totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0
                },
                recent_activity: await this.jobRepo.getRecentActivity(7),
                top_uploaders: await this.jobRepo.getTopUploaders(5),
                daily_stats: await this.jobRepo.getDailyStatistics(30)
            };
        } catch (error) {
            logger.error('Error getting statistics', { error: error?.message ?? String(error) });
            throw error;
        }
    }

    /**
     * Clean up timed out jobs (should be called by cron)
     * @returns {Promise<number>} Number of cleaned up jobs
     */
    async cleanupTimedOutJobs() {
        try {
            const timeoutMinutes = CONFIG.JOB_PROCESSING_TIMEOUT_MINUTES || 60;
            const timedOutJobs = await this.jobRepo.getTimedOutJobs(timeoutMinutes);
            
            let cleanedCount = 0;
            
            for (const job of timedOutJobs) {
                try {
                    const retryCount = (job.retry_count || 0) + 1;
                    const maxRetries = CONFIG.JOB_MAX_RETRIES || 3;
                    const newStatus = retryCount < maxRetries ? JOB_STATUS.PENDING : JOB_STATUS.FAILED;
                    const updated = await this.jobRepo.failJobByIdOnly(job.id, {
                        error_message: `Processing timeout (${timeoutMinutes} minutes)`,
                        retry_count: retryCount,
                        status: newStatus
                    });
                    if (updated) {
                        cleanedCount++;
                        await this.logService.createJobLog(job.id, 'ERROR', `Job failed: timeout (${timeoutMinutes} min)`, 'FAIL', {
                            worker_id: job.worker_id || 'system',
                            retry_count: retryCount,
                            max_retries: maxRetries,
                            new_status: newStatus
                        });
                    }
                } catch (error) {
                    logger.error('Failed to cleanup job', { jobId: job.id, error: error?.message ?? String(error) });
                }
            }
            
            return cleanedCount;
        } catch (error) {
            logger.error('Error cleaning up timed out jobs', { error: error?.message ?? String(error) });
            throw error;
        }
    }

    /**
     * Update worker heartbeat
     * @param {string} workerId - Worker identifier
     * @param {Object} heartbeatData - Heartbeat data
     * @returns {Promise<Object>} Updated heartbeat
     */
    async updateWorkerHeartbeat(workerId, heartbeatData) {
        try {
            return await this.jobRepo.updateWorkerHeartbeat(workerId, {
                status: heartbeatData.status || 'ACTIVE',
                current_job_id: heartbeatData.current_job_id,
                ip_address: heartbeatData.ip_address,
                version: heartbeatData.version || '1.0.0'
            });
        } catch (error) {
            logger.error('Error updating worker heartbeat', { error: error?.message ?? String(error) });
            throw error;
        }
    }

    /**
     * Get FFmpeg preset for quality (resolution + Web Optimize; bitrate/FPS from source in agent).
     * @param {string} quality - 720p or 1080p
     * @returns {string} FFmpeg preset
     */
    getFfmpegPreset(quality) {
        const presets = {
            '720p': CONFIG.FFMPEG_720P_PRESET || '-c:v libx264 -profile:v high -level 4.1 -movflags +faststart -c:a aac -vf scale=-2:720 -pix_fmt yuv420p',
            '1080p': CONFIG.FFMPEG_1080P_PRESET || '-c:v libx264 -profile:v high -level 4.1 -movflags +faststart -c:a aac -vf scale=-2:1080 -pix_fmt yuv420p'
        };
        return presets[quality] || presets['720p'];
    }

    /**
     * Sanitize filename
     * @param {string} filename - Original filename
     * @returns {string} Sanitized filename
     */
    sanitizeFilename(filename) {
        // Remove extension
        const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
        
        // Convert Turkish characters to English equivalents
        const turkishMap = {
            'ç': 'c', 'Ç': 'C',
            'ğ': 'g', 'Ğ': 'G',
            'ı': 'i', 'İ': 'I',
            'ö': 'o', 'Ö': 'O',
            'ş': 's', 'Ş': 'S',
            'ü': 'u', 'Ü': 'U'
        };
        
        let sanitized = nameWithoutExt;
        for (const [turkish, english] of Object.entries(turkishMap)) {
            sanitized = sanitized.replace(new RegExp(turkish, 'g'), english);
        }
        
        // Convert to lowercase
        sanitized = sanitized.toLowerCase();
        
        // Replace spaces and special characters with hyphens
        sanitized = sanitized.replace(/[^a-z0-9]/g, '-');
        
        // Remove multiple consecutive hyphens
        sanitized = sanitized.replace(/-+/g, '-');
        
        // Remove leading/trailing hyphens
        sanitized = sanitized.replace(/^-+|-+$/g, '');
        
        // Add random suffix and .mp4 extension
        const randomSuffix = Math.random().toString(36).substring(2, 10);
        return `${sanitized}-${randomSuffix}.mp4`;
    }

    /**
     * Get jobs with filters
     * @param {Object} filters - Filter criteria
     * @returns {Promise<Array>} Filtered jobs
     */
    async getJobs(filters = {}) {
        try {
            return await this.jobRepo.getJobs(filters);
        } catch (error) {
            logger.error('Error getting jobs', { error: error?.message ?? String(error) });
            throw error;
        }
    }

    /**
     * Get job by ID
     * @param {number} jobId - Job ID
     * @returns {Promise<Object>} Job details
     */
    async getJobById(jobId) {
        try {
            const job = await this.jobRepo.getById(jobId);
            if (!job) {
                throw new NotFoundError('Job', String(jobId));
            }
            
            // Get job logs
            const logs = await this.logService.getJobLogs(jobId);
            
            return {
                ...job,
                logs: logs
            };
        } catch (error) {
            logger.error('Error getting job by ID', { error: error?.message ?? String(error) });
            throw error;
        }
    }
}