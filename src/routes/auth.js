/**
 * Authentication Routes
 * D1-based security logging (KV removed)
 */

import { AuthService } from '../services/AuthService.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { SecurityLogRepository } from '../repositories/SecurityLogRepository.js';
import { BannedIpRepository } from '../repositories/BannedIpRepository.js';
import { CONFIG } from '../config/config.js';
import { isIpBanned, checkRateLimit, incrementFailedAttempts, resetFailedAttempts } from '../middleware/rateLimit.js';
import { SECURITY_HEADERS } from '../config/constants.js';
import { verifyPassword } from '../utils/password.js';
import { logger } from '../utils/logger.js';
import { writeSystemLog } from '../utils/systemLog.js';

async function writeSecurityLog(env, request, ip, action, status, details, createdBy) {
    if (!env.DB) return;
    try {
        const repo = new SecurityLogRepository(env.DB);
        const country = request.cf ? request.cf.country : 'XX';
        const city = request.cf ? request.cf.city : 'Unknown';
        await repo.insert({
            ip,
            action,
            status,
            userAgent: details.userAgent || request.headers.get('User-Agent') || 'unknown',
            country,
            city,
            details: { ...details, ip: undefined },
            createdBy
        });
    } catch (e) { logger.error('SecurityLog write error', { error: e?.message ?? String(e) }); }
}

/**
 * Handle authentication routes
 */
export async function handleAuthRoutes(request, env, ctx) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    const authService = new AuthService(env);

    // POST /api/login — D1 users table, returns token
    if (request.method === 'POST' && url.pathname === '/api/login') {
        if (!env.DB) {
            if (ctx?.waitUntil) ctx.waitUntil(writeSystemLog(env, { level: 'ERROR', category: 'AUTH', message: 'Login failed (DB not configured)', details: { ip, method: request.method, path: url.pathname } }));
            return Response.json({ error: 'Kullanıcı adı veya şifre hatalı.' }, { status: 401 });
        }

        // Honeypot check (same as verify)
        let body = {};
        try {
            const ct = request.headers.get('Content-Type') || '';
            if (ct.includes('application/json')) body = await request.clone().json();
        } catch (_) {}
        if (body.website_url && String(body.website_url).trim()) {
            if (env.DB) {
                const bannedRepo = new BannedIpRepository(env.DB);
                await bannedRepo.ban(ip, 'honeypot', null);
            }
            ctx.waitUntil(writeSecurityLog(env, request, ip, 'HONEYPOT_TRIGGERED', 'banned', { userAgent }));
            return Response.json({ error: 'Yetkisiz erisim.', banned: true }, { status: 403 });
        }

        if (await isIpBanned(env, ip)) {
            ctx.waitUntil(writeSecurityLog(env, request, ip, 'BLOCKED_BANNED_IP', 'blocked', { userAgent }));
            return Response.json(
                { error: 'IP adresiniz gecici olarak engellendi.', banned: true },
                { status: 403, headers: { ...SECURITY_HEADERS, 'Retry-After': '3600' } }
            );
        }

        const globalAllowed = await checkRateLimit(env, 'login:global', CONFIG.RATE_LIMITS.VERIFY_GLOBAL_PER_MINUTE, 60);
        if (!globalAllowed) {
            return Response.json(
                { error: 'Sistem yogun. Lutfen biraz bekleyin.' },
                { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': '60' } }
            );
        }
        const loginAllowed = await checkRateLimit(env, `login:${ip}`, CONFIG.RATE_LIMITS.VERIFY_PER_MINUTE, 60);
        if (!loginAllowed) {
            return Response.json(
                { error: 'Cok fazla deneme. Lutfen bekleyin.' },
                { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': '60' } }
            );
        }

        const username = (body.username || '').toString().trim();
        const password = body.password || '';
        if (!username || !password) {
            const failResult = await incrementFailedAttempts(env, ip);
            ctx.waitUntil(writeSecurityLog(env, request, ip, 'LOGIN_FAILED', 'failed', { userAgent, attemptNumber: failResult.attempts, banned: failResult.banned }));
            if (failResult.banned) {
                if (env.DB) {
                    const bannedRepo = new BannedIpRepository(env.DB);
                    await bannedRepo.ban(ip, 'brute_force', CONFIG.RATE_LIMITS.BAN_DURATION_SECONDS);
                }
                ctx.waitUntil(writeSecurityLog(env, request, ip, 'BANNED', 'banned', { userAgent, reason: 'brute_force' }));
                return Response.json({ error: 'Cok fazla basarisiz deneme. 1 saat engellendi.', banned: true }, { status: 403 });
            }
            if (ctx?.waitUntil) ctx.waitUntil(writeSystemLog(env, { level: 'ERROR', category: 'AUTH', message: 'Kullanıcı adı veya şifre hatalı.', details: { ip, method: request.method, path: url.pathname } }));
            return Response.json({ error: 'Kullanıcı adı veya şifre hatalı.' }, { status: 401 });
        }

        const userRepo = new UserRepository(env.DB);
        const user = await userRepo.findByUsername(username);
        if (!user || !(await verifyPassword(password, user.password_hash))) {
            const failResult = await incrementFailedAttempts(env, ip);
            ctx.waitUntil(writeSecurityLog(env, request, ip, 'LOGIN_FAILED', 'failed', { userAgent, attemptNumber: failResult.attempts, banned: failResult.banned }));
            if (failResult.banned) {
                if (env.DB) {
                    const bannedRepo = new BannedIpRepository(env.DB);
                    await bannedRepo.ban(ip, 'brute_force', CONFIG.RATE_LIMITS.BAN_DURATION_SECONDS);
                }
                ctx.waitUntil(writeSecurityLog(env, request, ip, 'BANNED', 'banned', { userAgent, reason: 'brute_force' }));
                return Response.json({ error: 'Cok fazla basarisiz deneme. 1 saat engellendi.', banned: true }, { status: 403 });
            }
            if (ctx?.waitUntil) ctx.waitUntil(writeSystemLog(env, { level: 'ERROR', category: 'AUTH', message: 'Kullanıcı adı veya şifre hatalı.', details: { ip, method: request.method, path: url.pathname } }));
            return Response.json({ error: 'Kullanıcı adı veya şifre hatalı.' }, { status: 401 });
        }

        const newToken = crypto.randomUUID();
        const now = new Date().toISOString();
        try {
            await env.DB.prepare('UPDATE users SET api_token = ?, last_login = ? WHERE id = ?').bind(newToken, now, user.id).run();
        } catch (e) {
            await env.DB.prepare('UPDATE users SET api_token = ? WHERE id = ?').bind(newToken, user.id).run();
        }

        await resetFailedAttempts(env, ip);
        ctx.waitUntil(writeSecurityLog(env, request, ip, 'LOGIN_SUCCESS', 'success', { userAgent, user: user.username, isRoot: user.role === 'root' }, user.username));

        const cookie = `bk_session=${newToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;
        return Response.json({
            success: true,
            role: user.role,
            isRoot: user.role === 'root'
        }, {
            headers: { ...SECURITY_HEADERS, 'Set-Cookie': cookie }
        });
    }

    // POST /api/logout — clear session cookie
    if (request.method === 'POST' && url.pathname === '/api/logout') {
        const clearCookie = 'bk_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
        return Response.json({ success: true }, {
            headers: { ...SECURITY_HEADERS, 'Set-Cookie': clearCookie }
        });
    }

    // GET /api/me — current user from session (for auth gate, role)
    if (request.method === 'GET' && url.pathname === '/api/me') {
        const authResult = await authService.verifyAuth(request);
        if (!authResult || !authResult.valid) {
            if (ctx?.waitUntil) ctx.waitUntil(writeSystemLog(env, { level: 'ERROR', category: 'AUTH', message: 'Yetkisiz erisim', details: { ip, method: request.method, path: url.pathname } }));
            return Response.json({ error: 'Yetkisiz erisim' }, { status: 401, headers: SECURITY_HEADERS });
        }
        return Response.json({
            user: authResult.user,
            role: authResult.role,
            isRoot: authResult.isRoot,
            userId: authResult.userId,
        }, { headers: SECURITY_HEADERS });
    }

    // POST /api/verify-otp — 2FA skeleton (TOTP doğrulama, henüz aktif değil)
    if (request.method === 'POST' && url.pathname === '/api/verify-otp') {
        let body = {};
        try {
            const ct = request.headers.get('Content-Type') || '';
            if (ct.includes('application/json')) body = await request.clone().json();
        } catch (_) {}
        const { tempToken, otp } = body;
        if (!tempToken || !otp) {
            return Response.json({ error: 'tempToken ve otp gerekli' }, { status: 400 });
        }
        // Skeleton: TOTP validation not yet wired; admin_users.totp_secret needed
        return Response.json(
            { error: '2FA henüz aktif değil. Lütfen normal giriş yapın.' },
            { status: 501, headers: { ...SECURITY_HEADERS } }
        );
    }

    // GET /login
    if (url.pathname === '/login') {
        const html = `<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/png" href="https://static.ticimax.cloud/31817/uploads/editoruploads/bilgekarga-image/bilge-karga.png">
    <title>Giriş — Bilge Karga Video</title>
    <style>
        :root { --bg: #f4f4f5; --surface: #ffffff; --border: #e4e4e7; --text: #09090b; --text-muted: #71717a; --radius: 6px; }
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.5; min-height: 100vh; display: flex; align-items: center; justify-content: center; -webkit-font-smoothing: antialiased; }
        .login-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; width: 100%; max-width: 360px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
        .login-title { font-weight: 700; font-size: 18px; margin-bottom: 24px; display: flex; align-items: center; gap: 8px; }
        .login-title-dot { width: 8px; height: 8px; background: var(--text); border-radius: 50%; }
        .form-group { margin-bottom: 16px; }
        .form-label { display: block; font-weight: 500; font-size: 13px; margin-bottom: 6px; color: var(--text); }
        .form-input { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 4px; font-size: 14px; background: var(--surface); color: var(--text); }
        .form-input:focus { outline: none; border-color: #71717a; }
        .form-input::placeholder { color: var(--text-muted); }
        .login-btn { width: 100%; padding: 12px; margin-top: 8px; background: var(--text); color: var(--bg); border: none; border-radius: 4px; font-weight: 600; font-size: 14px; cursor: pointer; }
        .login-btn:hover { opacity: .9; }
        .login-btn:disabled { opacity: .6; cursor: not-allowed; }
        .error-msg { margin-top: 12px; padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; color: #b91c1c; font-size: 13px; display: none; }
        .error-msg.visible { display: block; }
    </style>
</head>
<body>
    <div class="login-card">
        <h1 class="login-title"><span class="login-title-dot"></span> Video Yönetimi</h1>
        <form id="loginForm">
            <div class="form-group">
                <label class="form-label" for="username">Kullanıcı adı</label>
                <input type="text" id="username" name="username" class="form-input" placeholder="admin" required autocomplete="username">
            </div>
            <div class="form-group">
                <label class="form-label" for="password">Şifre</label>
                <input type="password" id="password" name="password" class="form-input" placeholder="••••••••" required autocomplete="current-password">
            </div>
            <div class="form-group honeypot" style="position:absolute;left:-9999px;opacity:0;height:0;overflow:hidden;" aria-hidden="true">
                <label for="website_url">Website (leave empty)</label>
                <input type="text" id="website_url" name="website_url" tabindex="-1" autocomplete="off">
            </div>
            <div class="form-group">
                <label class="form-label" for="otp_code">OTP kodu (opsiyonel)</label>
                <input type="text" id="otp_code" name="otp_code" class="form-input" placeholder="OTP kodu (ileride aktif)" disabled autocomplete="one-time-code">
            </div>
            <button type="submit" class="login-btn" id="submitBtn">Giriş yap</button>
            <div class="error-msg" id="errorMsg" role="alert"></div>
        </form>
    </div>
    <script>
        (function(){
            var f=document.getElementById('loginForm'), u=document.getElementById('username'), p=document.getElementById('password'), b=document.getElementById('submitBtn'), e=document.getElementById('errorMsg'), hp=document.getElementById('website_url');
            f.addEventListener('submit', async function(ev){
                ev.preventDefault();
                e.classList.remove('visible'); e.textContent='';
                b.disabled=true;
                var body={ username: u.value.trim(), password: p.value, website_url: hp ? (hp.value||'').trim() : '' };
                try {
                    var r=await fetch('/api/login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body), credentials:'include' });
                    var j=await r.json();
                    if(r.ok && j.success){
                        location.href='/video-dashboard.html';
                        return;
                    }
                    e.textContent=j.error||'Giriş başarısız.'; e.classList.add('visible');
                } catch (err){
                    e.textContent='Bağlantı hatası. Tekrar deneyin.'; e.classList.add('visible');
                }
                b.disabled=false;
            });
        })();
    </script>
</body>
</html>`;
        return new Response(html, {
            headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=utf-8' }
        });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
}
