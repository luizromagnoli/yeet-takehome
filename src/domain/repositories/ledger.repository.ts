import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { ActionStatus, Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import type { TxId } from '../values/ids';
import { Money } from '../values/money';
import type { DomainAction } from '../values/action';
import type { OriginalClaim } from './idempotency.repository';
import { nextDayUTC, startOfDayUTC } from '../util/dates';

export interface LedgerRow {
  kind: 'bet' | 'win' | 'rollback';
  status: ActionStatus;
  amount: Money | null;
  balanceDelta: Money;
  createdAt: Date;
}

@Injectable()
export class LedgerRepository {
  async insert(
    trx: Transaction<Database>,
    ctx: RequestContext,
    action: DomainAction,
    txId: TxId,
    status: 'applied' | 'noop',
    balanceDelta: Money,
  ): Promise<void> {
    const amount =
      action.kind === 'rollback' ? null : action.amount.amount;
    const originalActionId =
      action.kind === 'rollback' ? action.originalActionId : null;

    await trx
      .insertInto('actions')
      .values({
        tx_id: txId,
        action_id: action.actionId,
        user_id: ctx.userId,
        currency: ctx.currency,
        game: ctx.game,
        game_id: ctx.gameId,
        kind: action.kind,
        amount,
        original_action_id: originalActionId,
        status,
        balance_delta: balanceDelta.amount,
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
    const dayStart = startOfDayUTC(original.createdAt);
    const dayEnd = nextDayUTC(dayStart);
    const row = await trx
      .selectFrom('actions')
      .where('tx_id', '=', original.txId)
      .where('created_at', '>=', dayStart)
      .where('created_at', '<', dayEnd)
      .select([
        'kind',
        'status',
        'amount',
        'balance_delta',
        'created_at',
        'currency',
      ])
      .executeTakeFirstOrThrow();
    return {
      kind: row.kind,
      status: row.status,
      amount: row.amount === null ? null : new Money(row.amount, row.currency),
      balanceDelta: new Money(row.balance_delta, row.currency),
      createdAt: row.created_at,
    };
  }

  async markRolledBack(
    trx: Transaction<Database>,
    original: OriginalClaim,
    originalRowCreatedAt: Date,
  ): Promise<void> {
    await trx
      .updateTable('actions')
      .where('tx_id', '=', original.txId)
      .where('created_at', '=', originalRowCreatedAt)
      .set({ status: 'rolled_back' })
      .execute();
  }
}
