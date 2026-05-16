import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import type { ActionId, TxId, UserId } from '../values/ids';
import type { RollbackAction } from '../values/action';

@Injectable()
export class PendingRollbackRepository {
  async insert(
    trx: Transaction<Database>,
    ctx: RequestContext,
    action: RollbackAction,
    rollbackTxId: TxId,
  ): Promise<void> {
    await trx
      .insertInto('pending_rollbacks')
      .values({
        user_id: ctx.userId,
        original_action_id: action.originalActionId,
        rollback_action_id: action.actionId,
        rollback_tx_id: rollbackTxId,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'original_action_id']).doNothing(),
      )
      .execute();
  }

  /**
   * Atomically finds and deletes the row matching (user, action_id) if one
   * exists. Returns true when a row was removed — the caller treats that as
   * "this action should become a noop because a rollback for it already
   * arrived."
   */
  async findAndDelete(
    trx: Transaction<Database>,
    userId: UserId,
    actionId: ActionId,
  ): Promise<boolean> {
    const deleted = await trx
      .deleteFrom('pending_rollbacks')
      .where('user_id', '=', userId)
      .where('original_action_id', '=', actionId)
      .returning('rollback_action_id')
      .executeTakeFirst();
    return deleted !== undefined;
  }
}
