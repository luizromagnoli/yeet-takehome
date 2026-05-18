import type { Transaction } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeKyselyMock, type KyselyMock } from '../../test-utils/kysely-mock';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import { asGameId, asUserId } from '../values/ids';
import { Money } from '../values/money';
import type { LedgerRow } from './ledger.repository';
import { DailyStatsRepository } from './daily-stats.repository';

describe('DailyStatsRepository', () => {
  let repo: DailyStatsRepository;
  let trx: KyselyMock;
  const ctx: RequestContext = {
    userId: asUserId('u-1'),
    currency: 'USD',
    game: 'g',
    gameId: asGameId('game-1'),
    finished: false,
  };

  beforeEach(() => {
    repo = new DailyStatsRepository();
    trx = makeKyselyMock();
  });

  describe('bumpBet', () => {
    it('upserts the day row, adding to the bets counter on conflict', async () => {
      await repo.bumpBet(
        trx as unknown as Transaction<Database>,
        ctx,
        new Money(100n, 'USD'),
      );

      expect(trx.insertInto).toHaveBeenCalledWith('user_daily_stats');
      const written = trx.values.mock.calls[0][0] as { bets: bigint };
      expect(written.bets).toBe(100n);
      expect(trx.columns).toHaveBeenCalledWith(['user_id', 'currency', 'day']);
      expect(trx.doUpdateSet).toHaveBeenCalledOnce();
      // Does NOT touch wins or rounds.
      expect(trx.set).not.toHaveBeenCalled();
    });
  });

  describe('bumpWin', () => {
    it('upserts the day row, adding to the wins counter on conflict', async () => {
      await repo.bumpWin(
        trx as unknown as Transaction<Database>,
        ctx,
        new Money(250n, 'USD'),
      );

      const written = trx.values.mock.calls[0][0] as { wins: bigint };
      expect(written.wins).toBe(250n);
      expect(trx.doUpdateSet).toHaveBeenCalledOnce();
    });
  });

  describe('bumpRound', () => {
    it('upserts the day row, adding 1 to the rounds counter on conflict', async () => {
      await repo.bumpRound(trx as unknown as Transaction<Database>, ctx);

      const written = trx.values.mock.calls[0][0] as { rounds: number };
      expect(written.rounds).toBe(1);
      expect(trx.doUpdateSet).toHaveBeenCalledOnce();
    });
  });

  describe('shiftToRolledBack', () => {
    it('moves a bet amount from bets into rolled_back_bets on the original day', async () => {
      const original: LedgerRow = {
        kind: 'bet',
        status: 'applied',
        amount: new Money(100n, 'USD'),
        balanceDelta: new Money(-100n, 'USD'),
        createdAt: new Date('2026-05-17T10:00:00Z'),
      };

      await repo.shiftToRolledBack(
        trx as unknown as Transaction<Database>,
        ctx,
        original,
      );

      expect(trx.updateTable).toHaveBeenCalledWith('user_daily_stats');
      expect(trx.where).toHaveBeenCalledWith('user_id', '=', ctx.userId);
      expect(trx.where).toHaveBeenCalledWith('currency', '=', ctx.currency);
      expect(trx.where).toHaveBeenCalledWith('day', '=', '2026-05-17');
      expect(trx.set).toHaveBeenCalledOnce();
      expect(trx.execute).toHaveBeenCalledOnce();
    });

    it('moves a win amount from wins into rolled_back_wins on the original day', async () => {
      const original: LedgerRow = {
        kind: 'win',
        status: 'applied',
        amount: new Money(250n, 'USD'),
        balanceDelta: new Money(250n, 'USD'),
        createdAt: new Date('2026-05-17T10:00:00Z'),
      };

      await repo.shiftToRolledBack(
        trx as unknown as Transaction<Database>,
        ctx,
        original,
      );

      expect(trx.updateTable).toHaveBeenCalledWith('user_daily_stats');
      expect(trx.set).toHaveBeenCalledOnce();
    });

    it('does not write when the original is a rollback row itself', async () => {
      const original: LedgerRow = {
        kind: 'rollback',
        status: 'applied',
        amount: null,
        balanceDelta: new Money(0n, 'USD'),
        createdAt: new Date('2026-05-17T10:00:00Z'),
      };

      await repo.shiftToRolledBack(
        trx as unknown as Transaction<Database>,
        ctx,
        original,
      );

      expect(trx.updateTable).not.toHaveBeenCalled();
      expect(trx.set).not.toHaveBeenCalled();
      expect(trx.execute).not.toHaveBeenCalled();
    });
  });

  // sumByUser and sumByCurrency run raw sql`` templates that bypass the
  // chainable builder mock — they're covered by the reporting integration
  // tests in test/reporting/accuracy.spec.ts where they hit a real Postgres.
});
