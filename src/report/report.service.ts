import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { KYSELY } from '../db/pool.provider';
import type { Database } from '../db/types';

const DEFAULT_LIMIT = 100;

export interface UserReportRow {
  user_id: string;
  currency: string;
  rounds: number;
  total_bet: number;
  total_win: number;
  rolled_back_bet: number;
  rolled_back_win: number;
  rtp: number | null;
}

export interface UserReportPage {
  users: UserReportRow[];
  next_cursor: string | null;
}

export interface CasinoReportRow {
  currency: string;
  rounds: number;
  total_bet: number;
  total_win: number;
  rolled_back_bet: number;
  rolled_back_win: number;
  rtp: number | null;
}

export interface CasinoReport {
  currencies: CasinoReportRow[];
}

interface DateRange {
  fromDate: string;
  toDate: string;
}

@Injectable()
export class ReportService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async userReport(
    fromIso: string,
    toIso: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<UserReportPage> {
    const range = toDayRange(fromIso, toIso);
    const effectiveLimit = limit ?? DEFAULT_LIMIT;

    const result = await sql<{
      user_id: string;
      currency: string;
      rounds: number;
      total_bet: string;
      total_win: string;
      rolled_back_bet: string;
      rolled_back_win: string;
    }>`
      SELECT
        user_id,
        currency,
        COALESCE(SUM(rounds), 0)::int             AS rounds,
        COALESCE(SUM(bets), 0)::bigint            AS total_bet,
        COALESCE(SUM(wins), 0)::bigint            AS total_win,
        COALESCE(SUM(rolled_back_bets), 0)::bigint AS rolled_back_bet,
        COALESCE(SUM(rolled_back_wins), 0)::bigint AS rolled_back_win
      FROM user_daily_stats
      WHERE day >= ${range.fromDate}::date
        AND day <  ${range.toDate}::date
        AND user_id > ${cursor ?? ''}
      GROUP BY user_id, currency
      ORDER BY user_id
      LIMIT ${effectiveLimit + 1}
    `.execute(this.db);

    const rows = result.rows.map(toUserReportRow);
    const hasMore = rows.length > effectiveLimit;
    const page = hasMore ? rows.slice(0, effectiveLimit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].user_id : null;
    return { users: page, next_cursor: nextCursor };
  }

  async casinoReport(fromIso: string, toIso: string): Promise<CasinoReport> {
    const range = toDayRange(fromIso, toIso);

    const result = await sql<{
      currency: string;
      rounds: number;
      total_bet: string;
      total_win: string;
      rolled_back_bet: string;
      rolled_back_win: string;
    }>`
      SELECT
        currency,
        COALESCE(SUM(rounds), 0)::int             AS rounds,
        COALESCE(SUM(bets), 0)::bigint            AS total_bet,
        COALESCE(SUM(wins), 0)::bigint            AS total_win,
        COALESCE(SUM(rolled_back_bets), 0)::bigint AS rolled_back_bet,
        COALESCE(SUM(rolled_back_wins), 0)::bigint AS rolled_back_win
      FROM user_daily_stats
      WHERE day >= ${range.fromDate}::date
        AND day <  ${range.toDate}::date
      GROUP BY currency
      ORDER BY currency
    `.execute(this.db);

    const currencies = result.rows.map((r) => ({
      currency: r.currency,
      rounds: r.rounds,
      total_bet: Number(r.total_bet),
      total_win: Number(r.total_win),
      rolled_back_bet: Number(r.rolled_back_bet),
      rolled_back_win: Number(r.rolled_back_win),
      rtp: computeRtp(Number(r.total_bet), Number(r.total_win)),
    }));
    return { currencies };
  }
}

function toUserReportRow(r: {
  user_id: string;
  currency: string;
  rounds: number;
  total_bet: string;
  total_win: string;
  rolled_back_bet: string;
  rolled_back_win: string;
}): UserReportRow {
  const totalBet = Number(r.total_bet);
  const totalWin = Number(r.total_win);
  return {
    user_id: r.user_id,
    currency: r.currency,
    rounds: r.rounds,
    total_bet: totalBet,
    total_win: totalWin,
    rolled_back_bet: Number(r.rolled_back_bet),
    rolled_back_win: Number(r.rolled_back_win),
    rtp: computeRtp(totalBet, totalWin),
  };
}

function computeRtp(totalBet: number, totalWin: number): number | null {
  if (totalBet === 0) return null;
  return Number((totalWin / totalBet).toFixed(4));
}

function toDayRange(fromIso: string, toIso: string): DateRange {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  // Convert datetime bounds to day bounds for the rollup. The "to" is treated
  // exclusively: midnight on a day excludes that day. A datetime mid-day for
  // "to" promotes to the next day so the partial day is fully included.
  const fromDay = from.toISOString().slice(0, 10);
  const toDay =
    to.getUTCHours() === 0 &&
    to.getUTCMinutes() === 0 &&
    to.getUTCSeconds() === 0 &&
    to.getUTCMilliseconds() === 0
      ? to.toISOString().slice(0, 10)
      : new Date(to.getTime() + 86_400_000).toISOString().slice(0, 10);
  return { fromDate: fromDay, toDate: toDay };
}
