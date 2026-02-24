/**
 * Folder Service — list and create folders via FolderRepository
 */

import { FolderRepository } from '../repositories/FolderRepository.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

export class FolderService {
    constructor(env) {
        this.repo = new FolderRepository(env.DB);
    }

    /**
     * List folders with video counts.
     * @returns {Promise<Array<{ id: number, name: string, is_system: boolean, created_at: string|null, count: number }>>
     */
    async listFolders() {
        return await this.repo.listWithCounts();
    }

    /**
     * Create a user folder.
     * @param {string} name
     * @returns {Promise<{ id: number, name: string, is_system: boolean, created_at: string|null, count: number }>}
     */
    async createFolder(name) {
        const row = await this.repo.create(name);
        return {
            id: row.id,
            name: row.name,
            is_system: false,
            created_at: row.created_at,
            count: 0,
        };
    }

    /**
     * Get folder by id (for display name etc.).
     * @param {number} id
     * @returns {Promise<{ id: number, name: string, is_system: number, created_at: string|null }|null>}
     */
    async getFolderById(id) {
        return this.repo.getById(id);
    }

    /**
     * Delete a user folder (not system folders).
     * @param {number} id - Folder id
     * @throws {NotFoundError} if folder not found
     * @throws {ValidationError} if folder is system
     */
    async deleteFolder(id) {
        const folder = await this.repo.getById(id);
        if (!folder) throw new NotFoundError('Folder', id);
        if (folder.is_system === 1) throw new ValidationError('Sistem klasörleri silinemez');
        return await this.repo.deleteFolder(id);
    }
}
