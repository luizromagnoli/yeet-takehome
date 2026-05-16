import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import type { ActionDto } from '../../process/dto/process.dto';
import type { RequestContext } from '../action-context';
import { DailyStatsRepository } from '../repositories/daily-stats.repository';
import { LedgerRepository } from '../repositories/ledger.repository';
import { PendingRollbackRepository } from '../repositories/pending-rollback.repository';
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
    action: ActionDto,
    txId: string,
  ): Promise<ApplyOutcome> {
    const tombstoned = await this.pendingRollback.consume(
      trx,
      ctx.user_id,
      action.action_id,
    );
    if (tombstoned) {
      await this.ledger.insert(trx, ctx, action, txId, 'noop', 0n);
      return { delta: 0n, applied: false };
    }

    const amount = BigInt(action.amount ?? 0);
    await this.ledger.insert(trx, ctx, action, txId, 'applied', amount);
    await this.dailyStats.bumpWin(trx, ctx, amount);
    return { delta: amount, applied: true };
  }
}
