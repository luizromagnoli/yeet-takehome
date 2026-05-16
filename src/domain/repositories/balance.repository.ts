import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';

@Injectable()
export class BalanceRepository {
  async ensureUser(
    trx: Transaction<Database>,
    ctx: RequestContext,
  ): Promise<void> {
    await trx
      .insertInto('users')
      .values({ id: ctx.user_id, currency: ctx.currency })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();

    await trx
      .insertInto('user_balances')
      .values({
        user_id: ctx.user_id,
        currency: ctx.currency,
        balance: 0n,
      })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute();
  }

  async lockBalance(
    trx: Transaction<Database>,
    userId: string,
  ): Promise<bigint> {
    const row = await trx
      .selectFrom('user_balances')
      .where('user_id', '=', userId)
      .select('balance')
      .forUpdate()
      .executeTakeFirstOrThrow();
    return row.balance;
  }

  async update(
    trx: Transaction<Database>,
    userId: string,
    balance: bigint,
  ): Promise<void> {
    await trx
      .updateTable('user_balances')
      .where('user_id', '=', userId)
      .set({ balance, updated_at: new Date() })
      .execute();
  }
}
