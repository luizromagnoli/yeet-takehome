import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Database } from '../db/types';
import {
  DailyStatsRepository,
  type CurrencyStatsRow,
  type UserStatsRow,
} from '../domain/repositories/daily-stats.repository';
import { ReportService } from './report.service';
import { asUserId } from '../domain/values/ids';

interface Mocks {
  dailyStats: { sumByUser: Mock; sumByCurrency: Mock };
}

const db = {} as Kysely<Database>;

function setup(): { service: ReportService; mocks: Mocks } {
  const mocks: Mocks = {
    dailyStats: { sumByUser: vi.fn(), sumByCurrency: vi.fn() },
  };
  const service = new ReportService(
    db,
    mocks.dailyStats as unknown as DailyStatsRepository,
  );
  return { service, mocks };
}

const userRow = (user_id: string, overrides: Partial<UserStatsRow> = {}): UserStatsRow => ({
  user_id: asUserId(user_id),
  currency: 'USD',
  rounds: 1,
  total_bet: 1000n,
  total_win: 950n,
  rolled_back_bet: 0n,
  rolled_back_win: 0n,
  ...overrides,
});

const currencyRow = (
  currency: string,
  overrides: Partial<CurrencyStatsRow> = {},
): CurrencyStatsRow => ({
  currency,
  rounds: 1,
  total_bet: 1000n,
  total_win: 950n,
  rolled_back_bet: 0n,
  rolled_back_win: 0n,
  ...overrides,
});

describe('ReportService', () => {
  let service: ReportService;
  let mocks: Mocks;

  beforeEach(() => {
    ({ service, mocks } = setup());
  });

  describe('userReport', () => {
    it('returns mapped rows with computed RTP and no next_cursor when below limit', async () => {
      mocks.dailyStats.sumByUser.mockResolvedValueOnce([userRow('u-1')]);

      const page = await service.userReport(
        '2026-05-17T00:00:00Z',
        '2026-05-18T00:00:00Z',
        undefined,
        100,
      );

      expect(page).toEqual({
        users: [
          {
            user_id: 'u-1',
            currency: 'USD',
            rounds: 1,
            total_bet: 1000,
            total_win: 950,
            rolled_back_bet: 0,
            rolled_back_win: 0,
            rtp: 0.95,
          },
        ],
        next_cursor: null,
      });
      // Called with limit+1 so the service can detect "did we hit the page?"
      expect(mocks.dailyStats.sumByUser).toHaveBeenCalledWith(
        db,
        '2026-05-17',
        '2026-05-18',
        '',
        101,
      );
    });

    it('returns a next_cursor when the result hit limit+1', async () => {
      mocks.dailyStats.sumByUser.mockResolvedValueOnce([
        userRow('u-1'),
        userRow('u-2'),
        userRow('u-3'), // the "+1" overflow row
      ]);

      const page = await service.userReport(
        '2026-05-17T00:00:00Z',
        '2026-05-18T00:00:00Z',
        undefined,
        2,
      );

      expect(page.users).toHaveLength(2);
      expect(page.users.map((u) => u.user_id)).toEqual(['u-1', 'u-2']);
      expect(page.next_cursor).toBe('u-2');
    });

    it('rtp is null when total_bet is zero (spec-defined behavior)', async () => {
      mocks.dailyStats.sumByUser.mockResolvedValueOnce([
        userRow('u-1', { total_bet: 0n, total_win: 0n }),
      ]);

      const page = await service.userReport(
        '2026-05-17T00:00:00Z',
        '2026-05-18T00:00:00Z',
        undefined,
        100,
      );

      expect(page.users[0].rtp).toBeNull();
    });

    it('rounds RTP to 4 decimal places', async () => {
      mocks.dailyStats.sumByUser.mockResolvedValueOnce([
        userRow('u-1', { total_bet: 30000n, total_win: 28494n }),
      ]);
      const page = await service.userReport(
        '2026-05-17T00:00:00Z',
        '2026-05-18T00:00:00Z',
        undefined,
        100,
      );
      expect(page.users[0].rtp).toBe(0.9498);
    });

    it('forwards the cursor argument to the repository', async () => {
      mocks.dailyStats.sumByUser.mockResolvedValueOnce([]);
      await service.userReport(
        '2026-05-17T00:00:00Z',
        '2026-05-18T00:00:00Z',
        'cursor-x',
        50,
      );
      const passedCursor = mocks.dailyStats.sumByUser.mock.calls[0][3];
      expect(passedCursor).toBe('cursor-x');
    });

    it('treats a midnight-aligned "to" as exclusive (same day)', async () => {
      mocks.dailyStats.sumByUser.mockResolvedValueOnce([]);
      await service.userReport(
        '2026-05-17T00:00:00Z',
        '2026-05-18T00:00:00Z',
        undefined,
        100,
      );
      const [, fromDay, toDay] = mocks.dailyStats.sumByUser.mock.calls[0];
      expect(fromDay).toBe('2026-05-17');
      expect(toDay).toBe('2026-05-18');
    });

    it('promotes a mid-day "to" to the next day so the partial day is fully included', async () => {
      mocks.dailyStats.sumByUser.mockResolvedValueOnce([]);
      await service.userReport(
        '2026-05-17T00:00:00Z',
        '2026-05-17T23:59:59Z',
        undefined,
        100,
      );
      const [, fromDay, toDay] = mocks.dailyStats.sumByUser.mock.calls[0];
      expect(fromDay).toBe('2026-05-17');
      expect(toDay).toBe('2026-05-18');
    });
  });

  describe('casinoReport', () => {
    it('groups by currency, computes RTP, has no pagination', async () => {
      mocks.dailyStats.sumByCurrency.mockResolvedValueOnce([
        currencyRow('USD'),
        currencyRow('EUR', { total_bet: 2000n, total_win: 1800n }),
      ]);

      const report = await service.casinoReport(
        '2026-05-17T00:00:00Z',
        '2026-05-18T00:00:00Z',
      );

      expect(report.currencies).toHaveLength(2);
      expect(report.currencies[0].rtp).toBe(0.95);
      expect(report.currencies[1].rtp).toBe(0.9);
    });

    it('returns rtp=null on zero-bet currencies', async () => {
      mocks.dailyStats.sumByCurrency.mockResolvedValueOnce([
        currencyRow('USD', { total_bet: 0n, total_win: 0n }),
      ]);
      const report = await service.casinoReport(
        '2026-05-17T00:00:00Z',
        '2026-05-18T00:00:00Z',
      );
      expect(report.currencies[0].rtp).toBeNull();
    });
  });
});
