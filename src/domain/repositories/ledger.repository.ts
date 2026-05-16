import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database, ActionStatus } from '../../db/types';
import type { ActionDto } from '../../process/dto/process.dto';
import type { RequestContext } from '../action-context';
import type { OriginalClaim } from './idempotency.repository';
import { nextDayUTC, startOfDayUTC } from '../util/dates';

export interface LedgerRow {
  kind: 'bet' | 'win' | 'rollback';
  status: ActionStatus;
  amount: bigint | null;
  balance_delta: bigint;
  created_at: Date;
}

@Injectable()
export class LedgerRepository {
  async insert(
    trx: Transaction<Database>,
    ctx: RequestContext,
    action: ActionDto,
    txId: string,
    status: 'applied' | 'noop',
    balanceDelta: bigint,
  ): Promise<void> {
    await trx
      .insertInto('actions')
      .values({
        tx_id: txId,
        action_id: action.action_id,
        user_id: ctx.user_id,
        currency: ctx.currency,
        game: ctx.game,
        game_id: ctx.game_id,
        kind: action.action,
        amount: action.amount !== undefined ? BigInt(action.amount) : null,
        original_action_id: action.original_action_id ?? null,
        status,
        balance_delta: balanceDelta,
      })
      .execute();
  }

  /**
   * Resolve the action row referenced by an idempotency claim. Uses a day
   * window derived from the claim so the lookup is partition-pruned (pg
   * drops sub-millisecond precision when returning timestamptz to JS, so
   * exact created_at equality is unreliable).
   */
  async find(
    trx: Transaction<Database>,
    original: OriginalClaim,
  ): Promise<LedgerRow> {
    const dayStart = startOfDayUTC(original.created_at);
    const dayEnd = nextDayUTC(dayStart);
    return trx
      .selectFrom('actions')
      .where('tx_id', '=', original.tx_id)
      .where('created_at', '>=', dayStart)
      .where('created_at', '<', dayEnd)
      .select(['kind', 'status', 'amount', 'balance_delta', 'created_at'])
      .executeTakeFirstOrThrow();
  }

  async markRolledBack(
    trx: Transaction<Database>,
    original: OriginalClaim,
    originalRowCreatedAt: Date,
  ): Promise<void> {
    await trx
      .updateTable('actions')
      .where('tx_id', '=', original.tx_id)
      .where('created_at', '=', originalRowCreatedAt)
      .set({ status: 'rolled_back' })
      .execute();
  }
}
