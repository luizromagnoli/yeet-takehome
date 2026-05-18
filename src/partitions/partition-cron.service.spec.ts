import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/types';
import * as ensureModule from './ensure-partitions';
import { PartitionCronService } from './partition-cron.service';

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
  vi.restoreAllMocks();
});

describe('PartitionCronService.runDaily', () => {
  it('does NOT ensure partitions when the advisory lock is not acquired', async () => {
    sqlExecute.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    const ensureSpy = vi
      .spyOn(ensureModule, 'ensurePartitions')
      .mockResolvedValue([]);

    await new PartitionCronService(db).runDaily();

    expect(ensureSpy).not.toHaveBeenCalled();
    expect(sqlExecute).toHaveBeenCalledTimes(1); // try_advisory_lock only
  });

  it('ensures partitions for 3 months ahead when the lock is acquired and unlocks afterwards', async () => {
    sqlExecute
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [] }); // unlock
    const ensureSpy = vi
      .spyOn(ensureModule, 'ensurePartitions')
      .mockResolvedValue(['actions_2026_05']);

    await new PartitionCronService(db).runDaily();

    expect(ensureSpy).toHaveBeenCalledWith(db, { monthsAhead: 3 });
    expect(sqlExecute).toHaveBeenCalledTimes(2);
  });

  it('still unlocks when ensurePartitions throws', async () => {
    sqlExecute
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [] }); // unlock should fire
    vi.spyOn(ensureModule, 'ensurePartitions').mockRejectedValue(
      new Error('boom'),
    );

    await expect(new PartitionCronService(db).runDaily()).rejects.toThrow(
      'boom',
    );
    expect(sqlExecute).toHaveBeenCalledTimes(2);
  });
});
