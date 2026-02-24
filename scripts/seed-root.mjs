#!/usr/bin/env node
/**
 * Seed first root user for BK Video Factory RBAC.
 * Run: node scripts/seed-root.mjs <username> <password>
 * Then execute the printed SQL with: wrangler d1 execute bk-video-db --remote --command "..."
 */

import crypto from 'crypto';

const ITERATIONS = 100000;
const SALT_LEN = 16;
const HASH_LEN = 32;

function hashPassword(password) {
    const salt = crypto.randomBytes(SALT_LEN);
    const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, HASH_LEN, 'sha256');
    return salt.toString('hex') + ':' + hash.toString('hex');
}

const [username, password] = process.argv.slice(2);
if (!username || !password) {
    console.error('Usage: node scripts/seed-root.mjs <username> <password>');
    process.exit(1);
}
const u = String(username).trim().replace(/'/g, "''");
const hash = hashPassword(password).replace(/'/g, "''");
const apiToken = crypto.randomUUID();

const sql = `INSERT OR IGNORE INTO users (username, password_hash, role, api_token, is_active) VALUES ('${u}', '${hash}', 'root', '${apiToken}', 1);`;
console.log('Run the following SQL to seed the root user:');
console.log('');
console.log(sql);
console.log('');
console.log('Example: wrangler d1 execute bk-video-db --remote --command "' + sql.replace(/"/g, '\\"') + '"');
