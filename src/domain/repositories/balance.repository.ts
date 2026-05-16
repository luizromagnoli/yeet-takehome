import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import { CurrencyMismatchError } from '../errors';
import type { UserId } from '../values/ids';
import { Money } from '../values/money';

@Injectable()
export class BalanceRepository {
  async ensureUser(
    trx: Transaction<Database>,
    ctx: RequestContext,
  ): Promise<void> {
    await trx
      .insertInto('users')
      .values({ id: ctx.userId, currency: ctx.currency })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();

    await trx
      .insertInto('user_balances')
      .values({
        user_id: ctx.userId,
        currency: ctx.currency,
        balance: 0n,
      })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute();

    // Enforce the "a user has exactly one currency" invariant. Without this,
    // a second request with a mismatching currency would silently be a no-op
    // on the upsert and then start writing actions under the wrong currency.
    const stored = await trx
      .selectFrom('users')
      .where('id', '=', ctx.userId)
      .select('currency')
      .executeTakeFirstOrThrow();
    if (stored.currency !== ctx.currency) {
      throw new CurrencyMismatchError(ctx.currency, stored.currency);
    }
  }

  async lockBalance(
    trx: Transaction<Database>,
    userId: UserId,
  ): Promise<Money> {
    const row = await trx
      .selectFrom('user_balances')
      .where('user_id', '=', userId)
      .select(['balance', 'currency'])
      .forUpdate()
      .executeTakeFirstOrThrow();
    return new Money(row.balance, row.currency);
  }

  async update(
    trx: Transaction<Database>,
    userId: UserId,
    balance: Money,
  ): Promise<void> {
    await trx
      .updateTable('user_balances')
      .where('user_id', '=', userId)
      .set({ balance: balance.amount, updated_at: new Date() })
      .execute();
  }
}
