import type { Transaction } from 'kysely';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import { InsufficientFundsError } from '../errors';
import { DailyStatsRepository } from '../repositories/daily-stats.repository';
import { LedgerRepository } from '../repositories/ledger.repository';
import { PendingRollbackRepository } from '../repositories/pending-rollback.repository';
import type { BetAction } from '../values/action';
import { asActionId, asGameId, asTxId, asUserId } from '../values/ids';
import { Money } from '../values/money';
import { BetHandler } from './bet.handler';

interface Mocks {
  ledger: { insert: Mock };
  dailyStats: { bumpBet: Mock };
  pendingRollback: { findAndDelete: Mock };
}

const ctx: RequestContext = {
  userId: asUserId('u-1'),
  currency: 'USD',
  game: 'g',
  gameId: asGameId('game-1'),
  finished: false,
};
const txId = asTxId('tx-1');
const action: BetAction = {
  kind: 'bet',
  actionId: asActionId('a-1'),
  amount: new Money(100n, 'USD'),
};
const trx = {} as Transaction<Database>;

function setup(): { handler: BetHandler; mocks: Mocks } {
  const mocks: Mocks = {
    ledger: { insert: vi.fn().mockResolvedValue(undefined) },
    dailyStats: { bumpBet: vi.fn().mockResolvedValue(undefined) },
    pendingRollback: { findAndDelete: vi.fn() },
  };
  const handler = new BetHandler(
    mocks.ledger as unknown as LedgerRepository,
    mocks.dailyStats as unknown as DailyStatsRepository,
    mocks.pendingRollback as unknown as PendingRollbackRepository,
  );
  return { handler, mocks };
}

describe('BetHandler.apply', () => {
  let handler: BetHandler;
  let mocks: Mocks;

  beforeEach(() => {
    ({ handler, mocks } = setup());
  });

  describe('with a pending rollback for this action_id', () => {
    beforeEach(() => {
      mocks.pendingRollback.findAndDelete.mockResolvedValue(true);
    });

    it('returns delta=zero and writes a noop ledger row', async () => {
      const out = await handler.apply(
        trx,
        ctx,
        action,
        txId,
        new Money(500n, 'USD'),
      );

      expect(out.delta.amount).toBe(0n);
      expect(mocks.ledger.insert).toHaveBeenCalledTimes(1);
      const [, , , , status, delta] = mocks.ledger.insert.mock.calls[0];
      expect(status).toBe('noop');
      expect(delta.amount).toBe(0n);
    });

    it('does NOT bump daily stats', async () => {
      await handler.apply(trx, ctx, action, txId, new Money(500n, 'USD'));
      expect(mocks.dailyStats.bumpBet).not.toHaveBeenCalled();
    });
  });

  describe('with no pending rollback', () => {
    beforeEach(() => {
      mocks.pendingRollback.findAndDelete.mockResolvedValue(false);
    });

    it('returns delta=-amount and writes an applied ledger row', async () => {
      const out = await handler.apply(
        trx,
        ctx,
        action,
        txId,
        new Money(500n, 'USD'),
      );

      expect(out.delta.amount).toBe(-100n);
      expect(mocks.ledger.insert).toHaveBeenCalledTimes(1);
      const [, , , , status, delta] = mocks.ledger.insert.mock.calls[0];
      expect(status).toBe('applied');
      expect(delta.amount).toBe(-100n);
    });

    it('bumps the bets counter for the day', async () => {
      await handler.apply(trx, ctx, action, txId, new Money(500n, 'USD'));
      expect(mocks.dailyStats.bumpBet).toHaveBeenCalledTimes(1);
      const passed = mocks.dailyStats.bumpBet.mock.calls[0][2] as Money;
      expect(passed.amount).toBe(100n);
    });

    it('throws InsufficientFundsError when balance < amount', async () => {
      await expect(
        handler.apply(trx, ctx, action, txId, new Money(50n, 'USD')),
      ).rejects.toBeInstanceOf(InsufficientFundsError);
    });

    it('does NOT write a ledger row or bump stats on insufficient funds', async () => {
      await expect(
        handler.apply(trx, ctx, action, txId, new Money(50n, 'USD')),
      ).rejects.toThrow();
      expect(mocks.ledger.insert).not.toHaveBeenCalled();
      expect(mocks.dailyStats.bumpBet).not.toHaveBeenCalled();
    });
  });
});
