import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import type { ActionDto } from '../../process/dto/process.dto';
import type { RequestContext } from '../action-context';

export interface ApplyOutcome {
  delta: bigint;
  applied: boolean;
}

export interface ActionHandler {
  apply(
    trx: Transaction<Database>,
    ctx: RequestContext,
    action: ActionDto,
    txId: string,
    runningBalance: bigint,
  ): Promise<ApplyOutcome>;
}
