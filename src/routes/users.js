/**
 * User Management Routes (Root Only)
 * POST /api/users — create admin
 * GET /api/users — list users
 * DELETE /api/users/:id — delete or deactivate
 * PATCH /api/users/:id — update password, is_active
 */

import { requireRoot } from '../middleware/auth.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { SecurityLogRepository } from '../repositories/SecurityLogRepository.js';
import { handleError } from '../utils/errors.js';
import { ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

async function writeUserAuditLog(env, request, action, details, createdBy) {
    if (!env.DB) return;
    try {
        const repo = new SecurityLogRepository(env.DB);
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const country = request.cf?.country || 'XX';
        const city = request.cf?.city || 'Unknown';
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        await repo.insert({
            ip,
            action,
            status: 'success',
            userAgent,
            country,
            city,
            details: { ...details, ip: undefined },
            createdBy
        });
    } catch (e) { logger.error('users SecurityLog write error', { message: e?.message }); }
}

export async function handleUserRoutes(request, env, ctx) {
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/^\/api\/users(?:\/(\d+))?$/);
    const id = pathMatch ? pathMatch[1] : null;

    try {
        // POST /api/users — create
        if (request.method === 'POST' && url.pathname === '/api/users') {
            const auth = await requireRoot(request, env);
            let body = {};
            try {
                const ct = request.headers.get('Content-Type') || '';
                if (ct.includes('application/json')) body = await request.json();
            } catch (_) {}
            const { username, password, role = 'admin' } = body;
            const userRepo = new UserRepository(env.DB);
            const total = await userRepo.count();
            if (total >= 5) {
                return Response.json({ error: 'Kurumsal limit (5 kullanıcı) doldu. Artırım için kod değişikliği gereklidir.' }, { status: 403 });
            }
            const created = await userRepo.create({ username, password, role });
            await writeUserAuditLog(env, request, 'USER_CREATED', {
                target_username: created.username,
                target_id: created.id,
                role: created.role,
            }, auth.user);
            return Response.json({
                id: created.id,
                username: created.username,
                role: created.role,
                is_active: created.is_active,
                created_at: created.created_at,
            }, { status: 201 });
        }

        // GET /api/users — list
        if (request.method === 'GET' && url.pathname === '/api/users') {
            await requireRoot(request, env);
            const userRepo = new UserRepository(env.DB);
            const users = await userRepo.list();
            return Response.json(users);
        }

        // DELETE /api/users/:id — soft delete (set is_active=0)
        if (request.method === 'DELETE' && id) {
            const auth = await requireRoot(request, env);
            const idNum = parseInt(id, 10);
            if (auth.userId != null && auth.userId === idNum) {
                return Response.json({ error: 'Kendini silemezsin' }, { status: 400 });
            }
            const userRepo = new UserRepository(env.DB);
            const target = await userRepo.getById(id);
            if (!target) return Response.json({ error: 'User not found' }, { status: 404 });
            if (target.role === 'root') {
                return Response.json({ error: 'Root hesabi silinemez' }, { status: 400 });
            }
            const updated = await userRepo.setActive(id, 0);
            await writeUserAuditLog(env, request, 'USER_DELETED', {
                target_username: target.username,
                target_id: target.id,
            }, auth.user);
            return Response.json({ success: true, message: 'User deactivated' });
        }

        // PATCH /api/users/:id — update password or is_active
        if (request.method === 'PATCH' && id) {
            const auth = await requireRoot(request, env);
            let body = {};
            try {
                const ct = request.headers.get('Content-Type') || '';
                if (ct.includes('application/json')) body = await request.json();
            } catch (_) {}
            const userRepo = new UserRepository(env.DB);
            const idNum = parseInt(id, 10);

            if (typeof body.is_active === 'boolean') {
                if (body.is_active === false) {
                    if (auth.userId != null && auth.userId === idNum) {
                        return Response.json({ error: 'Kendini pasif yapamazsin' }, { status: 400 });
                    }
                    const target = await userRepo.getById(id);
                    if (!target) return Response.json({ error: 'User not found' }, { status: 404 });
                    if (target.role === 'root') {
                        return Response.json({ error: 'Root hesabi pasif yapilamaz' }, { status: 400 });
                    }
                }
                const updated = await userRepo.setActive(id, body.is_active);
                if (!updated) return Response.json({ error: 'User not found' }, { status: 404 });
                await writeUserAuditLog(env, request, 'USER_UPDATED', {
                    target_username: updated.username,
                    target_id: updated.id,
                    field: 'is_active',
                    new_value: body.is_active,
                }, auth.user);
                return Response.json(updated);
            }
            if (body.password) {
                const target = await userRepo.getById(id);
                if (!target) return Response.json({ error: 'User not found' }, { status: 404 });
                await userRepo.updatePassword(id, body.password);
                await writeUserAuditLog(env, request, 'USER_UPDATED', {
                    target_username: target.username,
                    target_id: target.id,
                    field: 'password',
                }, auth.user);
                return Response.json({ success: true, message: 'Password updated' });
            }
            return Response.json({ error: 'Invalid body: provide password or is_active' }, { status: 400 });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
        if (error instanceof ValidationError) {
            return Response.json({ error: error.message }, { status: 400 });
        }
        return handleError(error, request, env, ctx);
    }
}
