import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/types';
import { pruneExpired } from './prune-expired';

// Stub sql`` to a single vi.fn() we can program per test. The function uses
// sql`...`.execute(db) in a loop and pulls `result.rows[0].deleted`.
const sqlExecute = vi.fn();
vi.mock('kysely', async (original) => {
  const actual = await original<typeof import('kysely')>();
  const sql = Object.assign(() => ({ execute: sqlExecute }), {
    raw: actual.sql.raw,
  });
  return { ...actual, sql };
});

const db = {} as Kysely<Database>;

beforeEach(() => {
  sqlExecute.mockReset();
});

describe('pruneExpired', () => {
  it('returns the total deleted and stops on the first empty batch', async () => {
    sqlExecute
      .mockResolvedValueOnce({ rows: [{ deleted: 10_000 }] })
      .mockResolvedValueOnce({ rows: [{ deleted: 5_000 }] })
      .mockResolvedValueOnce({ rows: [{ deleted: 0 }] });

    const total = await pruneExpired(db, { retentionDays: 90 });

    expect(total).toBe(15_000);
    expect(sqlExecute).toHaveBeenCalledTimes(3);
  });

  it('returns 0 and only runs one batch when nothing matches the cutoff', async () => {
    sqlExecute.mockResolvedValueOnce({ rows: [{ deleted: 0 }] });

    const total = await pruneExpired(db, { retentionDays: 90 });

    expect(total).toBe(0);
    expect(sqlExecute).toHaveBeenCalledTimes(1);
  });

  it('respects maxBatches as a safety cap', async () => {
    sqlExecute.mockResolvedValue({ rows: [{ deleted: 100 }] });

    const total = await pruneExpired(db, {
      retentionDays: 90,
      batchSize: 100,
      maxBatches: 3,
    });

    expect(total).toBe(300);
    expect(sqlExecute).toHaveBeenCalledTimes(3);
  });

  it('treats a missing rows[0] row as zero and stops', async () => {
    sqlExecute.mockResolvedValueOnce({ rows: [] });
    const total = await pruneExpired(db, { retentionDays: 90 });
    expect(total).toBe(0);
    expect(sqlExecute).toHaveBeenCalledTimes(1);
  });
});
