import type { Transaction } from 'kysely';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import { DailyStatsRepository } from '../repositories/daily-stats.repository';
import { IdempotencyRepository } from '../repositories/idempotency.repository';
import type { LedgerRow } from '../repositories/ledger.repository';
import { LedgerRepository } from '../repositories/ledger.repository';
import { PendingRollbackRepository } from '../repositories/pending-rollback.repository';
import type { RollbackAction } from '../values/action';
import { asActionId, asGameId, asTxId, asUserId } from '../values/ids';
import { Money } from '../values/money';
import { RollbackHandler } from './rollback.handler';

interface Mocks {
  idempotency: { find: Mock };
  ledger: { insert: Mock; find: Mock; markRolledBack: Mock };
  dailyStats: { shiftToRolledBack: Mock };
  pendingRollback: { insert: Mock };
}

const ctx: RequestContext = {
  userId: asUserId('u-1'),
  currency: 'USD',
  game: 'g',
  gameId: asGameId('game-1'),
  finished: false,
};
const txId = asTxId('rb-tx-1');
const action: RollbackAction = {
  kind: 'rollback',
  actionId: asActionId('rb-1'),
  originalActionId: asActionId('orig-1'),
};
const trx = {} as Transaction<Database>;
const originalCreatedAt = new Date('2026-05-17T10:00:00Z');

function setup(): { handler: RollbackHandler; mocks: Mocks } {
  const mocks: Mocks = {
    idempotency: { find: vi.fn() },
    ledger: {
      insert: vi.fn().mockResolvedValue(undefined),
      find: vi.fn(),
      markRolledBack: vi.fn().mockResolvedValue(undefined),
    },
    dailyStats: { shiftToRolledBack: vi.fn().mockResolvedValue(undefined) },
    pendingRollback: { insert: vi.fn().mockResolvedValue(undefined) },
  };
  const handler = new RollbackHandler(
    mocks.idempotency as unknown as IdempotencyRepository,
    mocks.ledger as unknown as LedgerRepository,
    mocks.dailyStats as unknown as DailyStatsRepository,
    mocks.pendingRollback as unknown as PendingRollbackRepository,
  );
  return { handler, mocks };
}

describe('RollbackHandler.apply', () => {
  let handler: RollbackHandler;
  let mocks: Mocks;

  beforeEach(() => {
    ({ handler, mocks } = setup());
  });

  describe('pre-rollback (original not yet seen)', () => {
    beforeEach(() => {
      mocks.idempotency.find.mockResolvedValue(null);
    });

    it('records a pending tombstone and writes a zero-delta applied row', async () => {
      const out = await handler.apply(trx, ctx, action, txId);

      expect(out.delta.amount).toBe(0n);
      expect(mocks.pendingRollback.insert).toHaveBeenCalledWith(
        trx,
        ctx,
        action,
        txId,
      );
      expect(mocks.ledger.insert).toHaveBeenCalledTimes(1);
      const [, , , , status, delta] = mocks.ledger.insert.mock.calls[0];
      expect(status).toBe('applied');
      expect(delta.amount).toBe(0n);
    });

    it('does NOT mark anything rolled back or shift daily stats', async () => {
      await handler.apply(trx, ctx, action, txId);
      expect(mocks.ledger.markRolledBack).not.toHaveBeenCalled();
      expect(mocks.dailyStats.shiftToRolledBack).not.toHaveBeenCalled();
      expect(mocks.ledger.find).not.toHaveBeenCalled();
    });
  });

  describe('original already exists and was applied', () => {
    const original = { txId: asTxId('orig-tx'), createdAt: originalCreatedAt };
    const appliedOriginal: LedgerRow = {
      kind: 'bet',
      status: 'applied',
      amount: new Money(100n, 'USD'),
      balanceDelta: new Money(-100n, 'USD'),
      createdAt: originalCreatedAt,
    };

    beforeEach(() => {
      mocks.idempotency.find.mockResolvedValue(original);
      mocks.ledger.find.mockResolvedValue(appliedOriginal);
    });

    it('reverses the balance delta, marks the original rolled_back, writes the rollback row, shifts stats', async () => {
      const out = await handler.apply(trx, ctx, action, txId);

      expect(out.delta.amount).toBe(100n); // reversal of -100
      expect(mocks.ledger.markRolledBack).toHaveBeenCalledWith(trx, original);
      expect(mocks.ledger.insert).toHaveBeenCalledTimes(1);
      const [, , , , status, delta] = mocks.ledger.insert.mock.calls[0];
      expect(status).toBe('applied');
      expect(delta.amount).toBe(100n);
      expect(mocks.dailyStats.shiftToRolledBack).toHaveBeenCalledWith(
        trx,
        ctx,
        appliedOriginal,
      );
    });

    it('does NOT insert a pending tombstone', async () => {
      await handler.apply(trx, ctx, action, txId);
      expect(mocks.pendingRollback.insert).not.toHaveBeenCalled();
    });
  });

  describe('original exists but is already noop or already rolled_back', () => {
    const original = { txId: asTxId('orig-tx'), createdAt: originalCreatedAt };

    it.each(['noop', 'rolled_back'] as const)(
      'status=%s writes a zero-delta applied row, no balance reversal, no stat shift',
      async (status) => {
        mocks.idempotency.find.mockResolvedValue(original);
        mocks.ledger.find.mockResolvedValue({
          kind: 'bet',
          status,
          amount: new Money(100n, 'USD'),
          balanceDelta: new Money(-100n, 'USD'),
          createdAt: originalCreatedAt,
        });

        const out = await handler.apply(trx, ctx, action, txId);

        expect(out.delta.amount).toBe(0n);
        expect(mocks.ledger.markRolledBack).not.toHaveBeenCalled();
        expect(mocks.dailyStats.shiftToRolledBack).not.toHaveBeenCalled();
        const [, , , , insertedStatus, insertedDelta] =
          mocks.ledger.insert.mock.calls[0];
        expect(insertedStatus).toBe('applied');
        expect(insertedDelta.amount).toBe(0n);
      },
    );
  });
});
