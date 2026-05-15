import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql, type Kysely } from 'kysely';
import { createTestApp, resetDatabase, seedUser } from '../helpers/app';
import { authHeader } from '../helpers/hmac';
import type { Database } from '../../src/db/types';

const USER_ID = '8|USDT|USD';
const CURRENCY = 'USD';
const INITIAL_BALANCE = 1_000_000n;

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
  await seedUser(db, USER_ID, CURRENCY, INITIAL_BALANCE);
});

function postBet(actionId: string, amount: number): Promise<{
  statusCode: number;
  body: { balance: number; transactions: Array<{ tx_id: string }> };
}> {
  const payload = JSON.stringify({
    user_id: USER_ID,
    currency: CURRENCY,
    game: 'concurrency:test',
    game_id: 'g',
    actions: [{ action: 'bet', action_id: actionId, amount }],
  });
  return app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/aggregator/takehome/process',
      headers: {
        'content-type': 'application/json',
        authorization: authHeader(payload),
      },
      payload,
    })
    .then((res) => ({
      statusCode: res.statusCode,
      body: res.json() as {
        balance: number;
        transactions: Array<{ tx_id: string }>;
      },
    }));
}

describe('concurrent same-action requests', () => {
  it('applies exactly once across 50 parallel calls', async () => {
    const actionId = randomUUID();
    const amount = 250;
    const concurrency = 50;

    const results = await Promise.all(
      Array.from({ length: concurrency }, () => postBet(actionId, amount)),
    );

    for (const r of results) {
      expect(r.statusCode).toBe(200);
    }

    const txIds = new Set(results.map((r) => r.body.transactions[0].tx_id));
    expect(txIds.size).toBe(1);

    const final = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/aggregator/takehome/process',
        headers: {
          'content-type': 'application/json',
          authorization: authHeader(
            JSON.stringify({ user_id: USER_ID, currency: CURRENCY }),
          ),
        },
        payload: JSON.stringify({ user_id: USER_ID, currency: CURRENCY }),
      });
    expect((final.json() as { balance: number }).balance).toBe(
      Number(INITIAL_BALANCE) - amount,
    );

    const actionsCount = await sql<{ count: number }>`
      SELECT count(*)::int FROM actions WHERE action_id = ${actionId}
    `.execute(db);
    expect(actionsCount.rows[0].count).toBe(1);
  });

  it('serialises distinct concurrent bets so the balance stays non-negative', async () => {
    // 50 concurrent bets of 30k against a 1M balance — only 33 can be applied.
    // The rest must fail with code 100 and not affect the balance.
    const concurrency = 50;
    const amount = 30_000;

    const results = await Promise.all(
      Array.from({ length: concurrency }, () => postBet(randomUUID(), amount)),
    );

    const ok = results.filter((r) => r.statusCode === 200);
    const insufficient = results.filter((r) => r.statusCode === 400);
    expect(ok.length + insufficient.length).toBe(concurrency);
    expect(ok.length).toBeLessThanOrEqual(Math.floor(Number(INITIAL_BALANCE) / amount));

    const balanceRow = await db
      .selectFrom('user_balances')
      .where('user_id', '=', USER_ID)
      .select('balance')
      .executeTakeFirstOrThrow();
    expect(balanceRow.balance >= 0n).toBe(true);
    expect(balanceRow.balance).toBe(
      INITIAL_BALANCE - BigInt(ok.length) * BigInt(amount),
    );
  });
});
