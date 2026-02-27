/**
 * Folder Repository — D1 access for folders (list with counts, create, getById)
 * SQL safety: all user input via .bind(); deleteFolder uses batch for atomicity.
 */

import { JOB_STATUS } from '../config/BK_CONSTANTS.js';
import { AppError, BK_ERROR_CODES } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

function toDbError(e, context) {
    logger.error(context, { message: e?.message });
    const err = new AppError('Veritabanı işlemi başarısız', 500, 'INTERNAL');
    err.errorCode = BK_ERROR_CODES.INTERNAL;
    err.developerMessage = e?.message;
    throw err;
}

export class FolderRepository {
    constructor(db) {
        this.db = db;
    }

    /**
     * Set folder_id to NULL on jobs that reference a non-existent folder (yetim referans).
     * Safe to call before every list; no-op if none.
     */
    async cleanOrphanFolderReferences() {
        try {
            await this.db.prepare(`
                UPDATE conversion_jobs SET folder_id = NULL
                WHERE folder_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = conversion_jobs.folder_id)
            `).run();
        } catch (e) {
            toDbError(e, 'FolderRepository.cleanOrphanFolderReferences');
        }
    }

    /**
     * List all folders with video count (non-deleted, non-DELETED status).
     * @returns {Promise<Array<{ id: number, name: string, is_system: boolean, created_at: string|null, count: number }>>
     */
    async listWithCounts() {
        await this.cleanOrphanFolderReferences();
        try {
            const result = await this.db.prepare(`
                SELECT f.id, f.name, f.is_system, f.created_at,
                       (SELECT COUNT(*) FROM conversion_jobs j WHERE j.folder_id = f.id AND j.deleted_at IS NULL AND j.status != ?) as count
                FROM folders f
                ORDER BY f.is_system DESC, f.id ASC
            `).bind(JOB_STATUS.DELETED).all();

            return (result.results || []).map(r => ({
            id: r.id,
            name: r.name,
            is_system: r.is_system === 1,
            created_at: r.created_at,
            count: r.count ?? 0,
        }));
        } catch (e) {
            toDbError(e, 'FolderRepository.listWithCounts');
        }
    }

    /**
     * Create a user folder (is_system=0). Uses RETURNING for single round-trip.
     * @param {string} name
     * @returns {Promise<{ id: number, name: string, is_system: number, created_at: string|null }>}
     */
    async create(name) {
        try {
            const row = await this.db.prepare(`
                INSERT INTO folders (name, is_system, created_at)
                VALUES (?, 0, datetime('now'))
                RETURNING id, name, is_system, created_at
            `).bind(name).first();
            if (!row) throw new Error('INSERT RETURNING returned no row');
            return row;
        } catch (e) {
            toDbError(e, 'FolderRepository.create');
        }
    }

    /**
     * Get folder by id.
     * @param {number} id
     * @returns {Promise<{ id: number, name: string, is_system: number, created_at: string|null }|null>}
     */
    async getById(id) {
        try {
            const row = await this.db.prepare('SELECT id, name, is_system, created_at FROM folders WHERE id = ?')
                .bind(id).first();
            return row || null;
        } catch (e) {
            toDbError(e, 'FolderRepository.getById');
        }
    }

    /**
     * Delete a user folder (is_system=0 only). Sets conversion_jobs.folder_id to NULL first.
     * Uses db.batch() for atomicity and single round-trip.
     * @param {number} id - Folder id
     * @returns {Promise<boolean>} True if a row was deleted
     */
    async deleteFolder(id) {
        try {
            const results = await this.db.batch([
                this.db.prepare('UPDATE conversion_jobs SET folder_id = NULL WHERE folder_id = ?').bind(id),
                this.db.prepare('DELETE FROM folders WHERE id = ? AND is_system = 0').bind(id),
            ]);
            const deleteResult = results[1];
            return (deleteResult?.meta?.changes ?? 0) > 0;
        } catch (e) {
            toDbError(e, 'FolderRepository.deleteFolder');
        }
    }
}
