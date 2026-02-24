/**
 * Log Routes
 */

import { LogService } from '../services/LogService.js';
import { KVRepository } from '../repositories/KVRepository.js';
import { D1Repository } from '../repositories/D1Repository.js';
import { requireRoot } from '../middleware/auth.js';
import { handleError } from '../utils/errors.js';
import { SECURITY_HEADERS } from '../config/constants.js';

/**
 * Handle log routes
 */
export async function handleLogRoutes(request, env, ctx) {
    const url = new URL(request.url);
    const kvRepo = new KVRepository(env.LINKS);
    const d1Repo = new D1Repository(env.DB);
    const logService = new LogService(kvRepo, d1Repo);

    try {
        // GET /api/logs
        if (request.method === 'GET' && url.pathname.includes('/logs')) {
            await requireRoot(request, env);

            const startDate = url.searchParams.get('startDate') || new Date().toISOString().slice(0, 10);
            const endDate = url.searchParams.get('endDate') || startDate;

            if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                return Response.json({ error: 'Hatali tarih formati' }, { status: 400 });
            }

            const logs = await logService.getLogs({ startDate, endDate });
            return Response.json({ count: logs.length, logs }, { headers: SECURITY_HEADERS });
        }

        // GET /logs (HTML page)
        if (url.pathname === '/logs') {
            // Return logs HTML page (will be loaded from views later)
            return new Response('Logs page - HTML to be added', {
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=utf-8' }
            });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
        return handleError(error, request, env, ctx);
    }
}
