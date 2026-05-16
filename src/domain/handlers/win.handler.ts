import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import { DailyStatsRepository } from '../repositories/daily-stats.repository';
import { LedgerRepository } from '../repositories/ledger.repository';
import { PendingRollbackRepository } from '../repositories/pending-rollback.repository';
import type { WinAction } from '../values/action';
import type { TxId } from '../values/ids';
import { Money } from '../values/money';
import type { ActionHandler, ApplyOutcome } from './action-handler';

@Injectable()
export class WinHandler implements ActionHandler {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly dailyStats: DailyStatsRepository,
    private readonly pendingRollback: PendingRollbackRepository,
  ) {}

  async apply(
    trx: Transaction<Database>,
    ctx: RequestContext,
    action: WinAction,
    txId: TxId,
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

    await this.ledger.insert(trx, ctx, action, txId, 'applied', action.amount);
    await this.dailyStats.bumpWin(trx, ctx, action.amount);
    return { delta: action.amount, applied: true };
  }
}
