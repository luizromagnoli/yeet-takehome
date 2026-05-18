import type { Transaction } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeKyselyMock, type KyselyMock } from '../../../test/helpers/kysely-mock';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import type { BetAction, RollbackAction, WinAction } from '../values/action';
import { asActionId, asGameId, asTxId, asUserId } from '../values/ids';
import { Money } from '../values/money';
import { LedgerRepository } from './ledger.repository';

describe('LedgerRepository', () => {
  let repo: LedgerRepository;
  let trx: KyselyMock;
  const ctx: RequestContext = {
    userId: asUserId('u-1'),
    currency: 'USD',
    game: 'g',
    gameId: asGameId('game-1'),
    finished: false,
  };
  const txId = asTxId('tx-1');

  beforeEach(() => {
    repo = new LedgerRepository();
    trx = makeKyselyMock();
  });

  describe('insert', () => {
    it('inserts a bet row with amount and a null original_action_id', async () => {
      const action: BetAction = {
        kind: 'bet',
        actionId: asActionId('a-1'),
        amount: new Money(100n, 'USD'),
      };

      await repo.insert(
        trx as unknown as Transaction<Database>,
        ctx,
        action,
        txId,
        'applied',
        new Money(-100n, 'USD'),
      );

      expect(trx.insertInto).toHaveBeenCalledWith('actions');
      const row = trx.values.mock.calls[0][0] as Record<string, unknown>;
      expect(row.kind).toBe('bet');
      expect(row.amount).toBe(100n);
      expect(row.original_action_id).toBeNull();
      expect(row.status).toBe('applied');
      expect(row.balance_delta).toBe(-100n);
      expect(row.tx_id).toBe(txId);
    });

    it('inserts a win row with amount and a null original_action_id', async () => {
      const action: WinAction = {
        kind: 'win',
        actionId: asActionId('a-1'),
        amount: new Money(250n, 'USD'),
      };

      await repo.insert(
        trx as unknown as Transaction<Database>,
        ctx,
        action,
        txId,
        'applied',
        new Money(250n, 'USD'),
      );

      const row = trx.values.mock.calls[0][0] as Record<string, unknown>;
      expect(row.kind).toBe('win');
      expect(row.amount).toBe(250n);
      expect(row.original_action_id).toBeNull();
    });

    it('inserts a rollback row with null amount and the original_action_id', async () => {
      const action: RollbackAction = {
        kind: 'rollback',
        actionId: asActionId('rb-1'),
        originalActionId: asActionId('orig-1'),
      };

      await repo.insert(
        trx as unknown as Transaction<Database>,
        ctx,
        action,
        txId,
        'applied',
        new Money(100n, 'USD'),
      );

      const row = trx.values.mock.calls[0][0] as Record<string, unknown>;
      expect(row.kind).toBe('rollback');
      expect(row.amount).toBeNull();
      expect(row.original_action_id).toBe('orig-1');
    });

    it('writes the supplied status into the row', async () => {
      const action: BetAction = {
        kind: 'bet',
        actionId: asActionId('a-1'),
        amount: new Money(100n, 'USD'),
      };

      await repo.insert(
        trx as unknown as Transaction<Database>,
        ctx,
        action,
        txId,
        'noop',
        new Money(0n, 'USD'),
      );

      const row = trx.values.mock.calls[0][0] as Record<string, unknown>;
      expect(row.status).toBe('noop');
      expect(row.balance_delta).toBe(0n);
    });
  });

  describe('find', () => {
    it('queries actions with tx_id + a day window (partition-pruned)', async () => {
      const createdAt = new Date('2026-05-17T10:00:00Z');
      trx.executeTakeFirstOrThrow.mockResolvedValueOnce({
        kind: 'bet',
        status: 'applied',
        amount: 100n,
        balance_delta: -100n,
        created_at: createdAt,
        currency: 'USD',
      });

      const row = await repo.find(trx as unknown as Transaction<Database>, {
        txId,
        createdAt,
      });

      expect(row.kind).toBe('bet');
      expect(row.amount?.amount).toBe(100n);
      expect(row.balanceDelta.amount).toBe(-100n);
      expect(trx.selectFrom).toHaveBeenCalledWith('actions');
      expect(trx.where).toHaveBeenCalledWith('tx_id', '=', txId);
      // Day window covers exactly one calendar day.
      const startCall = trx.where.mock.calls.find(
        (c) => c[0] === 'created_at' && c[1] === '>=',
      );
      const endCall = trx.where.mock.calls.find(
        (c) => c[0] === 'created_at' && c[1] === '<',
      );
      expect(startCall).toBeDefined();
      expect(endCall).toBeDefined();
    });

    it('returns amount as null when the ledger row has null amount (rollback)', async () => {
      trx.executeTakeFirstOrThrow.mockResolvedValueOnce({
        kind: 'rollback',
        status: 'applied',
        amount: null,
        balance_delta: 100n,
        created_at: new Date('2026-05-17T10:00:00Z'),
        currency: 'USD',
      });

      const row = await repo.find(trx as unknown as Transaction<Database>, {
        txId,
        createdAt: new Date('2026-05-17T10:00:00Z'),
      });

      expect(row.amount).toBeNull();
    });
  });

  describe('markRolledBack', () => {
    it('sets status=rolled_back, scoped by tx_id and a day window', async () => {
      const createdAt = new Date('2026-05-17T10:00:00Z');
      await repo.markRolledBack(trx as unknown as Transaction<Database>, {
        txId,
        createdAt,
      });

      expect(trx.updateTable).toHaveBeenCalledWith('actions');
      expect(trx.where).toHaveBeenCalledWith('tx_id', '=', txId);
      expect(trx.set).toHaveBeenCalledWith({ status: 'rolled_back' });
      expect(trx.execute).toHaveBeenCalledOnce();
    });
  });
});
