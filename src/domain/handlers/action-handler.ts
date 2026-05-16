import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import type { DomainAction } from '../values/action';
import type { TxId } from '../values/ids';
import type { Money } from '../values/money';

export interface ApplyOutcome {
  delta: Money;
  applied: boolean;
}

export interface ActionHandler {
  apply(
    trx: Transaction<Database>,
    ctx: RequestContext,
    action: DomainAction,
    txId: TxId,
    runningBalance: Money,
  ): Promise<ApplyOutcome>;
}
