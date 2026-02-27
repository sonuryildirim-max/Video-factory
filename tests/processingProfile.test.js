/**
 * Unit tests: processing_profile (CRF integer flow) — default 12, valid presets 6,8,10,12,14, web_opt
 * UploadService.generatePresignedUrl and importFromUrlSync pass processing_profile to job;
 * JobRepository.create derives crf integer and defaults processing_profile to '12' when not provided.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UploadService } from '../src/services/UploadService.js';

const VALID_PRESETS = ['6', '8', '10', '12', '14', 'web_opt'];

describe('processing_profile (Native Video Preset)', () => {
    let env;
    let mockJobRepo;
    let mockUploadTokenRepo;
    let uploadService;

    beforeEach(() => {
        env = {
            R2_ACCOUNT_ID: 'test',
            R2_ACCESS_KEY_ID: 'test',
            R2_SECRET_ACCESS_KEY: 'test',
            R2_RAW_BUCKET_NAME: 'test-bucket',
        };
        mockJobRepo = {
            create: vi.fn().mockResolvedValue({ id: 1 }),
        };
        mockUploadTokenRepo = {
            save: vi.fn().mockResolvedValue(undefined),
        };
        uploadService = new UploadService(env, mockJobRepo, mockUploadTokenRepo);
    });

    describe('generatePresignedUrl — default processing_profile', () => {
        it('uses 12 when processingProfile is not provided', async () => {
            await uploadService.generatePresignedUrl(
                { fileName: 'test.mp4', fileSize: 1000, quality: '720p' },
                'user1'
            );
            expect(mockJobRepo.create).toHaveBeenCalledTimes(1);
            const call = mockJobRepo.create.mock.calls[0][0];
            expect(call.processing_profile).toBe('12');
        });

        it('uses 12 when processingProfile is null/undefined', async () => {
            await uploadService.generatePresignedUrl(
                { fileName: 'test.mp4', fileSize: 1000, quality: '720p', processingProfile: undefined },
                'user1'
            );
            const call = mockJobRepo.create.mock.calls[0][0];
            expect(call.processing_profile).toBe('12');
        });
    });

    describe('generatePresignedUrl — valid preset values', () => {
        it.each(VALID_PRESETS)('stores processing_profile "%s" when provided', async (preset) => {
            await uploadService.generatePresignedUrl(
                { fileName: 'test.mp4', fileSize: 1000, quality: '720p', processingProfile: preset },
                'user1'
            );
            const call = mockJobRepo.create.mock.calls[0][0];
            expect(call.processing_profile).toBe(preset);
        });
    });

    describe('importFromUrlSync — default and valid presets', () => {
        beforeEach(() => {
            env.R2_RAW_UPLOADS_BUCKET = {
                put: vi.fn().mockResolvedValue(undefined),
                head: vi.fn().mockResolvedValue({ size: 1024 }),
            };
            uploadService = new UploadService(env, mockJobRepo, mockUploadTokenRepo);
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: new Map([['content-type', 'video/mp4']]),
                body: new ReadableStream(),
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
            });
        });

        it('uses 12 when processingProfile is not provided', async () => {
            await uploadService.importFromUrlSync(
                { url: 'https://example.com/video.mp4', quality: '720p' },
                'user1',
                env
            );
            expect(mockJobRepo.create).toHaveBeenCalledTimes(1);
            const call = mockJobRepo.create.mock.calls[0][0];
            expect(call.processing_profile).toBe('12');
        });

        it('stores web_opt when processingProfile is web_opt', async () => {
            await uploadService.importFromUrlSync(
                { url: 'https://example.com/video.mp4', quality: '720p', processingProfile: 'web_opt' },
                'user1',
                env
            );
            const call = mockJobRepo.create.mock.calls[0][0];
            expect(call.processing_profile).toBe('web_opt');
        });
    });
});
