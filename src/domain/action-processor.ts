import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../db/types';
import type { ProcessRequestDto } from '../process/dto/process.dto';
import { buildContext } from './action-context';
import { HandlerRegistry } from './handlers/handler-registry';
import { BalanceRepository } from './repositories/balance.repository';
import { DailyStatsRepository } from './repositories/daily-stats.repository';
import { IdempotencyRepository } from './repositories/idempotency.repository';
import { toDomainAction } from './values/action';
import type { ActionId, TxId } from './values/ids';
import type { Money } from './values/money';

export interface ProcessedTransaction {
  actionId: ActionId;
  txId: TxId;
}

export interface ProcessActionsResult {
  gameId: string;
  transactions: ProcessedTransaction[];
  balance: Money;
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
    const dtos = request.actions ?? [];
    if (dtos.length === 0) {
      throw new Error('ActionProcessor.process called without actions');
    }

    const ctx = buildContext(request);
    const actions = dtos.map((dto) => toDomainAction(dto, ctx.currency));

    await this.balances.ensureUser(trx, ctx);
    let runningBalance = await this.balances.lockBalance(trx, ctx.userId);

    const transactions: ProcessedTransaction[] = [];
    let anyApplied = false;

    for (const action of actions) {
      const claim = await this.idempotency.claim(
        trx,
        ctx.userId,
        action.actionId,
      );

      transactions.push({ actionId: action.actionId, txId: claim.txId });
      if (!claim.fresh) {
        continue;
      }

      const outcome = await this.handlers
        .for(action.kind)
        .apply(trx, ctx, action, claim.txId, runningBalance);
      runningBalance = runningBalance.add(outcome.delta);
      if (outcome.applied) {
        anyApplied = true;
      }
    }

    await this.balances.update(trx, ctx.userId, runningBalance);

    if (ctx.finished && anyApplied) {
      await this.dailyStats.bumpRound(trx, ctx);
    }

    return {
      gameId: ctx.gameId,
      transactions,
      balance: runningBalance,
    };
  }
}
