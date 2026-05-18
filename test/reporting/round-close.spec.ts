import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Kysely } from 'kysely';
import { createTestApp, resetDatabase, seedUser } from '../helpers/app';
import { authHeader } from '../helpers/hmac';
import type { Database } from '../../src/db/types';

const USER_ID = 'round-close-user';
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
  await seedUser(db, USER_ID, CURRENCY, 1_000_000n);
});

async function post(body: unknown): Promise<unknown> {
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

describe('round-close idempotency', () => {
  it('counts a round whose closing request contains only duplicate actions', async () => {
    const gameId = 'split-close-game';
    const betId = randomUUID();

    // Request 1: open the round with finished=false. Bet applies; no
    // round-close yet because the round isn't marked finished.
    await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'split:test',
      game_id: gameId,
      finished: false,
      actions: [{ action: 'bet', action_id: betId, amount: 100 }],
    });

    // Request 2: the client closes the round by re-sending the SAME bet
    // (idempotency dedups it) with finished=true. Under the buggy
    // anyApplied heuristic, this request would skip the round bump
    // because nothing applied this turn — so rounds would stay 0.
    await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'split:test',
      game_id: gameId,
      finished: true,
      actions: [{ action: 'bet', action_id: betId, amount: 100 }],
    });

    const today = new Date().toISOString().slice(0, 10);
    const report = (await getReport(
      `/aggregator/takehome/report/users?from=${today}T00:00:00Z&to=${today}T23:59:59Z`,
    )) as { users: Array<{ user_id: string; rounds: number }> };
    const row = report.users.find((u) => u.user_id === USER_ID);
    expect(row?.rounds).toBe(1);
  });

  it('counts a round exactly once when the closing request retries', async () => {
    const gameId = 'retry-close-game';
    const betId = randomUUID();
    const winId = randomUUID();

    const body = {
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'retry:test',
      game_id: gameId,
      finished: true,
      actions: [
        { action: 'bet', action_id: betId, amount: 100 },
        { action: 'win', action_id: winId, amount: 150 },
      ],
    };

    await post(body);
    // Identical retry — every action dedups, the round-close claim collides
    // on (user, game_id, day), so rounds must stay at 1.
    await post(body);
    await post(body);

    const today = new Date().toISOString().slice(0, 10);
    const report = (await getReport(
      `/aggregator/takehome/report/users?from=${today}T00:00:00Z&to=${today}T23:59:59Z`,
    )) as { users: Array<{ user_id: string; rounds: number }> };
    const row = report.users.find((u) => u.user_id === USER_ID);
    expect(row?.rounds).toBe(1);
  });
});
