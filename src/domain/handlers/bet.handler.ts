import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import { InsufficientFundsError } from '../errors';
import { DailyStatsRepository } from '../repositories/daily-stats.repository';
import { LedgerRepository } from '../repositories/ledger.repository';
import { PendingRollbackRepository } from '../repositories/pending-rollback.repository';
import type { BetAction } from '../values/action';
import type { TxId } from '../values/ids';
import { Money } from '../values/money';
import type { ActionHandler, ApplyOutcome } from './action-handler';

@Injectable()
export class BetHandler implements ActionHandler {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly dailyStats: DailyStatsRepository,
    private readonly pendingRollback: PendingRollbackRepository,
  ) {}

  async apply(
    trx: Transaction<Database>,
    ctx: RequestContext,
    action: BetAction,
    txId: TxId,
    runningBalance: Money,
  ): Promise<ApplyOutcome> {
    const wasPending = await this.pendingRollback.findAndDelete(
      trx,
      ctx.userId,
      action.actionId,
    );
    if (wasPending) {
      await this.ledger.insert(
        trx,
        ctx,
        action,
        txId,
        'noop',
        Money.zero(ctx.currency),
      );
      return { delta: Money.zero(ctx.currency), applied: false };
    }

    if (runningBalance.isLessThan(action.amount)) {
      throw new InsufficientFundsError();
    }
    const delta = action.amount.negate();
    await this.ledger.insert(trx, ctx, action, txId, 'applied', delta);
    await this.dailyStats.bumpBet(trx, ctx, action.amount);
    return { delta, applied: true };
  }
}
