import { ServiceUnavailableException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/types';
import { HealthController } from './health.controller';

// Stub the sql tagged template so .execute() goes through one vi.fn() we
// fully control — rather than fighting Kysely's real compile-then-executeQuery
// path with a partial mock.
const sqlExecute = vi.fn();
vi.mock('kysely', async (original) => {
  const actual = await original<typeof import('kysely')>();
  const sql = Object.assign(() => ({ execute: sqlExecute }), {
    raw: actual.sql.raw,
  });
  return { ...actual, sql };
});

describe('HealthController', () => {
  let db: { __marker: 'db' };
  let controller: HealthController;

  beforeEach(() => {
    sqlExecute.mockReset();
    db = { __marker: 'db' };
    controller = new HealthController(db as unknown as Kysely<Database>);
  });

  describe('health', () => {
    it('returns ok without touching the database', () => {
      expect(controller.health()).toEqual({ status: 'ok' });
      // Liveness is synchronous and must never run any SQL.
      expect(sqlExecute).not.toHaveBeenCalled();
    });
  });

  describe('ready', () => {
    it('returns ok when the SELECT 1 ping succeeds', async () => {
      sqlExecute.mockResolvedValueOnce({ rows: [] });
      const res = await controller.ready();
      expect(res).toEqual({ status: 'ok' });
      expect(sqlExecute).toHaveBeenCalledOnce();
      expect(sqlExecute).toHaveBeenCalledWith(db);
    });

    it('throws ServiceUnavailableException when the DB ping fails', async () => {
      sqlExecute.mockRejectedValueOnce(new Error('connection refused'));
      await expect(controller.ready()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
