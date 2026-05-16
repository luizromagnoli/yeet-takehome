import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import type { ActionDto } from '../../process/dto/process.dto';
import type { RequestContext } from '../action-context';

@Injectable()
export class PendingRollbackRepository {
  async insertTombstone(
    trx: Transaction<Database>,
    ctx: RequestContext,
    action: ActionDto,
    rollbackTxId: string,
  ): Promise<void> {
    if (!action.original_action_id) {
      throw new Error('rollback action requires original_action_id');
    }
    await trx
      .insertInto('pending_rollbacks')
      .values({
        user_id: ctx.user_id,
        original_action_id: action.original_action_id,
        rollback_action_id: action.action_id,
        rollback_tx_id: rollbackTxId,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'original_action_id']).doNothing(),
      )
      .execute();
  }

  /**
   * Returns true iff a tombstone existed for this (user, action_id) and was
   * just deleted. The caller treats that as "this action should become a
   * noop because a rollback for it already arrived."
   */
  async consume(
    trx: Transaction<Database>,
    userId: string,
    actionId: string,
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
