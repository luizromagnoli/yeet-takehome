import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../db/types';
import type { ProcessRequestDto } from '../process/dto/process.dto';
import { buildContext } from './action-context';
import { HandlerRegistry } from './handlers/handler-registry';
import { BalanceRepository } from './repositories/balance.repository';
import { DailyStatsRepository } from './repositories/daily-stats.repository';
import { IdempotencyRepository } from './repositories/idempotency.repository';

export interface ProcessedTransaction {
  action_id: string;
  tx_id: string;
}

export interface ProcessActionsResult {
  game_id: string;
  transactions: ProcessedTransaction[];
  balance: bigint;
}

@Injectable()
export class ActionProcessor {
  constructor(
    private readonly balances: BalanceRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly dailyStats: DailyStatsRepository,
    private readonly handlers: HandlerRegistry,
  ) {}

  async process(
    trx: Transaction<Database>,
    request: ProcessRequestDto,
  ): Promise<ProcessActionsResult> {
    const actions = request.actions ?? [];
    if (actions.length === 0) {
      throw new Error('ActionProcessor.process called without actions');
    }

    const ctx = buildContext(request);
    await this.balances.ensureUser(trx, ctx);
    let runningBalance = await this.balances.lockBalance(trx, ctx.user_id);

    const transactions: ProcessedTransaction[] = [];
    let anyApplied = false;

    for (const action of actions) {
      const claim = await this.idempotency.claim(
        trx,
        ctx.user_id,
        action.action_id,
      );
      transactions.push({ action_id: action.action_id, tx_id: claim.tx_id });
      if (!claim.fresh) {
        continue;
      }

      const outcome = await this.handlers
        .for(action.action)
        .apply(trx, ctx, action, claim.tx_id, runningBalance);
      runningBalance += outcome.delta;
      if (outcome.applied) {
        anyApplied = true;
      }
    }

    await this.balances.update(trx, ctx.user_id, runningBalance);

    if (ctx.finished && anyApplied) {
      await this.dailyStats.bumpRound(trx, ctx);
    }

    return {
      game_id: ctx.game_id,
      transactions,
      balance: runningBalance,
    };
  }
}
