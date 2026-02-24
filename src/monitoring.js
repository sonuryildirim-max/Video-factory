/**
 * BK Video Factory — Monitoring & dual-channel alerts (Telegram + Edge backup).
 * Reduces SPOF: alerts go to Telegram and optional backup webhook (e.g. Cloudflare Logpush, Discord).
 */

import { logger } from './utils/logger.js';

const SIGNAL_LOST_TITLE = 'CRITICAL ALERT: SIGNAL LOST';
const SIGNAL_LOST_BODY = [
    '[ \\ ] <b>TARGET NODE:</b> Primary Processing Core (Hetzner)',
    '[ ! ] <b>STATUS:</b> No heartbeat received for 10+ minutes.',
    '> <b>DIRECTIVE:</b> NODE PRESUMED DEAD. INITIATING ADMIN WAKE-UP ALARM!'
].join('\n');

/**
 * Send alert to both Telegram (if configured) and backup webhook (if configured).
 * Fire-and-forget; does not throw.
 * @param {object} env - Worker env (TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, ALERT_WEBHOOK_URL or SAMARITAN_BACKUP_WEBHOOK)
 * @param {{ level: 'critical'|'warning', title: string, body: string }} opts
 */
export async function sendAlert(env, opts) {
    const { level = 'critical', title, body } = opts;
    const timestamp = new Date().toISOString();
    const promises = [];

    if (env?.TELEGRAM_TOKEN && env?.TELEGRAM_CHAT_ID) {
        const text = `${title}\n\n${body}`;
        promises.push(
            fetch('https://api.telegram.org/bot' + env.TELEGRAM_TOKEN + '/sendMessage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: env.TELEGRAM_CHAT_ID,
                    text,
                    parse_mode: 'HTML',
                }),
            }).then((res) => {
                if (!res.ok) logger.error('Monitoring: Telegram send failed', { status: res.status });
            }).catch((e) => logger.error('Monitoring: Telegram error', { message: e?.message }))
        );
    }

    const webhookUrl = env?.ALERT_WEBHOOK_URL || env?.SAMARITAN_BACKUP_WEBHOOK;
    if (webhookUrl) {
        const payload = JSON.stringify({
            level,
            title: title?.replace(/<[^>]+>/g, '').trim(),
            body: body?.replace(/<[^>]+>/g, ' ').trim(),
            timestamp,
            source: 'bk-vf',
        });
        promises.push(
            fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
            }).then((res) => {
                if (!res.ok) logger.error('Monitoring: Backup webhook failed', { status: res.status, url: webhookUrl });
            }).catch((e) => logger.error('Monitoring: Backup webhook error', { message: e?.message, url: webhookUrl }))
        );
    }

    await Promise.allSettled(promises);
}

/**
 * Signal Lost dedector: fire critical alert when no heartbeat for 10+ minutes.
 * Sends to both Telegram and backup webhook.
 */
export async function sendSignalLostAlert(env) {
    await sendAlert(env, {
        level: 'critical',
        title: SIGNAL_LOST_TITLE,
        body: SIGNAL_LOST_BODY,
    });
}

/**
 * Check if agent signal is lost (no heartbeat/telemetry for 10 minutes).
 * Uses last_agent_telemetry from config, or latest worker_heartbeats row.
 * @param {object} env - Worker env with DB
 * @returns {Promise<{ lost: boolean, lastAt: string|null, minutesAgo: number|null }>}
 */
export async function checkSignalLost(env) {
    const TEN_MIN_MS = 10 * 60 * 1000;
    let lastAt = null;

    if (env?.DB) {
        const configRow = await env.DB.prepare(
            "SELECT value FROM config WHERE key = 'last_agent_telemetry'"
        ).first();
        if (configRow?.value) {
            try {
                const t = JSON.parse(configRow.value);
                lastAt = t?.timestamp || configRow.value;
            } catch (_) {
                lastAt = configRow.value;
            }
        }
        if (!lastAt) {
            const heartRow = await env.DB.prepare(
                'SELECT MAX(last_heartbeat) as last_heartbeat FROM worker_heartbeats'
            ).first();
            lastAt = heartRow?.last_heartbeat ?? null;
        }
    }

    if (!lastAt) {
        return { lost: false, lastAt: null, minutesAgo: null };
    }
    const lastMs = new Date(lastAt).getTime();
    const minutesAgo = (Date.now() - lastMs) / 60000;
    return {
        lost: minutesAgo >= 10,
        lastAt: String(lastAt),
        minutesAgo: Math.round(minutesAgo * 10) / 10,
    };
}
