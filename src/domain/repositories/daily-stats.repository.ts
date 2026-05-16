import { Injectable } from '@nestjs/common';
import { type Kysely, type Transaction, sql } from 'kysely';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import type { UserId } from '../values/ids';
import { Money } from '../values/money';
import type { LedgerRow } from './ledger.repository';
import { isoDate } from '../util/dates';

export interface UserStatsRow {
  user_id: UserId;
  currency: string;
  rounds: number;
  total_bet: bigint;
  total_win: bigint;
  rolled_back_bet: bigint;
  rolled_back_win: bigint;
}

export interface CurrencyStatsRow {
  currency: string;
  rounds: number;
  total_bet: bigint;
  total_win: bigint;
  rolled_back_bet: bigint;
  rolled_back_win: bigint;
}

@Injectable()
export class DailyStatsRepository {
  async bumpBet(
    trx: Transaction<Database>,
    ctx: RequestContext,
    amount: Money,
  ): Promise<void> {
    const day = isoDate(new Date());
    await trx
      .insertInto('user_daily_stats')
      .values({
        user_id: ctx.userId,
        currency: ctx.currency,
        day,
        bets: amount.amount,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'currency', 'day']).doUpdateSet({
          bets: sql<bigint>`user_daily_stats.bets + ${amount.amount}`,
        }),
      )
      .execute();
  }

  async bumpWin(
    trx: Transaction<Database>,
    ctx: RequestContext,
    amount: Money,
  ): Promise<void> {
    const day = isoDate(new Date());
    await trx
      .insertInto('user_daily_stats')
      .values({
        user_id: ctx.userId,
        currency: ctx.currency,
        day,
        wins: amount.amount,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'currency', 'day']).doUpdateSet({
          wins: sql<bigint>`user_daily_stats.wins + ${amount.amount}`,
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
        user_id: ctx.userId,
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
    const day = isoDate(original.createdAt);
    const amount = original.amount?.amount ?? 0n;
    if (original.kind === 'bet') {
      await trx
        .updateTable('user_daily_stats')
        .where('user_id', '=', ctx.userId)
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
        .where('user_id', '=', ctx.userId)
        .where('currency', '=', ctx.currency)
        .where('day', '=', day)
        .set({
          wins: sql<bigint>`wins - ${amount}`,
          rolled_back_wins: sql<bigint>`rolled_back_wins + ${amount}`,
        })
        .execute();
    }
  }

  /**
   * Per-user RTP aggregation for the date range, keyset-paginated on
   * user_id. The caller passes `limit + 1` if it wants the standard
   * "did we hit the page boundary?" check.
   */
  async sumByUser(
    db: Kysely<Database>,
    fromDate: string,
    toDate: string,
    cursor: string,
    limit: number,
  ): Promise<UserStatsRow[]> {
    const result = await sql<UserStatsRow>`
      SELECT
        user_id,
        currency,
        COALESCE(SUM(rounds), 0)::int              AS rounds,
        COALESCE(SUM(bets), 0)::bigint             AS total_bet,
        COALESCE(SUM(wins), 0)::bigint             AS total_win,
        COALESCE(SUM(rolled_back_bets), 0)::bigint AS rolled_back_bet,
        COALESCE(SUM(rolled_back_wins), 0)::bigint AS rolled_back_win
      FROM user_daily_stats
      WHERE day >= ${fromDate}::date
        AND day <  ${toDate}::date
        AND user_id > ${cursor}
      GROUP BY user_id, currency
      ORDER BY user_id
      LIMIT ${limit}
    `.execute(db);
    return result.rows;
  }

  /**
   * Casino-wide RTP aggregation grouped by currency. No pagination — the
   * cardinality is fixed by the number of currencies in play.
   */
  async sumByCurrency(
    db: Kysely<Database>,
    fromDate: string,
    toDate: string,
  ): Promise<CurrencyStatsRow[]> {
    const result = await sql<CurrencyStatsRow>`
      SELECT
        currency,
        COALESCE(SUM(rounds), 0)::int              AS rounds,
        COALESCE(SUM(bets), 0)::bigint             AS total_bet,
        COALESCE(SUM(wins), 0)::bigint             AS total_win,
        COALESCE(SUM(rolled_back_bets), 0)::bigint AS rolled_back_bet,
        COALESCE(SUM(rolled_back_wins), 0)::bigint AS rolled_back_win
      FROM user_daily_stats
      WHERE day >= ${fromDate}::date
        AND day <  ${toDate}::date
      GROUP BY currency
      ORDER BY currency
    `.execute(db);
    return result.rows;
  }
}
