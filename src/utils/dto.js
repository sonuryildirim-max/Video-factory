/**
 * Data Transfer Objects — R2-based video API response shaping
 *
 * Key patterns:
 *  - Resource URIs on every object so clients can self-navigate
 *  - Processing status enum: 'in_progress' | 'complete' | 'error'
 *  - R2 public_url for processed video CDN link
 *  - Paging object with next/previous cursor links
 *  - Namespaced `bk` extension block for platform-specific fields
 */

import { JOB_STATUS } from '../config/BK_CONSTANTS.js';
import { normalizePublicUrl } from './urls.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maps internal job status → processing status */
const TRANSCODE_STATUS = {
    [JOB_STATUS.PENDING]:            'in_progress',
    [JOB_STATUS.PROCESSING]:         'in_progress',
    [JOB_STATUS.DOWNLOADING]:       'in_progress',
    [JOB_STATUS.CONVERTING]:        'in_progress',
    [JOB_STATUS.UPLOADING]:         'in_progress',
    [JOB_STATUS.URL_IMPORT_QUEUED]: 'in_progress',
    [JOB_STATUS.COMPLETED]:         'complete',
    [JOB_STATUS.FAILED]:            'error',
    [JOB_STATUS.DELETED]:           'error',
};

/** Quality presets → dimensions */
const QUALITY_PROFILE = {
    '720p':  { width: 1280, height: 720,  label: '720p HD',      rendition: 'hd' },
    '1080p': { width: 1920, height: 1080, label: '1080p Full HD', rendition: 'fhd' },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function isoOrNull(value) {
    if (!value) return null;
    try { return new Date(value).toISOString(); } catch { return null; }
}

// ─── VideoDTO ─────────────────────────────────────────────────────────────────

/**
 * VideoDTO — converts a `conversion_jobs` row into a video resource.
 * Frontend polls transcode.status until 'complete' | 'error'.
 */
export class VideoDTO {
    /**
     * @param {Object} job     - Row from conversion_jobs table
     * @param {string} cdnBase - CDN base URL (default: https://cdn.bilgekarga.tr)
     */
    static fromJob(job, cdnBase = 'https://cdn.bilgekarga.tr') {
        if (!job) return null;

        const profile    = QUALITY_PROFILE[job.quality] || QUALITY_PROFILE['720p'];
        const isComplete = job.status === JOB_STATUS.COMPLETED;
        const publicUrl  = normalizePublicUrl(job.public_url || '');
        const compressionRatio =
            job.file_size_input && job.file_size_output
                ? Math.round((1 - job.file_size_output / job.file_size_input) * 100)
                : null;

        return {
            // ── Identity ─────────────────────────────────────────────────────
            uri:          `/api/videos/${job.id}`,
            name:         job.original_name,
            description:  job.notes || '',
            type:         'video',
            crf:          job.crf ?? null,

            // ── Timestamps ───────────────────────────────────────────────────
            created_time:  isoOrNull(job.created_at),
            modified_time: isoOrNull(job.started_at  || job.created_at),
            release_time:  isoOrNull(job.completed_at),

            // ── Processing status (clients poll until 'complete' | 'error') ───
            transcode: {
                status:  TRANSCODE_STATUS[job.status] || 'in_progress',
                quality: job.quality,
                // FastStart metadata: moov atom placed at front of MP4 by FFmpeg
                // (-movflags +faststart / HandBrake --optimize)
                fast_start: isComplete,
            },

            // ── Privacy ────────────────────────────────────────────────────────
            privacy: {
                view:     job.privacy      || 'public',   // public | private | nobody
                download: job.allow_download !== false,
                embed:    'public',
            },

            // ── Renditions / Files (R2 public bucket URL) ──────────────────────
            // Only present when transcode.status === 'complete'; PLAY_01: normalized URL
            files: isComplete && publicUrl
                ? [{
                    quality:       job.quality,
                    rendition:     profile.rendition,
                    type:          'video/mp4',
                    width:         job.resolution ? parseInt(job.resolution.split('x')[0]) : profile.width,
                    height:        job.resolution ? parseInt(job.resolution.split('x')[1]) : profile.height,
                    link:          publicUrl,
                    link_expiry:   null,
                    created_time:  isoOrNull(job.completed_at),
                    fps:           job.frame_rate   || 30,
                    size:          job.file_size_output || 0,
                    size_short:    formatBytes(job.file_size_output),
                    md5:           null,
                    public_name:   profile.label,
                    codec:         job.codec        || 'h264',
                    audio_codec:   job.audio_codec  || 'aac',
                    bitrate:       job.bitrate       || 0,
                    audio_bitrate: job.audio_bitrate || 128,
                }]
                : [],

            // ── Thumbnail — set when Hetner agent uploads via POST /api/jobs/complete ──
            pictures: {
                active:    !!job.thumbnail_key,
                type:      'thumbnail',
                base_link: job.thumbnail_key
                    ? `${cdnBase}/${job.thumbnail_key}`
                    : null,
                sizes: job.thumbnail_key ? [
                    { width: 160, height: 90,  link: `${cdnBase}/${job.thumbnail_key}` },
                    { width: 640, height: 360, link: `${cdnBase}/${job.thumbnail_key}` },
                ] : [],
            },

            // ── Metadata ──────────────────────────────────────────────────────
            metadata: {
                interactions: {
                    delete: { uri: `/api/videos/${job.id}`, options: ['DELETE'] },
                    edit:   { uri: `/api/videos/${job.id}`, options: ['PATCH']  },
                    retry:  { uri: `/api/videos/${job.id}/retry`, options: ['POST'] },
                },
            },

            // ── User ──────────────────────────────────────────────────────────
            user: {
                uri:  `/api/users/${job.uploaded_by}`,
                name: job.uploaded_by,
            },

            // ── Folder (for "move to folder" UI) ─────────────────────────────
            folder_id: job.folder_id ?? null,

            // ── Technical ─────────────────────────────────────────────────────
            duration:   job.duration || 0,
            view_count: job.view_count ?? 0,
            width:    profile.width,
            height:   profile.height,

            // ── Convenience URLs (derived from pictures.base_link) ────────────
            thumbnail_url: job.thumbnail_key ? `${cdnBase}/${job.thumbnail_key}` : null,

            // ── BK Platform Extension ─────────────────────────────────────────
            bk: {
                job_id:                  job.id,
                original_name:           job.original_name,
                clean_name:              job.clean_name,
                r2_raw_key:              job.r2_raw_key,
                public_url:              publicUrl,
                quality:                 job.quality,
                status:                  job.status,
                worker_id:               job.worker_id,
                retry_count:             job.retry_count             || 0,
                error_message:           job.error_message           || null,
                ffmpeg_output:           job.ffmpeg_output           || null,
                file_size_input:         job.file_size_input         || 0,
                file_size_output:        job.file_size_output        || 0,
                processing_time_seconds: job.processing_time_seconds || 0,
                resolution:              job.resolution              || null,
                frame_rate:              job.frame_rate              || null,
                tags:                    job.tags                    || '',
                project_name:            job.project_name            || '',
                notes:                   job.notes                   || '',
                ffmpeg_command:          job.ffmpeg_command          || null,
                thumbnail_key:           job.thumbnail_key           || null,
                thumbnail_url:           job.thumbnail_key ? `${cdnBase}/${job.thumbnail_key}` : null, // mirrors root thumbnail_url
                deleted_at:              job.deleted_at              || null,
                view_count:              job.view_count ?? 0,
                processing_profile:      job.processing_profile      || '12',
                crf:                     job.crf ?? null,
                download_progress:       job.download_progress ?? 0,
                download_bytes:          job.download_bytes ?? 0,
                download_total:          job.download_total ?? 0,
                // Compression ratio in percent (e.g. 35 means 35% smaller)
                compression_ratio:       compressionRatio,
                folder_id:              job.folder_id ?? null,
            },
        };
    }

    /** Batch convert */
    static fromJobs(jobs, cdnBase) {
        return (jobs || []).map(j => VideoDTO.fromJob(j, cdnBase));
    }
}

// ─── VideoListDTO ─────────────────────────────────────────────────────────────

/**
 * VideoListDTO — paginated list with page or cursor.
 * Shape: { total, page, per_page, paging: { next, previous, first, last }, next_cursor, data }
 */
export class VideoListDTO {
    /**
     * @param {Object} repoResult  - { jobs, totalCount, page, totalPages, limit, next_cursor }
     * @param {string} baseUri     - e.g. "/api/videos"
     * @param {string} cdnBase
     */
    static build({ jobs, totalCount, page, totalPages, limit, next_cursor }, baseUri = '/api/videos', cdnBase) {
        const cursorBased = next_cursor != null || (page == null && totalPages == null);
        const nextPage = !cursorBased && page != null && totalPages != null && page < totalPages ? page + 1 : null;
        const prevPage = !cursorBased && page != null && page > 1 ? page - 1 : null;
        const nextUrl = next_cursor
            ? `${baseUri}?cursor=${encodeURIComponent(next_cursor)}&per_page=${limit}`
            : (nextPage ? `${baseUri}?page=${nextPage}&per_page=${limit}` : null);

        return {
            total:    totalCount,
            page:     page ?? null,
            per_page: limit,
            paging: {
                next:     nextUrl,
                previous: prevPage ? `${baseUri}?page=${prevPage}&per_page=${limit}` : null,
                first:    `${baseUri}?page=1&per_page=${limit}`,
                last:     (totalPages != null) ? `${baseUri}?page=${totalPages}&per_page=${limit}` : null,
            },
            next_cursor: next_cursor ?? undefined,
            data: VideoDTO.fromJobs(jobs, cdnBase),
        };
    }
}

// ─── UploadLinkDTO ────────────────────────────────────────────────────────────

/**
 * UploadLinkDTO — R2 presigned PUT upload link response.
 */
export class UploadLinkDTO {
    /**
     * @param {Object} params
     * @param {number}  params.jobId
     * @param {string}  params.uploadUrl     - Presigned PUT URL
     * @param {string}  params.uploadToken   - Opaque token stored in KV
     * @param {string}  params.cleanName
     * @param {string}  params.r2Key
     * @param {number}  params.expiresIn     - Seconds
     */
    static build({ jobId, uploadUrl, uploadToken, cleanName, r2Key, expiresIn = 900 }) {
        return {
            upload: {
                approach:     'r2-presigned',
                upload_link:  uploadUrl,
                upload_token: uploadToken,
                expires_at:   new Date(Date.now() + expiresIn * 1000).toISOString(),
                size:         null,             // confirmed by client on complete
            },
            video_id:   jobId,
            clean_name: cleanName,
            r2_key:     r2Key,
            uri:        `/api/videos/${jobId}`,
            // Convenience: direct link to poll job status
            status_uri: `/api/videos/${jobId}`,
        };
    }
}

// ─── StatisticsDTO ────────────────────────────────────────────────────────────

/**
 * StatisticsDTO — dashboard statistics response.
 * When r2Real is provided, storage fields are from R2 S3 API (source of truth); sync_error marks D1/R2 mismatch.
 */
export class StatisticsDTO {
    /**
     * @param {Object} summary    - From JobRepository.getStatistics()
     * @param {Array}  activity   - From JobRepository.getRecentActivity()
     * @param {Array}  uploaders - From JobRepository.getTopUploaders()
     * @param {Object} [r2Real]   - From R2RealStatsService: { raw_usage_mb, public_usage_mb, total_real_r2, sync_error }
     */
    static build(summary, activity = [], uploaders = [], r2Real = null) {
        const total = summary.total_jobs || 0;
        const pct   = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
        const rawBytes  = summary.total_input_size  ?? 0;
        const pubBytes  = summary.total_output_size ?? 0;
        const useR2 = r2Real && (r2Real.raw_usage_mb != null || r2Real.public_usage_mb != null);
        const rawBytesFinal  = useR2 ? (r2Real.raw_usage_mb ?? 0) * 1024 * 1024 : rawBytes;
        const pubBytesFinal  = useR2 ? (r2Real.public_usage_mb ?? 0) * 1024 * 1024 : pubBytes;

        const out = {
            summary: {
                total_videos:          total,
                completed:             summary.completed_jobs        || 0,
                processing:            summary.processing_jobs       || 0,
                failed:                summary.failed_jobs           || 0,
                pending:               summary.pending_jobs          || 0,
                uploaded:              (summary.pending_uploaded_jobs ?? summary.pending_jobs ?? 0) + (summary.url_import_queued_jobs || 0),
                total_savings_bytes:   summary.total_savings_bytes   ?? 0,
                total_storage_bytes:   rawBytesFinal + pubBytesFinal,
                raw_storage_bytes:     rawBytesFinal,
                public_storage_bytes:  pubBytesFinal,
                avg_processing_time:   Math.round(summary.avg_processing_time || 0),
                unique_uploaders:      uploaders.length,
                preset_720p:           summary.quality_720p_count  || 0,
                preset_1080p:          summary.quality_1080p_count || 0,
                completion_rate:       pct(summary.completed_jobs),
                error_rate:            pct(summary.failed_jobs),
                last_week_total:       activity.slice(0, 7).reduce((s, d) => s + (d.total_jobs || 0), 0),
            },
            recent_activity: (activity || []).map(d => ({
                date:      d.date,
                uploads:   d.total_jobs  || 0,
                completed: d.completed   || 0,
                failed:    d.failed      || 0,
            })),
            top_uploaders: (uploaders || []).map(u => ({
                uploaded_by:  u.uploaded_by,
                upload_count: u.job_count,
                total_size:   u.total_size_input || 0,
            })),
        };
        if (r2Real) {
            out.raw_usage_mb = r2Real.raw_usage_mb ?? 0;
            out.public_usage_mb = r2Real.public_usage_mb ?? 0;
            out.total_real_r2 = r2Real.total_real_r2 ?? 0;
            out.sync_error = !!r2Real.sync_error;
        }
        return out;
    }
}
