/**
 * Folders API — BK Video Factory
 * GET  /api/folders       → list (system + user folders with counts)
 * POST /api/folders       → create (name, is_system=0)
 */

import { requireAuth } from '../middleware/auth.js';
import { jsonResponse } from '../utils/errors.js';
import { ValidationError } from '../utils/errors.js';
import { FolderService } from '../services/FolderService.js';

export async function handleFolderRoutes(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (!env.DB) {
        return Response.json({ error: 'Database not available' }, { status: 503 });
    }

    const folderService = new FolderService(env);

    try {
        if (path === '/api/folders' && method === 'GET') {
            return await routeListFolders(request, env, folderService);
        }
        if (path === '/api/folders' && method === 'POST') {
            return await routeCreateFolder(request, env, folderService);
        }
        const deleteMatch = path.match(/^\/api\/folders\/([^/]+)$/);
        if (deleteMatch && method === 'DELETE') {
            return await routeDeleteFolder(deleteMatch[1], request, env, folderService);
        }
        return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (e) {
        if (e.statusCode) {
            return Response.json({ error: e.message }, { status: e.statusCode });
        }
        throw e;
    }
}

async function routeListFolders(request, env, folderService) {
    await requireAuth(request, env);

    const folders = await folderService.listFolders();
    return jsonResponse({ folders });
}

async function routeCreateFolder(request, env, folderService) {
    await requireAuth(request, env);

    const body = await request.json().catch(() => null);
    if (!body) throw new ValidationError('Request body must be JSON');

    const name = (body.name || '').trim();
    if (!name) throw new ValidationError('Folder name is required');
    if (name.length > 128) throw new ValidationError('Folder name too long');

    const folder = await folderService.createFolder(name);
    return jsonResponse(folder, 201);
}

async function routeDeleteFolder(id, request, env, folderService) {
    await requireAuth(request, env);
    const folderId = parseInt(id, 10);
    if (isNaN(folderId)) throw new ValidationError('Invalid folder ID');
    await folderService.deleteFolder(folderId);
    return jsonResponse({ success: true, message: 'Klasör silindi' });
}
