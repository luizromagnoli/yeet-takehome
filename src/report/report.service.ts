import { Inject, Injectable } from '@nestjs/common';
import { type Kysely } from 'kysely';
import { KYSELY } from '../db/pool.provider';
import type { Database } from '../db/types';
import {
  type CurrencyStatsRow,
  DailyStatsRepository,
  type UserStatsRow,
} from '../domain/repositories/daily-stats.repository';

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
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly dailyStats: DailyStatsRepository,
  ) {}

  async userReport(
    fromIso: string,
    toIso: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<UserReportPage> {
    const range = toDayRange(fromIso, toIso);
    const effectiveLimit = limit ?? DEFAULT_LIMIT;

    const rawRows = await this.dailyStats.sumByUser(
      this.db,
      range.fromDate,
      range.toDate,
      cursor ?? '',
      effectiveLimit + 1,
    );

    const hasMore = rawRows.length > effectiveLimit;
    const visible = hasMore ? rawRows.slice(0, effectiveLimit) : rawRows;
    const users = visible.map(toUserReportRow);
    const next_cursor = hasMore ? visible[visible.length - 1].user_id : null;
    return { users, next_cursor };
  }

  async casinoReport(fromIso: string, toIso: string): Promise<CasinoReport> {
    const range = toDayRange(fromIso, toIso);
    const rawRows = await this.dailyStats.sumByCurrency(
      this.db,
      range.fromDate,
      range.toDate,
    );
    return { currencies: rawRows.map(toCasinoReportRow) };
  }
}

function toUserReportRow(r: UserStatsRow): UserReportRow {
  const total_bet = Number(r.total_bet);
  const total_win = Number(r.total_win);
  return {
    user_id: r.user_id,
    currency: r.currency,
    rounds: r.rounds,
    total_bet,
    total_win,
    rolled_back_bet: Number(r.rolled_back_bet),
    rolled_back_win: Number(r.rolled_back_win),
    rtp: computeRtp(total_bet, total_win),
  };
}

function toCasinoReportRow(r: CurrencyStatsRow): CasinoReportRow {
  const total_bet = Number(r.total_bet);
  const total_win = Number(r.total_win);
  return {
    currency: r.currency,
    rounds: r.rounds,
    total_bet,
    total_win,
    rolled_back_bet: Number(r.rolled_back_bet),
    rolled_back_win: Number(r.rolled_back_win),
    rtp: computeRtp(total_bet, total_win),
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
