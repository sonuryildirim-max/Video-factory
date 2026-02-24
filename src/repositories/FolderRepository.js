/**
 * Folder Repository — D1 access for folders (list with counts, create, getById)
 */

import { JOB_STATUS } from '../config/BK_CONSTANTS.js';

export class FolderRepository {
    constructor(db) {
        this.db = db;
    }

    /**
     * List all folders with video count (non-deleted, non-DELETED status).
     * @returns {Promise<Array<{ id: number, name: string, is_system: boolean, created_at: string|null, count: number }>>
     */
    async listWithCounts() {
        const result = await this.db.prepare(`
            SELECT f.id, f.name, f.is_system, f.created_at,
                   (SELECT COUNT(*) FROM conversion_jobs j WHERE j.folder_id = f.id AND j.deleted_at IS NULL AND j.status != '${JOB_STATUS.DELETED}') as count
            FROM folders f
            ORDER BY f.is_system DESC, f.id ASC
        `).all();

        return (result.results || []).map(r => ({
            id: r.id,
            name: r.name,
            is_system: r.is_system === 1,
            created_at: r.created_at,
            count: r.count ?? 0,
        }));
    }

    /**
     * Create a user folder (is_system=0).
     * @param {string} name
     * @returns {Promise<{ id: number, name: string, is_system: number, created_at: string|null }>}
     */
    async create(name) {
        const run = await this.db.prepare(`
            INSERT INTO folders (name, is_system, created_at)
            VALUES (?, 0, datetime('now'))
        `).bind(name).run();

        const id = run.meta?.last_row_id;
        const row = await this.db.prepare('SELECT id, name, is_system, created_at FROM folders WHERE id = ?')
            .bind(id).first();
        return row;
    }

    /**
     * Get folder by id.
     * @param {number} id
     * @returns {Promise<{ id: number, name: string, is_system: number, created_at: string|null }|null>}
     */
    async getById(id) {
        const row = await this.db.prepare('SELECT id, name, is_system, created_at FROM folders WHERE id = ?')
            .bind(id).first();
        return row || null;
    }

    /**
     * Delete a user folder (is_system=0 only). Sets conversion_jobs.folder_id to NULL first.
     * @param {number} id - Folder id
     * @returns {Promise<boolean>} True if a row was deleted
     */
    async deleteFolder(id) {
        await this.db.prepare(
            'UPDATE conversion_jobs SET folder_id = NULL WHERE folder_id = ?'
        ).bind(id).run();
        const result = await this.db.prepare(
            'DELETE FROM folders WHERE id = ? AND is_system = 0'
        ).bind(id).run();
        return (result.meta?.changes ?? 0) > 0;
    }
}
