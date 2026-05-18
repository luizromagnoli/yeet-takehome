import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/types';
import { ensurePartitions } from './ensure-partitions';

const sqlExecute = vi.fn();
const sqlRawExecute = vi.fn();
vi.mock('kysely', async (original) => {
  const actual = await original<typeof import('kysely')>();
  const sql = Object.assign(() => ({ execute: sqlExecute }), {
    raw: () => ({ execute: sqlRawExecute }),
  });
  return { ...actual, sql };
});

const db = {} as Kysely<Database>;

beforeEach(() => {
  sqlExecute.mockReset();
  sqlRawExecute.mockReset();
});

describe('ensurePartitions', () => {
  it('issues CREATE TABLE IF NOT EXISTS for monthsAhead+1 months', async () => {
    // sql.raw().execute() for each CREATE; sql``.execute() for each exists check.
    // monthsAhead=2 → 3 iterations.
    sqlRawExecute.mockResolvedValue({ rows: [] });
    sqlExecute.mockResolvedValue({ rows: [{ exists: true }] });

    const partitions = await ensurePartitions(db, {
      monthsAhead: 2,
      reference: new Date('2026-05-17T00:00:00Z'),
    });

    expect(partitions).toEqual([
      'actions_2026_05',
      'actions_2026_06',
      'actions_2026_07',
    ]);
    expect(sqlRawExecute).toHaveBeenCalledTimes(3);
    expect(sqlExecute).toHaveBeenCalledTimes(3);
  });

  it('skips partitions where the existence check returns false', async () => {
    sqlRawExecute.mockResolvedValue({ rows: [] });
    sqlExecute
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] });

    const partitions = await ensurePartitions(db, {
      monthsAhead: 2,
      reference: new Date('2026-05-17T00:00:00Z'),
    });

    expect(partitions).toEqual(['actions_2026_05', 'actions_2026_07']);
  });

  it('defaults the reference date to now() when omitted', async () => {
    sqlRawExecute.mockResolvedValue({ rows: [] });
    sqlExecute.mockResolvedValue({ rows: [{ exists: true }] });

    const partitions = await ensurePartitions(db, { monthsAhead: 0 });

    expect(partitions).toHaveLength(1);
    expect(partitions[0]).toMatch(/^actions_\d{4}_\d{2}$/);
  });
});
