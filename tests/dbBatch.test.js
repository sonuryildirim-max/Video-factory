/**
 * Unit tests: D1 db.batch() transaction success
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('db.batch() transaction', () => {
    /** @type {import('vitest').Mock} */
    let batchMock;
    /** @type {{ prepare: (sql: string) => { bind: (...args: unknown[]) => unknown } }} */
    let db;

    beforeEach(() => {
        batchMock = vi.fn();
        db = {
            prepare: vi.fn((sql) => ({
                bind: vi.fn((...args) => ({ _sql: sql, _args: args })),
            })),
            batch: batchMock,
        };
    });

    it('batch returns results for BEGIN + statements + COMMIT', async () => {
        const stmt1 = db.prepare('UPDATE t SET x = 1').bind();
        const stmt2 = db.prepare('INSERT INTO t (y) VALUES (?)').bind(2);
        batchMock.mockResolvedValue([
            { meta: { changes: 0 } },  // BEGIN
            { meta: { changes: 1 } },  // stmt1
            { meta: { changes: 1 } },  // stmt2
            { meta: { changes: 0 } },  // COMMIT
        ]);

        const statements = [stmt1, stmt2];
        const withBoundaries = [
            db.prepare('BEGIN'),
            ...statements,
            db.prepare('COMMIT'),
        ];
        const results = await db.batch(withBoundaries);

        expect(batchMock).toHaveBeenCalledTimes(1);
        expect(results).toHaveLength(4);
        expect(results[1].meta.changes).toBe(1);
        expect(results[2].meta.changes).toBe(1);
    });

    it('batch success represents transaction commit', async () => {
        batchMock.mockResolvedValue([
            { meta: {} },
            { meta: { changes: 1 } },
            { meta: {} },
        ]);

        const results = await db.batch([
            db.prepare('BEGIN'),
            db.prepare('UPDATE conversion_jobs SET status = ? WHERE id = ?').bind('DELETED', 1),
            db.prepare('COMMIT'),
        ]);

        expect(results.length).toBe(3);
        expect(results[1].meta.changes).toBe(1);
    });
});
