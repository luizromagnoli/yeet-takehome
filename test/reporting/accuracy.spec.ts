import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Kysely } from 'kysely';
import { createTestApp, resetDatabase, seedUser } from '../helpers/app';
import { authHeader } from '../helpers/hmac';
import type { Database } from '../../src/db/types';

const USER_A = 'report-user-A';
const USER_B = 'report-user-B';
const CURRENCY = 'USD';

let app: NestFastifyApplication;
let db: Kysely<Database>;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(db);
  await seedUser(db, USER_A, CURRENCY, 1_000_000n);
  await seedUser(db, USER_B, CURRENCY, 1_000_000n);
});

async function call(body: unknown): Promise<unknown> {
  const payload = JSON.stringify(body);
  const res = await app.getHttpAdapter().getInstance().inject({
    method: 'POST',
    url: '/aggregator/takehome/process',
    headers: {
      'content-type': 'application/json',
      authorization: authHeader(payload),
    },
    payload,
  });
  return res.json();
}

async function getReport(path: string): Promise<unknown> {
  const res = await app.getHttpAdapter().getInstance().inject({
    method: 'GET',
    url: path,
    headers: { authorization: authHeader('') },
  });
  return res.json();
}

describe('RTP reporting', () => {
  it('sums bets and wins per user, excludes rollbacks from totals', async () => {
    await call({
      user_id: USER_A,
      currency: CURRENCY,
      game: 'r:test',
      game_id: 'a1',
      finished: true,
      actions: [
        { action: 'bet', action_id: randomUUID(), amount: 1000 },
        { action: 'win', action_id: randomUUID(), amount: 950 },
      ],
    });
    await call({
      user_id: USER_B,
      currency: CURRENCY,
      game: 'r:test',
      game_id: 'b1',
      finished: true,
      actions: [
        { action: 'bet', action_id: randomUUID(), amount: 2000 },
        { action: 'win', action_id: randomUUID(), amount: 1800 },
      ],
    });

    const today = new Date().toISOString().slice(0, 10);
    const from = `${today}T00:00:00Z`;
    const to = `${today}T23:59:59Z`;

    const userReport = (await getReport(
      `/aggregator/takehome/report/users?from=${from}&to=${to}`,
    )) as {
      users: Array<{
        user_id: string;
        total_bet: number;
        total_win: number;
        rtp: number | null;
      }>;
    };
    const byUser = new Map(userReport.users.map((u) => [u.user_id, u]));
    expect(byUser.get(USER_A)?.total_bet).toBe(1000);
    expect(byUser.get(USER_A)?.total_win).toBe(950);
    expect(byUser.get(USER_A)?.rtp).toBe(0.95);
    expect(byUser.get(USER_B)?.total_bet).toBe(2000);
    expect(byUser.get(USER_B)?.total_win).toBe(1800);
    expect(byUser.get(USER_B)?.rtp).toBe(0.9);

    const casinoReport = (await getReport(
      `/aggregator/takehome/report/casino?from=${from}&to=${to}`,
    )) as {
      currencies: Array<{ currency: string; total_bet: number; total_win: number }>;
    };
    const usd = casinoReport.currencies.find((c) => c.currency === CURRENCY);
    expect(usd?.total_bet).toBe(3000);
    expect(usd?.total_win).toBe(2750);
  });

  it('moves rolled-back amounts out of the totals', async () => {
    const betId = randomUUID();
    await call({
      user_id: USER_A,
      currency: CURRENCY,
      game: 'r:test',
      game_id: 'rb1',
      actions: [{ action: 'bet', action_id: betId, amount: 500 }],
    });
    await call({
      user_id: USER_A,
      currency: CURRENCY,
      game: 'r:test',
      game_id: 'rb1',
      finished: true,
      actions: [
        {
          action: 'rollback',
          action_id: randomUUID(),
          original_action_id: betId,
        },
      ],
    });

    const today = new Date().toISOString().slice(0, 10);
    const from = `${today}T00:00:00Z`;
    const to = `${today}T23:59:59Z`;

    const userReport = (await getReport(
      `/aggregator/takehome/report/users?from=${from}&to=${to}&cursor=report-user-%2900`,
    )) as {
      users: Array<{
        user_id: string;
        total_bet: number;
        rolled_back_bet: number;
      }>;
    };
    const a = userReport.users.find((u) => u.user_id === USER_A);
    expect(a?.total_bet).toBe(0);
    expect(a?.rolled_back_bet).toBe(500);
  });

  it('groups the casino report by currency', async () => {
    const USER_EUR = 'report-user-EUR';
    const USER_GBP = 'report-user-GBP';
    await seedUser(db, USER_EUR, 'EUR', 1_000_000n);
    await seedUser(db, USER_GBP, 'GBP', 1_000_000n);

    await call({
      user_id: USER_A,
      currency: CURRENCY,
      game: 'r:test',
      game_id: 'mc-usd',
      finished: true,
      actions: [
        { action: 'bet', action_id: randomUUID(), amount: 1000 },
        { action: 'win', action_id: randomUUID(), amount: 950 },
      ],
    });
    await call({
      user_id: USER_EUR,
      currency: 'EUR',
      game: 'r:test',
      game_id: 'mc-eur',
      finished: true,
      actions: [
        { action: 'bet', action_id: randomUUID(), amount: 2000 },
        { action: 'win', action_id: randomUUID(), amount: 1900 },
      ],
    });
    await call({
      user_id: USER_GBP,
      currency: 'GBP',
      game: 'r:test',
      game_id: 'mc-gbp',
      finished: true,
      actions: [
        { action: 'bet', action_id: randomUUID(), amount: 3000 },
        { action: 'win', action_id: randomUUID(), amount: 2700 },
      ],
    });

    const today = new Date().toISOString().slice(0, 10);
    const casinoReport = (await getReport(
      `/aggregator/takehome/report/casino?from=${today}T00:00:00Z&to=${today}T23:59:59Z`,
    )) as {
      currencies: Array<{
        currency: string;
        total_bet: number;
        total_win: number;
        rtp: number | null;
      }>;
    };
    const byCurrency = new Map(
      casinoReport.currencies.map((c) => [c.currency, c]),
    );
    expect(byCurrency.get('USD')?.total_bet).toBe(1000);
    expect(byCurrency.get('USD')?.total_win).toBe(950);
    expect(byCurrency.get('EUR')?.total_bet).toBe(2000);
    expect(byCurrency.get('EUR')?.total_win).toBe(1900);
    expect(byCurrency.get('GBP')?.total_bet).toBe(3000);
    expect(byCurrency.get('GBP')?.total_win).toBe(2700);
  });

  it('rejects an action whose currency does not match the stored user currency', async () => {
    const payload = JSON.stringify({
      user_id: USER_A,
      currency: 'EUR', // USER_A is registered as USD
      game: 'r:test',
      game_id: 'mismatch',
      finished: true,
      actions: [
        { action: 'bet', action_id: randomUUID(), amount: 100 },
      ],
    });
    const res = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/aggregator/takehome/process',
      headers: {
        'content-type': 'application/json',
        authorization: authHeader(payload),
      },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 101 });
  });

  it('paginates per-user with stable keyset cursoring', async () => {
    // Create 3 distinct users, each with a small bet, so the report has rows
    // we can iterate via cursor.
    for (const userId of ['paginate-1', 'paginate-2', 'paginate-3']) {
      await seedUser(db, userId, CURRENCY, 1_000n);
      await call({
        user_id: userId,
        currency: CURRENCY,
        game: 'r:test',
        game_id: `p-${userId}`,
        finished: true,
        actions: [{ action: 'bet', action_id: randomUUID(), amount: 100 }],
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    const base = `/aggregator/takehome/report/users?from=${today}T00:00:00Z&to=${today}T23:59:59Z`;

    const firstPage = (await getReport(`${base}&limit=2`)) as {
      users: Array<{ user_id: string }>;
      next_cursor: string | null;
    };
    expect(firstPage.users).toHaveLength(2);
    expect(firstPage.next_cursor).not.toBeNull();

    const secondPage = (await getReport(
      `${base}&limit=2&cursor=${encodeURIComponent(firstPage.next_cursor ?? '')}`,
    )) as { users: Array<{ user_id: string }>; next_cursor: string | null };
    expect(secondPage.users.length).toBeGreaterThan(0);
    const firstIds = new Set(firstPage.users.map((u) => u.user_id));
    for (const u of secondPage.users) {
      expect(firstIds.has(u.user_id)).toBe(false);
    }
  });
});
