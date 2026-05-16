import { Injectable } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import type { LedgerRow } from './ledger.repository';
import { isoDate } from '../util/dates';

@Injectable()
export class DailyStatsRepository {
  async bumpBet(
    trx: Transaction<Database>,
    ctx: RequestContext,
    amount: bigint,
  ): Promise<void> {
    const day = isoDate(new Date());
    await trx
      .insertInto('user_daily_stats')
      .values({
        user_id: ctx.user_id,
        currency: ctx.currency,
        day,
        bets: amount,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'currency', 'day']).doUpdateSet({
          bets: sql<bigint>`user_daily_stats.bets + ${amount}`,
        }),
      )
      .execute();
  }

  async bumpWin(
    trx: Transaction<Database>,
    ctx: RequestContext,
    amount: bigint,
  ): Promise<void> {
    const day = isoDate(new Date());
    await trx
      .insertInto('user_daily_stats')
      .values({
        user_id: ctx.user_id,
        currency: ctx.currency,
        day,
        wins: amount,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'currency', 'day']).doUpdateSet({
          wins: sql<bigint>`user_daily_stats.wins + ${amount}`,
        }),
      )
      .execute();
  }

  async bumpRound(
    trx: Transaction<Database>,
    ctx: RequestContext,
  ): Promise<void> {
    const day = isoDate(new Date());
    await trx
      .insertInto('user_daily_stats')
      .values({
        user_id: ctx.user_id,
        currency: ctx.currency,
        day,
        rounds: 1,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'currency', 'day']).doUpdateSet({
          rounds: sql<number>`user_daily_stats.rounds + 1`,
        }),
      )
      .execute();
  }

  /**
   * Moves an original action's amount from the bets/wins counters into the
   * rolled_back_bets/rolled_back_wins counters on the day it was originally
   * recorded. Used when a rollback reverses an applied bet or win.
   */
  async shiftToRolledBack(
    trx: Transaction<Database>,
    ctx: RequestContext,
    original: LedgerRow,
  ): Promise<void> {
    const day = isoDate(original.created_at);
    const amount = original.amount ?? 0n;
    if (original.kind === 'bet') {
      await trx
        .updateTable('user_daily_stats')
        .where('user_id', '=', ctx.user_id)
        .where('currency', '=', ctx.currency)
        .where('day', '=', day)
        .set({
          bets: sql<bigint>`bets - ${amount}`,
          rolled_back_bets: sql<bigint>`rolled_back_bets + ${amount}`,
        })
        .execute();
    } else if (original.kind === 'win') {
      await trx
        .updateTable('user_daily_stats')
        .where('user_id', '=', ctx.user_id)
        .where('currency', '=', ctx.currency)
        .where('day', '=', day)
        .set({
          wins: sql<bigint>`wins - ${amount}`,
          rolled_back_wins: sql<bigint>`rolled_back_wins + ${amount}`,
        })
        .execute();
    }
  }
}
