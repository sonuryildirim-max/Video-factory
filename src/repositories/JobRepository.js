/**
 * Job Repository for BK-VF (Bilge Karga Video Factory)
 * Handles all conversion_jobs database operations
 * SQL safety: all user input is passed via .bind(); ORDER BY uses whitelist-only helpers.
 */

import { NotFoundError, ValidationError, AppError, BK_ERROR_CODES } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { JOB_STATUS, PROCESSING_STATUSES } from '../config/BK_CONSTANTS.js';

/** Whitelist for getJobs sort column (identifier only; values are bound). */
const VALID_SORT_COLUMNS_JOBS = ['created_at', 'started_at', 'completed_at', 'file_size_input', 'processing_time_seconds', 'duration', 'quality', 'view_count'];
/** Whitelist for getDeletedJobs sort column. */
const VALID_SORT_COLUMNS_DELETED = ['deleted_at', 'created_at', 'id'];

const CURSOR_SEP = '|';

function encodeCursor(sortKey, id) {
    return `${String(sortKey)}${CURSOR_SEP}${id}`;
}

function parseCursor(cursor, sortKeyName) {
    if (!cursor || typeof cursor !== 'string') return null;
    const idx = cursor.lastIndexOf(CURSOR_SEP);
    if (idx === -1) {
        const id = parseInt(cursor, 10);
        return isNaN(id) ? null : { sortKey: null, id };
    }
    const sortKey = cursor.slice(0, idx);
    const id = parseInt(cursor.slice(idx + 1), 10);
    if (isNaN(id)) return null;
    return { sortKey, id };
}

/**
 * Validate sort column and order for ORDER BY. Returns whitelist-safe strings only (no user input in SQL).
 * SQLite does not support bound identifiers; column/order must be interpolated from this whitelist.
 */
function validateOrderBy(validColumns, defaultColumn, sortBy, sortOrder) {
    const sortColumn = validColumns.includes(sortBy) ? sortBy : defaultColumn;
    const order = (String(sortOrder).toUpperCase() === 'ASC') ? 'ASC' : 'DESC';
    return { sortColumn, order };
}

/**
 * Sanitize FTS5 search query to prevent query syntax injection. Escapes double-quote and limits length.
 * Result is safe to pass as bound parameter to conversion_jobs_fts MATCH ?.
 */
function sanitizeFTSQuery(query) {
    if (query == null || typeof query !== 'string') return '';
    let s = String(query).trim().slice(0, 512);
    s = s.replace(/"/g, '""');
    return s;
}

/**
 * Run multiple statements in a single atomic transaction (BEGIN ... COMMIT).
 * On failure, ROLLBACK is executed and the error is rethrown.
 * D1: uses batch() with BEGIN/COMMIT; rollback on error.
 * @param {D1Database} db - D1 database binding
 * @param {Array<D1PreparedStatement>} statements - Prepared statements (with bind already applied)
 * @returns {Promise<D1Result[]>} Results for each statement (excluding BEGIN/COMMIT)
 */
async function runInTransaction(db, statements) {
    const withBoundaries = [
        db.prepare('BEGIN'),
        ...statements,
        db.prepare('COMMIT')
    ];
    try {
        const results = await db.batch(withBoundaries);
        return results;
    } catch (e) {
        try {
            await db.batch([db.prepare('ROLLBACK')]);
        } catch (_) { /* ignore rollback failure */ }
        throw e;
    }
}

export class JobRepository {
    constructor(env) {
        this.env = env;
        this.db = env.DB;
    }

    /**
     * Create a new conversion job
     * @param {Object} jobData - Job data (r2_raw_key can be 'url-import-pending' for URL import)
     * @returns {Promise<Object>} Created job
     */
    async create(jobData) {
        const {
            original_name,
            clean_name,
            r2_raw_key,
            quality,
            file_size_input,
            processing_profile,
            uploaded_by,
            created_by,
            tags,
            project_name,
            notes,
            source_url,
            folder_id,
            status = JOB_STATUS.PENDING,
        } = jobData;

        const uploader = uploaded_by || 'admin';
        const creator = created_by ?? uploader;

        const result = await this.db.prepare(`
            INSERT INTO conversion_jobs (
                original_name, clean_name, r2_raw_key, quality, 
                file_size_input, processing_profile, uploaded_by, created_by, tags, project_name, notes,
                source_url, folder_id, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            original_name,
            clean_name,
            r2_raw_key || 'url-import-pending',
            quality,
            file_size_input || 0,
            processing_profile || 'crf_14',
            uploader,
            creator,
            tags || '',
            project_name || '',
            notes || '',
            source_url || null,
            folder_id || null,
            status,
        ).run();

        const jobId = result.meta.last_row_id;
        try {
            await this.updateFTSIndex(jobId);
        } catch (ftsErr) {
            try {
                await this.db.prepare('DELETE FROM conversion_jobs WHERE id = ?').bind(jobId).run();
            } catch (rollbackErr) {
                /* best-effort rollback */
            }
            throw new AppError(`Job created but FTS index failed; job ${jobId} rolled back: ${ftsErr?.message || ftsErr}`, 500, 'FTS_INDEX_FAILED');
        }
        return this.getById(jobId);
    }

    /**
     * Update job status (state machine: DOWNLOADING, CONVERTING, UPLOADING).
     * @param {number} jobId - Job ID
     * @param {string} workerId - Worker identifier
     * @param {string} status - DOWNLOADING | CONVERTING | UPLOADING
     * @param {Object} [extras] - download_progress, download_bytes, download_total
     * @returns {Promise<Object|null>} Updated job or null
     */
    async updateJobStatus(jobId, workerId, status, extras = {}) {
        const valid = [JOB_STATUS.DOWNLOADING, JOB_STATUS.CONVERTING, JOB_STATUS.UPLOADING];
        if (!valid.includes(status)) return null;
        const { download_progress, download_bytes, download_total } = extras;
        const hasExtras = download_progress != null || download_bytes != null || download_total != null;
        let sql = 'UPDATE conversion_jobs SET status = ?';
        const binds = [status];
        if (hasExtras && download_progress != null) {
            sql += ', download_progress = ?';
            binds.push(download_progress);
        }
        if (hasExtras && download_bytes != null) {
            sql += ', download_bytes = ?';
            binds.push(download_bytes);
        }
        if (hasExtras && download_total != null) {
            sql += ', download_total = ?';
            binds.push(download_total);
        }
        sql += ' WHERE id = ? AND worker_id = ? RETURNING *';
        binds.push(jobId, workerId);
        const result = await this.db.prepare(sql).bind(...binds).first();
        return result || null;
    }

    /**
     * Claim a pending job (atomic operation)
     * Claims PENDING or URL_IMPORT_QUEUED jobs (excludes DELETED).
     * @param {string} workerId - Worker identifier
     * @returns {Promise<Object|null>} Claimed job or null if no jobs available
     */
    async claimPendingJob(workerId) {
        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET 
                status = ?,
                worker_id = ?,
                started_at = CURRENT_TIMESTAMP,
                retry_count = 0
            WHERE id = (
                SELECT id FROM conversion_jobs
                WHERE ((status = ?) OR (status = ? AND upload_confirmed_at IS NOT NULL))
                  AND deleted_at IS NULL
                ORDER BY id ASC
                LIMIT 1
            )
            RETURNING *
        `).bind(JOB_STATUS.PROCESSING, workerId, JOB_STATUS.URL_IMPORT_QUEUED, JOB_STATUS.PENDING).first();

        return result || null;
    }

    /**
     * Update job after agent has uploaded URL-import file to R2 raw.
     * @param {number} jobId - Job ID
     * @param {string} workerId - Worker identifier
     * @param {string} r2RawKey - R2 raw bucket key
     * @param {number} fileSizeInput - File size in bytes
     * @returns {Promise<Object>} Updated job
     */
    async updateJobRawKeyAfterUrlImport(jobId, workerId, r2RawKey, fileSizeInput) {
        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET r2_raw_key = ?, file_size_input = ?
            WHERE id = ? AND worker_id = ?
            RETURNING *
        `).bind(r2RawKey, fileSizeInput, jobId, workerId).first();

        if (!result) {
            throw new NotFoundError('Job', `${jobId} (or not owned by worker ${workerId})`);
        }
        return result;
    }

    /**
     * Complete a job
     * @param {number} jobId - Job ID
     * @param {string} workerId - Worker identifier
     * @param {Object} resultData - Processing result data
     * @returns {Promise<Object>} Updated job
     */
    async completeJob(jobId, workerId, resultData) {
        const {
            public_url,
            file_size_output,
            duration,
            processing_time_seconds,
            resolution,
            bitrate,
            codec,
            frame_rate,
            audio_codec,
            audio_bitrate,
            ffmpeg_command,
            ffmpeg_output,
            thumbnail_key,
            clean_name,
        } = resultData;

        const finalCleanName = clean_name || null;

        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET
                status = ?,
                public_url = ?,
                file_size_output = ?,
                duration = ?,
                processing_time_seconds = ?,
                resolution = ?,
                bitrate = ?,
                codec = ?,
                frame_rate = ?,
                audio_codec = ?,
                audio_bitrate = ?,
                ffmpeg_command = ?,
                ffmpeg_output = ?,
                thumbnail_key = ?,
                clean_name = COALESCE(?, clean_name),
                completed_at = CURRENT_TIMESTAMP
            WHERE id = ? AND worker_id = ?
            RETURNING *
        `        ).bind(
            JOB_STATUS.COMPLETED,
            public_url,
            file_size_output || 0,
            duration || 0,
            processing_time_seconds || 0,
            resolution || '',
            bitrate || 0,
            codec || 'h264',
            frame_rate || 30,
            audio_codec || 'aac',
            audio_bitrate || 128,
            ffmpeg_command || '',
            ffmpeg_output || '',
            thumbnail_key || null,
            finalCleanName,
            jobId,
            workerId
        ).first();

        if (!result) {
            throw new NotFoundError('Job', `${jobId} (or not owned by worker ${workerId})`);
        }

        return result;
    }

    /**
     * Fail a job
     * @param {number} jobId - Job ID
     * @param {string} workerId - Worker identifier
     * @param {Object} failData - Failure data
     * @returns {Promise<Object>} Updated job
     */
    async failJob(jobId, workerId, failData) {
        const {
            error_message,
            retry_count,
            status
        } = failData;

        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET 
                status = ?,
                error_message = ?,
                retry_count = ?,
                completed_at = CURRENT_TIMESTAMP
            WHERE id = ? AND worker_id = ?
            RETURNING *
        `).bind(
            status,
            error_message,
            retry_count || 0,
            jobId,
            workerId
        ).first();

        if (!result) {
            throw new NotFoundError('Job', `${jobId} (or not owned by worker ${workerId})`);
        }

        return result;
    }

    /**
     * Soft delete a job (set status=DELETED, deleted_at=CURRENT_TIMESTAMP).
     * @param {number} jobId - Job ID
     * @returns {Promise<Object|null>} Updated job or null
     */
    async softDeleteJob(jobId) {
        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET status = ?, deleted_at = CURRENT_TIMESTAMP, is_deleted = 1
            WHERE id = ?
            RETURNING *
        `).bind(JOB_STATUS.DELETED, jobId).first();
        return result || null;
    }

    /**
     * Mark job as DELETING (Saga: before R2 move). Returns job row as it was before update for rollback.
     * @param {number} jobId - Job ID
     * @returns {Promise<Object|null>} Job row before update (with original status) or null
     */
    async markJobDeleting(jobId) {
        const job = await this.getById(jobId);
        if (!job) return null;
        await this.db.prepare(`
            UPDATE conversion_jobs SET status = ? WHERE id = ?
        `).bind(JOB_STATUS.DELETING, jobId).run();
        return job;
    }

    /**
     * Rollback from DELETING to original status (Saga: when R2 move fails).
     * @param {number} jobId - Job ID
     * @param {string} originalStatus - Status to restore
     */
    async rollbackJobDeleting(jobId, originalStatus) {
        await this.db.prepare(`
            UPDATE conversion_jobs SET status = ?, deleted_at = NULL, is_deleted = 0 WHERE id = ?
        `).bind(originalStatus, jobId).run();
    }

    /**
     * Set upload_confirmed_at when /complete is called (file in R2, waiting for agent)
     * @param {number|string} jobId - Job ID
     * @returns {Promise<Object|null>} Updated job or null
     */
    async setUploadConfirmed(jobId) {
        const id = typeof jobId === 'string' ? parseInt(jobId, 10) : jobId;
        if (isNaN(id)) return null;
        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET upload_confirmed_at = datetime('now')
            WHERE id = ? AND status = ?
            RETURNING *
        `).bind(id, JOB_STATUS.PENDING).first();
        return result || null;
    }

    /**
     * Update job file_size_input from R2 HEAD (validation engine)
     * @param {number|string} jobId - Job ID
     * @param {number} fileSizeBytes - Actual size from R2
     * @returns {Promise<Object|null>} Updated job or null
     */
    async updateJobFileSizeInput(jobId, fileSizeBytes) {
        const id = typeof jobId === 'string' ? parseInt(jobId, 10) : jobId;
        if (isNaN(id)) return null;
        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET file_size_input = ?
            WHERE id = ?
            RETURNING *
        `).bind(fileSizeBytes, id).first();
        return result || null;
    }

    /**
     * Cancel an orphan PENDING job (upload never completed)
     * @param {number|string} jobId - Job ID
     * @returns {Promise<Object|null>} Updated job or null
     */
    async cancelOrphanJob(jobId) {
        const id = typeof jobId === 'string' ? parseInt(jobId, 10) : jobId;
        if (isNaN(id)) return null;
        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET status = ?, error_message = 'Upload failed; job cancelled', completed_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = ?
            RETURNING *
        `).bind(JOB_STATUS.FAILED, id, JOB_STATUS.PENDING).first();
        return result || null;
    }

    /**
     * Fail a job by ID only (for timeout cleanup; worker_id may be null)
     * @param {number} jobId - Job ID
     * @param {Object} failData - Failure data
     * @returns {Promise<Object|null>} Updated job or null if not found/not PROCESSING
     */
    async failJobByIdOnly(jobId, failData) {
        const {
            error_message,
            retry_count,
            status
        } = failData;

        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET 
                status = ?,
                error_message = ?,
                retry_count = ?,
                completed_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = ?
            RETURNING *
        `).bind(
            status,
            error_message,
            retry_count || 0,
            jobId,
            JOB_STATUS.PROCESSING
        ).first();

        return result || null;
    }

    /**
     * Mark a job as Interrupted (graceful shutdown: RAM/SIGTERM). Clears worker_id for recovery.
     * @param {number} jobId - Job ID
     * @param {string} workerId - Worker that owned the job
     * @param {string} [stage] - Optional stage (e.g. 'download', 'convert', 'upload')
     * @returns {Promise<Object|null>} Updated job or null
     */
    async setJobInterrupted(jobId, workerId, stage = '') {
        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET status = ?,
                error_message = 'Interrupted (graceful shutdown)',
                interrupted_at = datetime('now'),
                interrupted_stage = ?,
                worker_id = NULL,
                completed_at = NULL,
                processing_checkpoint = NULL,
                checkpoint_updated_at = NULL
            WHERE id = ? AND worker_id = ?
            RETURNING *
        `).bind(JOB_STATUS.INTERRUPTED, stage || null, jobId, workerId).first();
        return result || null;
    }

    /**
     * Update processing checkpoint (for resume-after-interrupt).
     * Values: 'download_done' | 'converting' | 'upload_done'
     * @param {number} jobId
     * @param {string} workerId
     * @param {string} checkpoint
     * @returns {Promise<Object|null>}
     */
    async updateJobCheckpoint(jobId, workerId, checkpoint) {
        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET processing_checkpoint = ?,
                checkpoint_updated_at = datetime('now')
            WHERE id = ? AND worker_id = ?
            RETURNING *
        `).bind(checkpoint || null, jobId, workerId).first();
        return result || null;
    }

    /**
     * Get jobs with status INTERRUPTED (for recovery). worker_id is cleared when interrupted.
     * @param {Object} [filters] - { limit? }
     * @returns {Promise<Array>} Interrupted jobs
     */
    async getInterruptedJobs(filters = {}) {
        const { limit = 100 } = filters;
        const result = await this.db.prepare(`
            SELECT * FROM conversion_jobs
            WHERE status = ? AND deleted_at IS NULL
            ORDER BY interrupted_at DESC
            LIMIT ?
        `).bind(JOB_STATUS.INTERRUPTED, limit).all();
        return result?.results ?? [];
    }

    /**
     * Set Interrupted jobs back to PENDING for retry (clear worker_id, error_message).
     * @param {number[]} jobIds - Job IDs to retry
     * @returns {Promise<number>} Count updated
     */
    async retryInterruptedJobIds(jobIds) {
        if (!jobIds?.length) return 0;
        const ids = jobIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
        if (!ids.length) return 0;
        const placeholders = ids.map(() => '?').join(',');
        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET status = ?,
                worker_id = NULL,
                error_message = NULL,
                interrupted_at = NULL,
                interrupted_stage = NULL,
                started_at = NULL,
                completed_at = NULL,
                processing_checkpoint = NULL,
                checkpoint_updated_at = NULL
            WHERE id IN (${placeholders}) AND status = ?
        `).bind(JOB_STATUS.PENDING, ...ids, JOB_STATUS.INTERRUPTED).run();
        return result?.meta?.changes ?? 0;
    }

    /**
     * Get job by ID
     * @param {number} jobId - Job ID
     * @returns {Promise<Object|null>} Job or null if not found
     */
    async getById(jobId) {
        return await this.db.prepare(`
            SELECT * FROM conversion_jobs
            WHERE id = ?
        `).bind(jobId).first();
    }

    /**
     * Get multiple jobs by IDs (single query).
     * @param {number[]} ids - Job IDs
     * @returns {Promise<Array>} Jobs (order not guaranteed)
     */
    async getByIds(ids) {
        if (!ids?.length) return [];
        const nums = ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
        if (!nums.length) return [];
        const placeholders = nums.map(() => '?').join(',');
        const stmt = this.db.prepare(`SELECT * FROM conversion_jobs WHERE id IN (${placeholders})`);
        const result = await stmt.bind(...nums).all();
        return result?.results ?? [];
    }

    /**
     * Get jobs with filters. Supports cursor-based pagination (cursor) or offset-based (page).
     * When cursor is provided, returns next_cursor for the next page; otherwise page/totalPages.
     * @param {Object} filters - Filter criteria; cursor = opaque "sortKey:id" or page/limit
     * @returns {Promise<Object>} { jobs, totalCount, page, totalPages, limit, next_cursor }
     */
    async getJobs(filters = {}) {
        const {
            status,
            bucket,
            quality,
            folder_id,
            uploaded_by,
            search,
            start_date,
            end_date,
            page = 1,
            limit = 50,
            sort_by = 'created_at',
            sort_order = 'DESC',
            include_deleted = false,
            cursor
        } = filters;

        const whereClauses = [];
        const params = [];

        if (bucket === 'public') {
            whereClauses.push('(deleted_at IS NULL AND status = \'COMPLETED\')');
        } else if (bucket === 'raw') {
            whereClauses.push('(deleted_at IS NULL AND status != \'DELETED\' AND status != \'COMPLETED\')');
        } else if (!include_deleted) {
            whereClauses.push('(deleted_at IS NULL AND status != \'DELETED\')');
        }

        if (status && bucket !== 'public' && bucket !== 'raw') {
            whereClauses.push('status = ?');
            params.push(status);
        }

        if (quality) {
            whereClauses.push('quality = ?');
            params.push(quality);
        }

        if (uploaded_by) {
            whereClauses.push('uploaded_by = ?');
            params.push(uploaded_by);
        }

        if (folder_id != null && folder_id > 0) {
            whereClauses.push('folder_id = ?');
            params.push(folder_id);
        }

        if (search) {
            whereClauses.push('(original_name LIKE ? OR clean_name LIKE ? OR tags LIKE ? OR project_name LIKE ? OR notes LIKE ?)');
            const searchLike = `%${search}%`;
            params.push(searchLike, searchLike, searchLike, searchLike, searchLike);
        }

        if (start_date) {
            whereClauses.push('created_at >= ?');
            params.push(start_date + 'T00:00:00');
        }

        if (end_date) {
            whereClauses.push('created_at <= ?');
            params.push(end_date + 'T23:59:59.999Z');
        }

        const { sortColumn, order: sortOrder } = validateOrderBy(VALID_SORT_COLUMNS_JOBS, 'created_at', sort_by, sort_order);
        const useCursor = cursor && String(cursor).trim();
        const cursorSortKey = sortColumn === 'created_at' ? 'created_at' : sortColumn;

        if (useCursor) {
            const parsed = parseCursor(cursor);
            if (parsed && parsed.id != null) {
                if (parsed.sortKey != null && (cursorSortKey === 'created_at' || cursorSortKey === 'deleted_at' || cursorSortKey === 'started_at' || cursorSortKey === 'completed_at')) {
                    whereClauses.push(`(${cursorSortKey} < ? OR (${cursorSortKey} = ? AND id < ?))`);
                    params.push(parsed.sortKey, parsed.sortKey, parsed.id);
                } else {
                    whereClauses.push('id < ?');
                    params.push(parsed.id);
                }
            }
        }

        const whereSQL = whereClauses.length > 0 ? ' WHERE ' + whereClauses.join(' AND ') : '';

        const countResult = await this.db.prepare(`
            SELECT COUNT(*) as total FROM conversion_jobs${whereSQL}
        `).bind(...params).first();

        const totalCount = countResult.total || 0;
        const totalPages = Math.ceil(totalCount / limit) || 1;
        const fetchLimit = useCursor ? limit + 1 : limit;
        const offset = useCursor ? 0 : (page - 1) * limit;

        const orderById = cursorSortKey !== 'id' ? `, id ${sortOrder}` : '';
        const dataResult = await this.db.prepare(`
            SELECT * FROM conversion_jobs${whereSQL}
            ORDER BY ${sortColumn} ${sortOrder}${orderById}
            LIMIT ? OFFSET ?
        `).bind(...params, fetchLimit, offset).all();

        const rows = dataResult.results || [];
        let jobs = rows;
        let next_cursor = null;
        if (useCursor && rows.length > limit) {
            jobs = rows.slice(0, limit);
            const last = rows[limit - 1];
            const key = last[cursorSortKey] ?? last.created_at;
            next_cursor = encodeCursor(key, last.id);
        }

        return {
            jobs,
            totalCount,
            page: useCursor ? null : page,
            totalPages: useCursor ? null : totalPages,
            limit,
            next_cursor
        };
    }

    /**
     * Get soft-deleted jobs (Son Silinenler — root only). Supports cursor or page.
     * @param {Object} filters - { page, limit, sort_by, sort_order, cursor }
     * @returns {Promise<Object>} { jobs, totalCount, page, totalPages, limit, next_cursor }
     */
    async getDeletedJobs(filters = {}) {
        const { page = 1, limit = 50, sort_by = 'deleted_at', sort_order = 'DESC', cursor } = filters;
        const { sortColumn, order } = validateOrderBy(VALID_SORT_COLUMNS_DELETED, 'deleted_at', sort_by, sort_order);
        const useCursor = cursor && String(cursor).trim();
        const whereBase = 'WHERE deleted_at IS NOT NULL AND status = \'DELETED\'';
        const params = [];
        let whereCursor = '';
        if (useCursor) {
            const parsed = parseCursor(cursor);
            if (parsed && parsed.id != null) {
                if (parsed.sortKey != null && (sortColumn === 'deleted_at' || sortColumn === 'created_at')) {
                    whereCursor = ` AND (${sortColumn} < ? OR (${sortColumn} = ? AND id < ?))`;
                    params.push(parsed.sortKey, parsed.sortKey, parsed.id);
                } else {
                    whereCursor = ' AND id < ?';
                    params.push(parsed.id);
                }
            }
        }
        const countResult = await this.db.prepare(`
            SELECT COUNT(*) as total FROM conversion_jobs ${whereBase}
        `).first();
        const totalCount = countResult.total || 0;
        const totalPages = Math.ceil(totalCount / limit) || 1;
        const fetchLimit = useCursor ? limit + 1 : limit;
        const offset = useCursor ? 0 : (page - 1) * limit;
        const orderById = sortColumn !== 'id' ? `, id ${order}` : '';
        const dataResult = await this.db.prepare(`
            SELECT * FROM conversion_jobs ${whereBase}${whereCursor}
            ORDER BY ${sortColumn} ${order}${orderById}
            LIMIT ? OFFSET ?
        `).bind(...params, fetchLimit, offset).all();
        const rows = dataResult.results || [];
        let jobs = rows;
        let next_cursor = null;
        if (useCursor && rows.length > limit) {
            jobs = rows.slice(0, limit);
            const last = rows[limit - 1];
            const key = last[sortColumn] ?? last.deleted_at;
            next_cursor = encodeCursor(key, last.id);
        }
        return {
            jobs,
            totalCount,
            page: useCursor ? null : page,
            totalPages: useCursor ? null : totalPages,
            limit,
            next_cursor
        };
    }

    /**
     * Increment view count for a video (hit analytics).
     * @param {number} jobId
     * @returns {Promise<boolean>}
     */
    async incrementViewCount(jobId) {
        if (!jobId || isNaN(parseInt(jobId, 10))) return false;
        try {
            await this.db.prepare(`
                UPDATE conversion_jobs SET view_count = COALESCE(view_count, 0) + 1
                WHERE id = ? AND status = ? AND deleted_at IS NULL
            `).bind(parseInt(jobId, 10), JOB_STATUS.COMPLETED).run();
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get top viewed videos (for En Çok İzlenenler widget).
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async getTopViewed(limit = 5) {
        const rows = await this.db.prepare(`
            SELECT * FROM conversion_jobs
            WHERE status = ? AND deleted_at IS NULL
            ORDER BY COALESCE(view_count, 0) DESC, created_at DESC
            LIMIT ?
        `).bind(JOB_STATUS.COMPLETED, limit).all();
        return rows?.results || [];
    }

    /**
     * Restore a soft-deleted job (clear deleted_at, set status=COMPLETED).
     * @param {number} jobId
     * @returns {Promise<Object|null>}
     */
    async restoreJob(jobId) {
        const result = await this.db.prepare(`
            UPDATE conversion_jobs
            SET status = ?, deleted_at = NULL, is_deleted = 0
            WHERE id = ? AND deleted_at IS NOT NULL AND status = ?
            RETURNING *
        `).bind(JOB_STATUS.COMPLETED, jobId, JOB_STATUS.DELETED).first();
        return result || null;
    }

    /**
     * Hard delete a job (permanent purge from DB). Only for already soft-deleted jobs.
     * Atomic transaction: job_logs → upload_tokens → conversion_jobs_fts → conversion_jobs.
     * @param {number} jobId
     * @returns {Promise<boolean>}
     */
    async hardDeleteJob(jobId) {
        const id = parseInt(jobId, 10);
        if (isNaN(id)) return false;
        const statementsWithFts = [
            this.db.prepare('DELETE FROM job_logs WHERE job_id = ?').bind(id),
            this.db.prepare('DELETE FROM upload_tokens WHERE job_id = ?').bind(id),
            this.db.prepare('DELETE FROM conversion_jobs_fts WHERE rowid = ?').bind(id),
            this.db.prepare('DELETE FROM conversion_jobs WHERE id = ? AND deleted_at IS NOT NULL').bind(id)
        ];
        const statementsNoFts = [
            this.db.prepare('DELETE FROM job_logs WHERE job_id = ?').bind(id),
            this.db.prepare('DELETE FROM upload_tokens WHERE job_id = ?').bind(id),
            this.db.prepare('DELETE FROM conversion_jobs WHERE id = ? AND deleted_at IS NOT NULL').bind(id)
        ];
        try {
            const results = await runInTransaction(this.db, statementsWithFts);
            const lastResult = results[results.length - 2];
            return (lastResult?.meta?.changes || 0) > 0;
        } catch (e) {
            const msg = e?.message || String(e);
            if (msg.includes('conversion_jobs_fts') || msg.includes('no such table')) {
                try {
                    const results = await runInTransaction(this.db, statementsNoFts);
                    const lastResult = results[results.length - 2];
                    return (lastResult?.meta?.changes || 0) > 0;
                } catch (e2) {
                    throw new AppError(`D1 hard delete failed (job ${id}): ${e2?.message || e2}`, 500, 'D1_DELETE_FAILED');
                }
            }
            throw new AppError(`D1 hard delete failed (job ${id}): ${msg}`, 500, 'D1_DELETE_FAILED');
        }
    }

    /**
     * Force hard delete a job (idam). Unconditional DELETE from DB regardless of deleted_at.
     * Use after R2 objects have been removed.
     * Atomic: uses db.batch([]) via runInTransaction (BEGIN + child/parent DELETEs + COMMIT).
     * @param {number} jobId
     * @returns {Promise<boolean>}
     */
    async forceHardDeleteJob(jobId) {
        const job = await this.getById(jobId);
        if (!job) {
            logger.warn('forceHardDeleteJob: record not found, skipping', { jobId });
            return true;
        }
        const id = parseInt(jobId, 10);
        if (isNaN(id)) return false;
        const statementsWithFts = [
            this.db.prepare('DELETE FROM job_logs WHERE job_id = ?').bind(id),
            this.db.prepare('DELETE FROM upload_tokens WHERE job_id = ?').bind(id),
            this.db.prepare('DELETE FROM conversion_jobs_fts WHERE rowid = ?').bind(id),
            this.db.prepare('DELETE FROM conversion_jobs WHERE id = ?').bind(id)
        ];
        const statementsNoFts = [
            this.db.prepare('DELETE FROM job_logs WHERE job_id = ?').bind(id),
            this.db.prepare('DELETE FROM upload_tokens WHERE job_id = ?').bind(id),
            this.db.prepare('DELETE FROM conversion_jobs WHERE id = ?').bind(id)
        ];
        try {
            await runInTransaction(this.db, statementsWithFts);
            return true;
        } catch (e) {
            const msg = e?.message || String(e);
            if (msg.includes('conversion_jobs_fts') || msg.includes('no such table')) {
                try {
                    await runInTransaction(this.db, statementsNoFts);
                    return true;
                } catch (e2) {
                    throw new AppError(`D1 force delete failed (job ${id}): ${e2?.message || e2}`, 500, 'D1_DELETE_FAILED');
                }
            }
            throw new AppError(`D1 force delete failed (job ${id}): ${msg}`, 500, 'D1_DELETE_FAILED');
        }
    }

    /**
     * Force hard delete multiple jobs. Atomic: db.batch via runInTransaction.
     * Order: job_logs, upload_tokens, conversion_jobs_fts (if present), conversion_jobs.
     * @param {number[]} ids - Job IDs
     * @returns {Promise<boolean>}
     */
    async forceHardDeleteJobByIds(ids) {
        if (!ids?.length) return true;
        const nums = ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
        if (!nums.length) return true;
        const placeholders = nums.map(() => '?').join(',');
        const statementsNoFts = [
            this.db.prepare(`DELETE FROM job_logs WHERE job_id IN (${placeholders})`).bind(...nums),
            this.db.prepare(`DELETE FROM upload_tokens WHERE job_id IN (${placeholders})`).bind(...nums),
            this.db.prepare(`DELETE FROM conversion_jobs WHERE id IN (${placeholders})`).bind(...nums)
        ];
        const statementsWithFts = [
            ...statementsNoFts.slice(0, 2),
            this.db.prepare(`DELETE FROM conversion_jobs_fts WHERE rowid IN (${placeholders})`).bind(...nums),
            statementsNoFts[2]
        ];
        try {
            await runInTransaction(this.db, statementsWithFts);
            return true;
        } catch (e) {
            const msg = e?.message || String(e);
            if (msg.includes('conversion_jobs_fts') || msg.includes('no such table')) {
                await runInTransaction(this.db, statementsNoFts);
                return true;
            }
            throw new AppError(`D1 force delete batch failed: ${msg}`, 500, 'D1_DELETE_FAILED');
        }
    }

    /**
     * Soft delete multiple jobs in one UPDATE. Skips PROCESSING/DOWNLOADING/CONVERTING/UPLOADING.
     * @param {number[]} jobIds
     * @returns {Promise<{ updatedIds: number[], skippedIds: number[] }>}
     */
    async softDeleteJobsByIds(jobIds) {
        if (!jobIds?.length) return { updatedIds: [], skippedIds: [] };
        const ids = jobIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
        const jobs = await this.getByIds(ids);
        const toUpdate = [];
        const skippedIds = [];
        const foundIds = new Set((jobs || []).map(j => j.id));
        for (const id of ids) {
            if (!foundIds.has(id)) continue;
            const job = jobs.find(j => j.id === id);
            if (!job || PROCESSING_STATUSES.includes(job.status)) {
                skippedIds.push(id);
            } else {
                toUpdate.push(id);
            }
        }
        if (toUpdate.length === 0) return { updatedIds: [], skippedIds };
        const placeholders = toUpdate.map(() => '?').join(',');
        const notInPlaceholders = PROCESSING_STATUSES.map(() => '?').join(',');
        await this.db.prepare(`
            UPDATE conversion_jobs
            SET status = ?, deleted_at = CURRENT_TIMESTAMP, is_deleted = 1
            WHERE id IN (${placeholders}) AND status NOT IN (${notInPlaceholders})
        `).bind(JOB_STATUS.DELETED, ...toUpdate, ...PROCESSING_STATUSES).run();
        return { updatedIds: toUpdate, skippedIds };
    }

    /**
     * Soft delete multiple jobs. Skips PROCESSING jobs.
     * @param {number[]} jobIds
     * @returns {Promise<{ deleted: number, skipped: number[] }>}
     */
    async softDeleteJobs(jobIds) {
        const { updatedIds, skippedIds } = await this.softDeleteJobsByIds(jobIds);
        return { deleted: updatedIds.length, skipped: skippedIds };
    }

    /**
     * Restore multiple soft-deleted jobs.
     * @param {number[]} jobIds
     * @returns {Promise<number>} Restored count
     */
    async restoreJobs(jobIds) {
        if (!jobIds?.length) return 0;
        const ids = jobIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
        let count = 0;
        for (const id of ids) {
            const r = await this.restoreJob(id);
            if (r) count++;
        }
        return count;
    }

    /**
     * Hard delete multiple soft-deleted jobs.
     * @param {number[]} jobIds
     * @returns {Promise<number>} Purged count
     */
    async hardDeleteJobs(jobIds) {
        if (!jobIds?.length) return 0;
        const ids = jobIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
        let count = 0;
        for (const id of ids) {
            const ok = await this.hardDeleteJob(id);
            if (ok) count++;
        }
        return count;
    }

    /**
     * Get timed out jobs
     * @param {number} timeoutMinutes - Timeout in minutes
     * @returns {Promise<Array>} Timed out jobs
     */
    async getTimedOutJobs(timeoutMinutes) {
        return await this.db.prepare(`
            SELECT * FROM conversion_jobs
            WHERE status = ?
            AND started_at < datetime('now', '-' || ? || ' minutes')
        `).bind(JOB_STATUS.PROCESSING, timeoutMinutes).all();
    }

    /**
     * Get recent activity
     * @param {number} days - Number of days
     * @returns {Promise<Array>} Recent activity
     */
    async getRecentActivity(days = 7) {
        return await this.db.prepare(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as total_jobs,
                SUM(CASE WHEN status = '${JOB_STATUS.COMPLETED}' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = '${JOB_STATUS.FAILED}' THEN 1 ELSE 0 END) as failed
            FROM conversion_jobs
            WHERE created_at >= datetime('now', '-' || ? || ' days')
              AND deleted_at IS NULL AND status != '${JOB_STATUS.DELETED}'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `).bind(days).all();
    }

    /**
     * Get top uploaders
     * @param {number} limit - Limit
     * @returns {Promise<Array>} Top uploaders
     */
    async getTopUploaders(limit = 5) {
        return await this.db.prepare(`
            SELECT 
                uploaded_by,
                COUNT(*) as job_count,
                SUM(file_size_input) as total_size_input
            FROM conversion_jobs
            WHERE created_at >= datetime('now', '-30 days')
              AND deleted_at IS NULL AND status != '${JOB_STATUS.DELETED}'
            GROUP BY uploaded_by
            ORDER BY job_count DESC
            LIMIT ?
        `).bind(limit).all();
    }

    /**
     * Get daily statistics
     * @param {number} days - Number of days
     * @returns {Promise<Array>} Daily statistics
     */
    async getDailyStatistics(days = 30) {
        return await this.db.prepare(`
            SELECT 
                date,
                total_jobs,
                completed_jobs,
                failed_jobs,
                pending_jobs,
                total_input_size_bytes,
                total_output_size_bytes,
                avg_processing_time_seconds,
                quality_720p_count,
                quality_1080p_count,
                top_uploader
            FROM daily_statistics
            WHERE date >= date('now', '-' || ? || ' days')
            ORDER BY date DESC
        `).bind(days).all();
    }

    /**
     * Get general statistics
     * @returns {Promise<Object>} Statistics
     */
    async getStatistics() {
        const result = await this.db.prepare(`
            SELECT 
                COUNT(*) as total_jobs,
                SUM(CASE WHEN status = '${JOB_STATUS.COMPLETED}' THEN 1 ELSE 0 END) as completed_jobs,
                SUM(CASE WHEN status = '${JOB_STATUS.FAILED}' THEN 1 ELSE 0 END) as failed_jobs,
                SUM(CASE WHEN status = '${JOB_STATUS.PENDING}' THEN 1 ELSE 0 END) as pending_jobs,
                SUM(CASE WHEN status = '${JOB_STATUS.PENDING}' AND upload_confirmed_at IS NOT NULL THEN 1 ELSE 0 END) as pending_uploaded_jobs,
                SUM(CASE WHEN status = '${JOB_STATUS.URL_IMPORT_QUEUED}' THEN 1 ELSE 0 END) as url_import_queued_jobs,
                SUM(CASE WHEN status IN (${PROCESSING_STATUSES.map(s => `'${s}'`).join(',')}) THEN 1 ELSE 0 END) as processing_jobs,
                SUM(file_size_input) as total_input_size,
                SUM(file_size_output) as total_output_size,
                SUM(CASE WHEN status = '${JOB_STATUS.COMPLETED}' AND file_size_input > file_size_output THEN (file_size_input - file_size_output) ELSE 0 END) as total_savings_bytes,
                AVG(processing_time_seconds) as avg_processing_time,
                SUM(CASE WHEN quality = '720p' THEN 1 ELSE 0 END) as quality_720p_count,
                SUM(CASE WHEN quality = '1080p' THEN 1 ELSE 0 END) as quality_1080p_count
            FROM conversion_jobs
            WHERE deleted_at IS NULL AND status != '${JOB_STATUS.DELETED}'
        `).first();

        return result || {
            total_jobs: 0,
            completed_jobs: 0,
            failed_jobs: 0,
            pending_jobs: 0,
            pending_uploaded_jobs: 0,
            url_import_queued_jobs: 0,
            processing_jobs: 0,
            total_input_size: 0,
            total_output_size: 0,
            total_savings_bytes: 0,
            avg_processing_time: 0,
            quality_720p_count: 0,
            quality_1080p_count: 0
        };
    }

    /**
     * Update worker heartbeat
     * @param {string} workerId - Worker identifier
     * @param {Object} heartbeatData - Heartbeat data
     * @returns {Promise<Object>} Updated heartbeat
     */
    /**
     * Get latest heartbeats for all workers (one row per worker, most recent)
     * @returns {Promise<Array<{worker_id: string, last_heartbeat: string, status: string, current_job_id: number|null}>>}
     */
    async getWorkerHeartbeats() {
        const rows = await this.db.prepare(`
            SELECT wh.worker_id, wh.last_heartbeat, wh.status, wh.current_job_id
            FROM worker_heartbeats wh
            INNER JOIN (
                SELECT worker_id, MAX(id) as max_id
                FROM worker_heartbeats
                GROUP BY worker_id
            ) latest ON wh.worker_id = latest.worker_id AND wh.id = latest.max_id
            ORDER BY wh.last_heartbeat DESC
        `).all();
        return rows.results || [];
    }

    async updateWorkerHeartbeat(workerId, heartbeatData) {
        const {
            status,
            current_job_id,
            ip_address,
            version
        } = heartbeatData;

        const result = await this.db.prepare(`
            INSERT INTO worker_heartbeats 
            (worker_id, last_heartbeat, status, current_job_id, ip_address, version)
            VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
        `).bind(
            workerId,
            status || 'ACTIVE',
            current_job_id || null,
            ip_address || '',
            version || '1.0.0'
        ).run();

        return result;
    }

    /**
     * Record worker activity (claim, complete, status update).
     * Activity = heartbeat: son görülme bu timestamp'e göre hesaplanır.
     */
    async updateWorkerActivity(workerId, currentJobId = null, status = 'ACTIVE') {
        if (!workerId) return;
        try {
            await this.db.prepare(`
                INSERT INTO worker_heartbeats 
                (worker_id, last_heartbeat, status, current_job_id, ip_address, version)
                VALUES (?, CURRENT_TIMESTAMP, ?, ?, '', '2.0')
            `).bind(workerId, status, currentJobId || null).run();
        } catch (e) {
            logger.warn('updateWorkerActivity failed', { message: e?.message });
        }
    }

    /**
     * Search jobs using FTS5 full-text search
     * @param {string} query - Search query
     * @param {Object} filters - Additional filters
     * @returns {Promise<Array>} Search results
     */
    async searchWithFTS(query, filters = {}) {
        const { page = 1, limit = 50 } = filters;

        await this.createFTS5TableIfNeeded();

        const safeQuery = sanitizeFTSQuery(query);

        const ftsResults = await this.db.prepare(`
            SELECT rowid, rank
            FROM conversion_jobs_fts
            WHERE conversion_jobs_fts MATCH ?
            ORDER BY rank
            LIMIT ? OFFSET ?
        `).bind(safeQuery, limit, (page - 1) * limit).all();

        if (!ftsResults.results || ftsResults.results.length === 0) {
            return {
                jobs: [],
                totalCount: 0,
                page,
                totalPages: 0,
                limit
            };
        }

        // Get job IDs from FTS results (rowid = conversion_jobs.id via content_rowid)
        const jobIds = ftsResults.results.map(r => r.rowid);
        const placeholders = jobIds.map(() => '?').join(',');
        // SQLite-compatible ORDER BY (FIELD() is MySQL-only)
        const orderByCase = jobIds.map((_, i) => `WHEN ? THEN ${i}`).join(' ');

        const jobsResult = await this.db.prepare(`
            SELECT * FROM conversion_jobs
            WHERE id IN (${placeholders})
            ORDER BY CASE id ${orderByCase} END
        `).bind(...jobIds, ...jobIds).all();

        const countResult = await this.db.prepare(`
            SELECT COUNT(*) as total
            FROM conversion_jobs_fts
            WHERE conversion_jobs_fts MATCH ?
        `).bind(safeQuery).first();

        const totalCount = countResult.total || 0;
        const totalPages = Math.ceil(totalCount / limit) || 1;

        return {
            jobs: jobsResult.results || [],
            totalCount,
            page,
            totalPages,
            limit
        };
    }

    /**
     * Create FTS5 virtual table if needed
     */
    async createFTS5TableIfNeeded() {
        // Check if table exists
        try {
            await this.db.prepare(`
                SELECT 1 FROM conversion_jobs_fts LIMIT 1
            `).run();
        } catch (error) {
            // Table doesn't exist, create it
            await this.db.prepare(`
                CREATE VIRTUAL TABLE IF NOT EXISTS conversion_jobs_fts
                USING fts5(
                    original_name,
                    clean_name,
                    tags,
                    project_name,
                    notes,
                    content='conversion_jobs',
                    content_rowid='id'
                )
            `).run();

            // Populate initial data (rowid = id, content table sync)
            await this.db.prepare(`
                INSERT INTO conversion_jobs_fts(conversion_jobs_fts) VALUES('rebuild')
            `).run();

            logger.info('FTS5 table created and populated');
        }
    }

    /**
     * Update FTS5 index for a specific job
     * @param {number} jobId - Job ID
     */
    async updateFTSIndex(jobId) {
        try {
            await this.createFTS5TableIfNeeded();

            const job = await this.getById(jobId);
            if (!job) return;

            // Update or insert into FTS table (rowid = job id; content table columns)
            await this.db.prepare(`
                INSERT OR REPLACE INTO conversion_jobs_fts (rowid, original_name, clean_name, tags, project_name, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            `).bind(
                jobId,
                job.original_name || '',
                job.clean_name || '',
                job.tags || '',
                job.project_name || '',
                job.notes || ''
            ).run();

        } catch (error) {
            logger.error('Error updating FTS index', { message: error?.message });
        }
    }
}