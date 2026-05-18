import type { Transaction } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeKyselyMock, type KyselyMock } from '../../test-utils/kysely-mock';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import type { RollbackAction } from '../values/action';
import { asActionId, asGameId, asTxId, asUserId } from '../values/ids';
import { PendingRollbackRepository } from './pending-rollback.repository';

describe('PendingRollbackRepository', () => {
  let repo: PendingRollbackRepository;
  let trx: KyselyMock;
  const ctx: RequestContext = {
    userId: asUserId('u-1'),
    currency: 'USD',
    game: 'g',
    gameId: asGameId('game-1'),
    finished: false,
  };
  const action: RollbackAction = {
    kind: 'rollback',
    actionId: asActionId('rb-1'),
    originalActionId: asActionId('orig-1'),
  };
  const rollbackTxId = asTxId('tx-1');

  beforeEach(() => {
    repo = new PendingRollbackRepository();
    trx = makeKyselyMock();
  });

  describe('insert', () => {
    it('writes the tombstone with ON CONFLICT DO NOTHING on (user_id, original_action_id)', async () => {
      await repo.insert(trx as unknown as Transaction<Database>, ctx, action, rollbackTxId);

      expect(trx.insertInto).toHaveBeenCalledWith('pending_rollbacks');
      expect(trx.values).toHaveBeenCalledWith({
        user_id: ctx.userId,
        original_action_id: action.originalActionId,
        rollback_action_id: action.actionId,
        rollback_tx_id: rollbackTxId,
      });
      expect(trx.onConflict).toHaveBeenCalledOnce();
      expect(trx.columns).toHaveBeenCalledWith([
        'user_id',
        'original_action_id',
      ]);
      expect(trx.doNothing).toHaveBeenCalledOnce();
      expect(trx.execute).toHaveBeenCalledOnce();
    });
  });

  describe('findAndDelete', () => {
    it('returns true when a row was removed', async () => {
      trx.executeTakeFirst.mockResolvedValueOnce({ rollback_action_id: 'rb-1' });

      const result = await repo.findAndDelete(
        trx as unknown as Transaction<Database>,
        ctx.userId,
        asActionId('orig-1'),
      );

      expect(result).toBe(true);
      expect(trx.deleteFrom).toHaveBeenCalledWith('pending_rollbacks');
      expect(trx.where).toHaveBeenCalledWith('user_id', '=', ctx.userId);
      expect(trx.where).toHaveBeenCalledWith('original_action_id', '=', 'orig-1');
      expect(trx.returning).toHaveBeenCalledWith('rollback_action_id');
    });

    it('returns false when no row matched', async () => {
      trx.executeTakeFirst.mockResolvedValueOnce(undefined);

      const result = await repo.findAndDelete(
        trx as unknown as Transaction<Database>,
        ctx.userId,
        asActionId('orig-1'),
      );

      expect(result).toBe(false);
    });
  });
});
