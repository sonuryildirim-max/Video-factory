/**
 * Password hashing and verification — PBKDF2-SHA256
 * Cloudflare Workers Web Crypto API
 */

const ITERATIONS = 100000;
const SALT_LEN = 16;
const HASH_LEN = 32;

function toHex(buf) {
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function fromHex(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes.buffer;
}

/**
 * Hash password with PBKDF2-SHA256
 * @param {string} password - Plain password
 * @returns {Promise<string>} Format: saltHex:hashHex
 */
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt,
            iterations: ITERATIONS,
            hash: 'SHA-256',
        },
        key,
        HASH_LEN * 8
    );
    return `${toHex(salt)}:${toHex(bits)}`;
}

/**
 * Verify password against stored hash
 * @param {string} password - Plain password
 * @param {string} storedHash - Format: saltHex:hashHex
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, storedHash) {
    if (!password || !storedHash || !storedHash.includes(':')) return false;
    const [saltHex, hashHex] = storedHash.split(':');
    if (!saltHex || !hashHex) return false;
    try {
        const salt = fromHex(saltHex);
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveBits']
        );
        const bits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt,
                iterations: ITERATIONS,
                hash: 'SHA-256',
            },
            key,
            HASH_LEN * 8
        );
        return toHex(bits) === hashHex;
    } catch {
        return false;
    }
}
