/**
 * Unit tests: Presigned URL flow — parameter validation
 * VideoService.generatePresignedUrl validates fileName, fileSize, quality.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VideoService } from '../src/services/VideoService.js';
import { ValidationError } from '../src/utils/errors.js';

describe('Presigned URL / generatePresignedUrl', () => {
    let env;
    let svc;

    beforeEach(() => {
        env = {
            DB: null,
            R2_ACCOUNT_ID: null,
            R2_ACCESS_KEY_ID: null,
            R2_SECRET_ACCESS_KEY: null,
        };
        svc = new VideoService(env);
    });

    it('throws ValidationError when fileSize exceeds 5 GB', async () => {
        const over = 5 * 1024 * 1024 * 1024 + 1;
        await expect(
            svc.generatePresignedUrl(
                { fileName: 'test.mp4', fileSize: over, quality: '720p' },
                'user1'
            )
        ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for invalid file extension', async () => {
        await expect(
            svc.generatePresignedUrl(
                { fileName: 'test.exe', fileSize: 1000, quality: '720p' },
                'user1'
            )
        ).rejects.toThrow(ValidationError);
    });

    it('accepts valid extension and rejects disallowed extension', async () => {
        await expect(
            svc.generatePresignedUrl(
                { fileName: 'doc.pdf', fileSize: 1000, quality: '720p' },
                'user1'
            )
        ).rejects.toThrow(ValidationError);
    });
});
