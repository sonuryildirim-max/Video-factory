/**
 * R2 Bucket Lifecycle Setup — Run with Node (not in Worker).
 * Requires: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (env or .dev.vars).
 *
 * - bk-video-raw:   7-day Expiration (orphan uploads) + Abort multipart after 1 day
 * - bk-video-deleted: 30-day Expiration (hard delete after soft delete)
 *
 * Usage: node scripts/setup-r2-lifecycle.js
 */

import { S3Client, PutBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';

const RAW_BUCKET = 'bk-video-raw';
const DELETED_BUCKET = 'bk-video-deleted';

function getEnv(name) {
    const v = process.env[name];
    if (!v || typeof v !== 'string') return null;
    return v.trim();
}

async function main() {
    const accountId = getEnv('R2_ACCOUNT_ID');
    const accessKeyId = getEnv('R2_ACCESS_KEY_ID');
    const secretAccessKey = getEnv('R2_SECRET_ACCESS_KEY');

    if (!accountId || !accessKeyId || !secretAccessKey) {
        console.error('Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY. Set in env or .dev.vars.');
        process.exit(1);
    }

    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    const client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
    });

    // bk-video-raw: 7-day expiration (orphan files), 1-day abort incomplete multipart
    await client.send(new PutBucketLifecycleConfigurationCommand({
        Bucket: RAW_BUCKET,
        LifecycleConfiguration: {
            Rules: [
                {
                    ID: 'ExpireOrphanRawAfter7Days',
                    Status: 'Enabled',
                    Filter: { Prefix: '' },
                    Expiration: { Days: 7 },
                },
                {
                    ID: 'AbortIncompleteMultipartAfter1Day',
                    Status: 'Enabled',
                    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
                },
            ],
        },
    }));
    console.log(`[OK] ${RAW_BUCKET}: lifecycle set (7d expiration, 1d abort multipart)`);

    // bk-video-deleted: 30-day expiration (hard delete after soft delete)
    await client.send(new PutBucketLifecycleConfigurationCommand({
        Bucket: DELETED_BUCKET,
        LifecycleConfiguration: {
            Rules: [
                {
                    ID: 'ExpireDeletedAfter30Days',
                    Status: 'Enabled',
                    Filter: { Prefix: '' },
                    Expiration: { Days: 30 },
                },
            ],
        },
    }));
    console.log(`[OK] ${DELETED_BUCKET}: lifecycle set (30d expiration)`);

    console.log('R2 lifecycle setup complete.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
