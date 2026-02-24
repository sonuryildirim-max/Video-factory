/**
 * R2 orphaned multipart upload cleanup — S3 API ListMultipartUploads + AbortMultipartUpload.
 * Call from Cron; aborts uploads older than 24 hours on bk-video-raw.
 */

import { AwsClient } from 'aws4fetch';
import { logger } from '../utils/logger.js';

const RAW_BUCKET_NAME = 'bk-video-raw';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Parse ListMultipartUploads XML and return { key, uploadId, initiated }[].
 * Exported for unit tests.
 * @param {string} xml
 * @returns {Array<{ key: string, uploadId: string, initiated: string }>}
 */
export function parseListMultipartUploadsResponse(xml) {
    const uploads = [];
    const uploadRegex = /<Upload>([\s\S]*?)<\/Upload>/g;
    let m;
    while ((m = uploadRegex.exec(xml)) !== null) {
        const block = m[1];
        const key = block.match(/<Key>([^<]*)<\/Key>/)?.[1];
        const uploadId = block.match(/<UploadId>([^<]*)<\/UploadId>/)?.[1];
        const initiated = block.match(/<Initiated>([^<]*)<\/Initiated>/)?.[1];
        if (key != null && uploadId != null && initiated != null) {
            uploads.push({ key: decodeURIComponent(key.replace(/\+/g, ' ')), uploadId, initiated });
        }
    }
    return uploads;
}

/**
 * Abort multipart uploads on bk-video-raw that are older than 24 hours.
 * Requires env.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
 * @param {object} env - Worker env
 * @returns {Promise<{ listed: number, aborted: number, errors: string[] }>}
 */
export async function cleanupOrphanedUploads(env) {
    const result = { listed: 0, aborted: 0, errors: [] };
    const accountId = env.R2_ACCOUNT_ID;
    const accessKeyId = env.R2_ACCESS_KEY_ID;
    const secretKey = env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretKey) {
        logger.warn('R2 multipart cleanup skipped: missing R2 API credentials');
        return result;
    }

    const baseUrl = `https://${accountId}.r2.cloudflarestorage.com/${RAW_BUCKET_NAME}`;
    const client = new AwsClient({
        accessKeyId,
        secretAccessKey: secretKey,
        region: 'auto',
        service: 's3',
    });

    try {
        const listUrl = `${baseUrl}?uploads`;
        const listReq = new Request(listUrl, { method: 'GET' });
        const signedList = await client.sign(listReq);
        const listRes = await fetch(signedList);
        if (!listRes.ok) {
            const text = await listRes.text();
            result.errors.push(`ListMultipartUploads failed: ${listRes.status} ${text?.slice(0, 200)}`);
            return result;
        }
        const listXml = await listRes.text();
        const uploads = parseListMultipartUploadsResponse(listXml);
        result.listed = uploads.length;

        const cutoff = Date.now() - MAX_AGE_MS;
        for (const u of uploads) {
            const initiatedMs = new Date(u.initiated).getTime();
            if (isNaN(initiatedMs) || initiatedMs >= cutoff) continue;

            try {
                const abortUrl = `${baseUrl}/${encodeURIComponent(u.key)}?uploadId=${encodeURIComponent(u.uploadId)}`;
                const abortReq = new Request(abortUrl, { method: 'DELETE' });
                const signedAbort = await client.sign(abortReq);
                const abortRes = await fetch(signedAbort);
                if (abortRes.ok || abortRes.status === 204) {
                    result.aborted++;
                    logger.info('R2 multipart aborted', { key: u.key, uploadId: u.uploadId?.slice(0, 8) });
                } else {
                    result.errors.push(`Abort ${u.key}: ${abortRes.status}`);
                }
            } catch (e) {
                result.errors.push(`Abort ${u.key}: ${e?.message || String(e)}`);
            }
        }
    } catch (e) {
        logger.error('R2 multipart cleanup failed', { message: e?.message || String(e) });
        result.errors.push(e?.message || String(e));
    }
    return result;
}
