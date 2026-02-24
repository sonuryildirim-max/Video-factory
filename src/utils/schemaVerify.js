/**
 * D1 Schema Verifier — Ensures view_count and is_deleted columns exist.
 * Call at worker startup (lazy, per-instance).
 * Safe to run multiple times; duplicate column errors are ignored.
 */

import { logger } from './logger.js';

const FIXES = [
    { sql: 'ALTER TABLE conversion_jobs ADD COLUMN view_count INTEGER DEFAULT 0', name: 'view_count' },
    { sql: 'ALTER TABLE conversion_jobs ADD COLUMN is_deleted INTEGER DEFAULT 0', name: 'is_deleted' },
    { sql: 'ALTER TABLE conversion_jobs ADD COLUMN processing_checkpoint TEXT', name: 'processing_checkpoint' },
    { sql: 'ALTER TABLE conversion_jobs ADD COLUMN checkpoint_updated_at DATETIME', name: 'checkpoint_updated_at' },
];

export async function ensureSchema(env) {
    if (!env?.DB) return;
    for (const fix of FIXES) {
        try {
            await env.DB.prepare(fix.sql).run();
            logger.info('Schema SUCCESS', { name: fix.name, msg: 'sütunu eklendi' });
        } catch (e) {
            if (/duplicate column name/i.test(e?.message || '')) {
                logger.info('Schema OK', { name: fix.name, msg: 'zaten mevcut' });
            } else {
                logger.error('Schema FAIL', { name: fix.name, message: e?.message || String(e) });
            }
        }
    }
}
