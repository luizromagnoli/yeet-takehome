import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import { DailyStatsRepository } from '../repositories/daily-stats.repository';
import { IdempotencyRepository } from '../repositories/idempotency.repository';
import { LedgerRepository } from '../repositories/ledger.repository';
import { PendingRollbackRepository } from '../repositories/pending-rollback.repository';
import type { RollbackAction } from '../values/action';
import type { TxId } from '../values/ids';
import { Money } from '../values/money';
import type { ActionHandler, ApplyOutcome } from './action-handler';

@Injectable()
export class RollbackHandler implements ActionHandler {
  constructor(
    private readonly idempotency: IdempotencyRepository,
    private readonly ledger: LedgerRepository,
    private readonly dailyStats: DailyStatsRepository,
    private readonly pendingRollback: PendingRollbackRepository,
  ) {}

  async apply(
    trx: Transaction<Database>,
    ctx: RequestContext,
    action: RollbackAction,
    txId: TxId,
  ): Promise<ApplyOutcome> {
    const zero = Money.zero(ctx.currency);
    const original = await this.idempotency.find(
      trx,
      ctx.userId,
      action.originalActionId,
    );

    // Pre-rollback: the original has not been seen yet. Record a pending
    // entry so the later bet/win becomes a noop, and still write this
    // rollback so retries find the same tx_id via the idempotency claim.
    if (!original) {
      await this.pendingRollback.insert(trx, ctx, action, txId);
      await this.ledger.insert(trx, ctx, action, txId, 'applied', zero);
      return { delta: zero, applied: true };
    }

    const originalRow = await this.ledger.find(trx, original);

    // Idempotent zero-delta rollback when the original is already neutralised
    // (it was a noop, or it has already been rolled back by another rollback).
    if (originalRow.status !== 'applied') {
      await this.ledger.insert(trx, ctx, action, txId, 'applied', zero);
      return { delta: zero, applied: true };
    }

    const reverseDelta = originalRow.balanceDelta.negate();
    await this.ledger.markRolledBack(trx, original);
    await this.ledger.insert(trx, ctx, action, txId, 'applied', reverseDelta);
    await this.dailyStats.shiftToRolledBack(trx, ctx, originalRow);
    return { delta: reverseDelta, applied: true };
  }
}
