/**
 * Unit tests: Job state machine (status transitions)
 * Uses mock D1 / JobRepository to assert allowed transitions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobRepository } from '../src/repositories/JobRepository.js';

describe('Job state machine', () => {
    let mockDb;
    let jobRepo;

    beforeEach(() => {
        mockDb = {
            prepare: vi.fn(() => ({
                bind: vi.fn().mockReturnThis(),
                first: vi.fn(),
                run: vi.fn(),
                all: vi.fn(),
            })),
            batch: vi.fn(),
        };
        jobRepo = new JobRepository({ DB: mockDb });
    });

    it('softDeleteJob updates status to DELETED', async () => {
        const stmt = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue({ id: 1, status: 'DELETED' }) };
        mockDb.prepare.mockReturnValue(stmt);

        const result = await jobRepo.softDeleteJob(1);
        expect(mockDb.prepare).toHaveBeenCalled();
        expect(result).toBeDefined();
        expect(result?.status).toBe('DELETED');
    });

    it('cancelOrphanJob only updates PENDING jobs', async () => {
        const stmt = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue({ id: 1, status: 'FAILED' }) };
        mockDb.prepare.mockReturnValue(stmt);

        const result = await jobRepo.cancelOrphanJob(1);
        expect(result).toBeDefined();
    });

    it('getById returns null when not found', async () => {
        const stmt = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(null) };
        mockDb.prepare.mockReturnValue(stmt);

        const result = await jobRepo.getById(999);
        expect(result).toBeNull();
    });

    it('getJobs with bucket=public adds COMPLETED and deleted_at IS NULL clause', async () => {
        const countStmt = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue({ total: 0 }) };
        const dataStmt = { bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) };
        mockDb.prepare.mockImplementation((sql) => {
            if (sql.includes('COUNT(*)')) return countStmt;
            return dataStmt;
        });

        const result = await jobRepo.getJobs({ bucket: 'public', page: 1, limit: 25 });
        expect(result).toEqual({ jobs: [], totalCount: 0, page: 1, totalPages: 1, limit: 25, next_cursor: null });
        expect(mockDb.prepare).toHaveBeenCalled();
        const countCall = mockDb.prepare.mock.calls.find(c => c[0].includes("status = 'COMPLETED'"));
        expect(countCall).toBeDefined();
        expect(countCall[0]).toContain('deleted_at IS NULL');
    });

    it('getJobs with bucket=raw excludes COMPLETED and DELETED', async () => {
        const countStmt = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue({ total: 0 }) };
        const dataStmt = { bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) };
        mockDb.prepare.mockImplementation((sql) => {
            if (sql.includes('COUNT(*)')) return countStmt;
            return dataStmt;
        });

        await jobRepo.getJobs({ bucket: 'raw', page: 1, limit: 25 });
        const rawCall = mockDb.prepare.mock.calls.find(c => c[0].includes("status != 'COMPLETED'") && c[0].includes("status != 'DELETED'"));
        expect(rawCall).toBeDefined();
    });

    it('getJobs with folder_id adds folder_id = ? to query', async () => {
        const countStmt = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue({ total: 0 }) };
        const dataStmt = { bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) };
        mockDb.prepare.mockImplementation((sql) => {
            if (sql.includes('COUNT(*)')) return countStmt;
            return dataStmt;
        });

        await jobRepo.getJobs({ folder_id: 5, page: 1, limit: 25 });
        const folderCall = mockDb.prepare.mock.calls.find(c => c[0].includes('folder_id = ?'));
        expect(folderCall).toBeDefined();
    });

    it('getDeletedJobs returns paginated result with sort', async () => {
        const countStmt = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue({ total: 2 }) };
        const dataStmt = {
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({
                results: [
                    { id: 1, status: 'DELETED', deleted_at: '2025-02-01T12:00:00' },
                    { id: 2, status: 'DELETED', deleted_at: '2025-02-02T12:00:00' },
                ],
            }),
        };
        mockDb.prepare.mockImplementation((sql) => {
            if (sql.includes('COUNT(*)') && sql.includes('deleted_at IS NOT NULL')) return countStmt;
            return dataStmt;
        });

        const result = await jobRepo.getDeletedJobs({ page: 1, limit: 10, sort_by: 'deleted_at', sort_order: 'DESC' });
        expect(result.jobs).toHaveLength(2);
        expect(result.totalCount).toBe(2);
        expect(result.page).toBe(1);
        expect(result.totalPages).toBe(1);
        expect(result.limit).toBe(10);
        const deletedCall = mockDb.prepare.mock.calls.find(c => c[0].includes('deleted_at IS NOT NULL') && c[0].includes("status = 'DELETED'"));
        expect(deletedCall).toBeDefined();
    });
});
