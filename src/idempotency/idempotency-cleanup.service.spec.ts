import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/types';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import * as pruneModule from './prune-expired';

const sqlExecute = vi.fn();
vi.mock('kysely', async (original) => {
  const actual = await original<typeof import('kysely')>();
  const sql = Object.assign(() => ({ execute: sqlExecute }), {
    raw: actual.sql.raw,
  });
  return { ...actual, sql };
});

const db = {} as Kysely<Database>;
const originalEnv = process.env.ACTION_IDEMPOTENCY_RETENTION_DAYS;

beforeEach(() => {
  sqlExecute.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.ACTION_IDEMPOTENCY_RETENTION_DAYS;
  } else {
    process.env.ACTION_IDEMPOTENCY_RETENTION_DAYS = originalEnv;
  }
});

describe('IdempotencyCleanupService.runDaily', () => {
  it('does NOT prune when the advisory lock is not acquired', async () => {
    sqlExecute.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    const pruneSpy = vi
      .spyOn(pruneModule, 'pruneExpired')
      .mockResolvedValue(0);

    const service = new IdempotencyCleanupService(db);
    await service.runDaily();

    expect(pruneSpy).not.toHaveBeenCalled();
    // Only the try_advisory_lock query ran — no unlock follow-up.
    expect(sqlExecute).toHaveBeenCalledTimes(1);
  });

  it('prunes and unlocks when the lock is acquired', async () => {
    sqlExecute
      .mockResolvedValueOnce({ rows: [{ acquired: true }] }) // try_advisory_lock
      .mockResolvedValueOnce({ rows: [] }); // pg_advisory_unlock
    const pruneSpy = vi
      .spyOn(pruneModule, 'pruneExpired')
      .mockResolvedValue(42);

    const service = new IdempotencyCleanupService(db);
    await service.runDaily();

    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ retentionDays: 90 }),
    );
    // Lock + unlock both happened.
    expect(sqlExecute).toHaveBeenCalledTimes(2);
  });

  it('honours ACTION_IDEMPOTENCY_RETENTION_DAYS env override', async () => {
    process.env.ACTION_IDEMPOTENCY_RETENTION_DAYS = '30';
    sqlExecute
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const pruneSpy = vi
      .spyOn(pruneModule, 'pruneExpired')
      .mockResolvedValue(0);

    await new IdempotencyCleanupService(db).runDaily();

    expect(pruneSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ retentionDays: 30 }),
    );
  });

  it('still unlocks when pruneExpired throws', async () => {
    sqlExecute
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [] }); // unlock should still fire
    vi.spyOn(pruneModule, 'pruneExpired').mockRejectedValue(
      new Error('boom'),
    );

    const service = new IdempotencyCleanupService(db);
    await expect(service.runDaily()).rejects.toThrow('boom');
    expect(sqlExecute).toHaveBeenCalledTimes(2);
  });
});
