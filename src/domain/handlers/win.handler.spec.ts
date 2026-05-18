import type { Transaction } from 'kysely';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import { DailyStatsRepository } from '../repositories/daily-stats.repository';
import { LedgerRepository } from '../repositories/ledger.repository';
import { PendingRollbackRepository } from '../repositories/pending-rollback.repository';
import type { WinAction } from '../values/action';
import { asActionId, asGameId, asTxId, asUserId } from '../values/ids';
import { Money } from '../values/money';
import { WinHandler } from './win.handler';

interface Mocks {
  ledger: { insert: Mock };
  dailyStats: { bumpWin: Mock };
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
const action: WinAction = {
  kind: 'win',
  actionId: asActionId('a-1'),
  amount: new Money(250n, 'USD'),
};
const trx = {} as Transaction<Database>;

function setup(): { handler: WinHandler; mocks: Mocks } {
  const mocks: Mocks = {
    ledger: { insert: vi.fn().mockResolvedValue(undefined) },
    dailyStats: { bumpWin: vi.fn().mockResolvedValue(undefined) },
    pendingRollback: { findAndDelete: vi.fn() },
  };
  const handler = new WinHandler(
    mocks.ledger as unknown as LedgerRepository,
    mocks.dailyStats as unknown as DailyStatsRepository,
    mocks.pendingRollback as unknown as PendingRollbackRepository,
  );
  return { handler, mocks };
}

describe('WinHandler.apply', () => {
  let handler: WinHandler;
  let mocks: Mocks;

  beforeEach(() => {
    ({ handler, mocks } = setup());
  });

  describe('with a pending rollback for this action_id', () => {
    beforeEach(() => {
      mocks.pendingRollback.findAndDelete.mockResolvedValue(true);
    });

    it('returns delta=zero and writes a noop ledger row', async () => {
      const out = await handler.apply(trx, ctx, action, txId);
      expect(out.delta.amount).toBe(0n);
      const [, , , , status, delta] = mocks.ledger.insert.mock.calls[0];
      expect(status).toBe('noop');
      expect(delta.amount).toBe(0n);
    });

    it('does NOT bump the wins counter', async () => {
      await handler.apply(trx, ctx, action, txId);
      expect(mocks.dailyStats.bumpWin).not.toHaveBeenCalled();
    });
  });

  describe('with no pending rollback', () => {
    beforeEach(() => {
      mocks.pendingRollback.findAndDelete.mockResolvedValue(false);
    });

    it('returns delta=+amount and writes an applied ledger row', async () => {
      const out = await handler.apply(trx, ctx, action, txId);
      expect(out.delta.amount).toBe(250n);
      const [, , , , status, delta] = mocks.ledger.insert.mock.calls[0];
      expect(status).toBe('applied');
      expect(delta.amount).toBe(250n);
    });

    it('bumps the wins counter for the day', async () => {
      await handler.apply(trx, ctx, action, txId);
      expect(mocks.dailyStats.bumpWin).toHaveBeenCalledTimes(1);
      const passed = mocks.dailyStats.bumpWin.mock.calls[0][2] as Money;
      expect(passed.amount).toBe(250n);
    });
  });
});
