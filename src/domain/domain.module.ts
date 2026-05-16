import { Module } from '@nestjs/common';
import { ActionProcessor } from './action-processor';
import { BetHandler } from './handlers/bet.handler';
import { HandlerRegistry } from './handlers/handler-registry';
import { RollbackHandler } from './handlers/rollback.handler';
import { WinHandler } from './handlers/win.handler';
import { BalanceRepository } from './repositories/balance.repository';
import { DailyStatsRepository } from './repositories/daily-stats.repository';
import { IdempotencyRepository } from './repositories/idempotency.repository';
import { LedgerRepository } from './repositories/ledger.repository';
import { PendingRollbackRepository } from './repositories/pending-rollback.repository';

@Module({
  providers: [
    BalanceRepository,
    IdempotencyRepository,
    LedgerRepository,
    PendingRollbackRepository,
    DailyStatsRepository,
    BetHandler,
    WinHandler,
    RollbackHandler,
    HandlerRegistry,
    ActionProcessor,
  ],
  exports: [ActionProcessor],
})
export class DomainModule {}
