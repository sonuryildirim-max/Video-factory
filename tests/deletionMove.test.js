/**
 * Unit tests: Public → Deleted bucket move logic (soft delete flow)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeletionService } from '../src/services/DeletionService.js';

describe('DeletionService — public to deleted move', () => {
    /** @type {Record<string, Array<{ key: string }>>} */
    let putCalls;
    /** @type {Record<string, string[]>} */
    let deleteCalls;
    let getReturn;

    beforeEach(() => {
        putCalls = { deleted: [] };
        deleteCalls = { public: [], raw: [], deleted: [] };
        getReturn = { body: new ReadableStream(), httpMetadata: {}, customMetadata: {} };
    });

    function mockBucket(name) {
        const isDeleted = name === 'deleted';
        return {
            get: vi.fn(async () => getReturn),
            put: vi.fn(async (key) => {
                if (isDeleted) putCalls.deleted.push({ key });
            }),
            delete: vi.fn(async (key) => {
                if (name === 'public') deleteCalls.public.push(key);
                if (name === 'raw') deleteCalls.raw.push(key);
                if (name === 'deleted') deleteCalls.deleted.push(key);
            }),
        };
    }

    it('moves public object to deleted bucket on deleteJob (soft delete)', async () => {
        const env = {};
        const jobRepo = {
            getById: vi.fn().mockResolvedValue({
                id: 1,
                status: 'COMPLETED',
                uploaded_by: 10,
                public_url: 'https://cdn.bilgekarga.tr/videos/foo-bar.mp4',
                r2_raw_key: null,
                thumbnail_key: 'thumbnails/foo-bar.jpg',
            }),
            softDeleteJob: vi.fn().mockResolvedValue({ id: 1 }),
        };
        const pubBucket = mockBucket('public');
        const delBucket = mockBucket('deleted');
        env.R2_RAW_UPLOADS_BUCKET = null;
        env.R2_PUBLIC_BUCKET = pubBucket;
        env.R2_DELETED_BUCKET = delBucket;

        const svc = new DeletionService(env, jobRepo, {
            cdnBase: 'https://cdn.bilgekarga.tr',
            rawBucket: 'R2_RAW_UPLOADS_BUCKET',
            pubBucket: 'R2_PUBLIC_BUCKET',
            delBucket: 'R2_DELETED_BUCKET',
        });

        await svc.deleteJob(1, 10, env, false);

        expect(jobRepo.softDeleteJob).toHaveBeenCalledWith(1);
        // Move = copy to deleted bucket + delete from public (put is to deleted only)
        expect(delBucket.put).toHaveBeenCalled();
        expect(putCalls.deleted.some(c => c.key.includes('videos/') || c.key.includes('foo-bar'))).toBe(true);
        expect(pubBucket.get).toHaveBeenCalled();
        expect(pubBucket.delete).toHaveBeenCalled();
        expect(deleteCalls.public.length).toBeGreaterThanOrEqual(1);
    });

    it('does not move when job has no public_url', async () => {
        const env = {};
        const jobRepo = {
            getById: vi.fn().mockResolvedValue({
                id: 2,
                status: 'UPLOADED',
                uploaded_by: 10,
                public_url: null,
                r2_raw_key: 'raw-uploads/abc.mp4',
                thumbnail_key: null,
            }),
            softDeleteJob: vi.fn().mockResolvedValue({ id: 2 }),
        };
        const rawBucket = mockBucket('raw');
        const delBucket = mockBucket('deleted');
        env.R2_RAW_UPLOADS_BUCKET = rawBucket;
        env.R2_PUBLIC_BUCKET = mockBucket('public');
        env.R2_DELETED_BUCKET = delBucket;

        const svc = new DeletionService(env, jobRepo, {
            cdnBase: 'https://cdn.bilgekarga.tr',
            rawBucket: 'R2_RAW_UPLOADS_BUCKET',
            pubBucket: 'R2_PUBLIC_BUCKET',
            delBucket: 'R2_DELETED_BUCKET',
        });

        await svc.deleteJob(2, 10, env, false);

        expect(jobRepo.softDeleteJob).toHaveBeenCalledWith(2);
        // Raw key should be moved to deleted
        expect(delBucket.put).toHaveBeenCalled();
        expect(rawBucket.delete).toHaveBeenCalled();
    });
});
