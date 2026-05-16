import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Kysely } from 'kysely';
import { createTestApp, resetDatabase, seedUser } from '../helpers/app';
import { authHeader } from '../helpers/hmac';
import type { Database } from '../../src/db/types';

const USER_ID = '8|USDT|USD';
const CURRENCY = 'USD';
const INITIAL_BALANCE = 74_322_001n;

let app: NestFastifyApplication;
let db: Kysely<Database>;

interface InjectResponse {
  statusCode: number;
  payload: string;
  json(): unknown;
}

function post(body: unknown, includeAuth = true): Promise<InjectResponse> {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (includeAuth) {
    headers['authorization'] = authHeader(payload);
  }
  return app.getHttpAdapter().getInstance().inject({
    method: 'POST',
    url: '/aggregator/takehome/process',
    headers,
    payload,
  });
}

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

describe('Scenario A — missing Authorization', () => {
  it('rejects with 403', async () => {
    const res = await post(
      { user_id: USER_ID, currency: CURRENCY },
      false,
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('Scenario B — balance lookup', () => {
  it('returns the seeded balance', async () => {
    const res = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ balance: Number(INITIAL_BALANCE) });
  });
});

describe('Scenario C — single bet finished', () => {
  it('debits the bet amount', async () => {
    const res = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-C',
      finished: true,
      actions: [
        {
          action: 'bet',
          action_id: '3b42f070-dab5-4d6c-8bc6-7241b68f00bd',
          amount: 100,
        },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      game_id: 'game-C',
      transactions: [
        {
          action_id: '3b42f070-dab5-4d6c-8bc6-7241b68f00bd',
          tx_id: expect.any(String),
        },
      ],
      balance: Number(INITIAL_BALANCE) - 100,
    });
  });
});

describe('Scenario D — bet + win in the same call', () => {
  it('applies both and ends with net effect', async () => {
    const res = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-D',
      actions: [
        {
          action: 'bet',
          action_id: '7c8affbf-53fd-4fcc-b1ca-18118c5dd287',
          amount: 100,
        },
        {
          action: 'win',
          action_id: '86441c7a-560e-4501-b829-110af6a1b956',
          amount: 250,
        },
      ],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { balance: number; transactions: unknown[] };
    expect(body.balance).toBe(Number(INITIAL_BALANCE) + 150);
    expect(body.transactions).toHaveLength(2);
  });
});

describe('Scenario E — insufficient funds', () => {
  it('returns code 100 and does not change balance', async () => {
    const res = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-E',
      finished: true,
      actions: [
        {
          action: 'bet',
          action_id: '6c1e98e8-8e93-4856-b6ef-8b2ddc6c4cbc',
          amount: 99_999_999,
        },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 100 });

    const after = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
    });
    expect(after.json()).toEqual({ balance: Number(INITIAL_BALANCE) });
  });
});

describe('Scenario F — bet then win in separate calls', () => {
  it('accumulates correctly across calls', async () => {
    const bet = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-F',
      actions: [
        {
          action: 'bet',
          action_id: '19bd35d5-50c3-4720-a402-145a46ab874c',
          amount: 100,
        },
      ],
    });
    expect((bet.json() as { balance: number }).balance).toBe(
      Number(INITIAL_BALANCE) - 100,
    );

    const win = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-F',
      finished: true,
      actions: [
        {
          action: 'win',
          action_id: 'dcafc246-24b6-458b-a823-f6e7ecd6e9c3',
          amount: 700,
        },
      ],
    });
    expect((win.json() as { balance: number }).balance).toBe(
      Number(INITIAL_BALANCE) + 600,
    );
  });
});

describe('Scenario G — bet then rollback', () => {
  it('restores the balance', async () => {
    const betActionId = '4dbcbf1d-bcf6-43e9-9a62-7d3c0f3c6486';
    const rollbackActionId = 'c9a9c3a7-e9e8-4f5a-9fdf-1d8a377d1b8f';

    await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-G',
      actions: [{ action: 'bet', action_id: betActionId, amount: 100 }],
    });

    const res = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-G',
      finished: true,
      actions: [
        {
          action: 'rollback',
          action_id: rollbackActionId,
          original_action_id: betActionId,
        },
      ],
    });

    const body = res.json() as { balance: number };
    expect(body.balance).toBe(Number(INITIAL_BALANCE));
  });
});

describe('Scenario H — duplicate action_id is idempotent', () => {
  it('applies once and returns the original tx_id', async () => {
    const betActionId = 'f61c5eba-fb26-4070-89b5-c3a2edf54c02';
    const secondBetId = 'd94b2fa5-e87f-4d8e-9a01-4a443ed5c11c';

    const first = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-H',
      actions: [{ action: 'bet', action_id: betActionId, amount: 100 }],
    });
    const firstTx = (first.json() as {
      transactions: Array<{ action_id: string; tx_id: string }>;
    }).transactions[0].tx_id;

    const second = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-H',
      actions: [
        { action: 'bet', action_id: betActionId, amount: 100 },
        { action: 'bet', action_id: secondBetId, amount: 50 },
      ],
    });
    const body = second.json() as {
      balance: number;
      transactions: Array<{ action_id: string; tx_id: string }>;
    };
    expect(body.balance).toBe(Number(INITIAL_BALANCE) - 150);
    expect(body.transactions[0].tx_id).toBe(firstTx);
    expect(body.transactions).toHaveLength(2);
  });
});

describe('Scenario I — rollback arrives before the bet', () => {
  it('tombstones, and the later bet becomes a noop', async () => {
    const betId = '27710aca-60f9-4259-a9bb-26f75cd05917';
    const rollbackId = '65d57850-5ee3-418b-b1b0-b4975242efcf';

    const balanceBefore = INITIAL_BALANCE;

    const rb = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-I',
      finished: true,
      actions: [
        {
          action: 'rollback',
          action_id: rollbackId,
          original_action_id: betId,
        },
      ],
    });
    expect((rb.json() as { balance: number }).balance).toBe(Number(balanceBefore));

    const bet = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-I',
      finished: true,
      actions: [{ action: 'bet', action_id: betId, amount: 100 }],
    });
    expect((bet.json() as { balance: number }).balance).toBe(Number(balanceBefore));
  });
});

describe('Scenario J — rollback before bet+win, then bet+win arrive', () => {
  it('produces no net balance effect', async () => {
    const betId = 'a2fd2ce9-5184-48b6-bdde-f6ba05d32e01';
    const winId = '7e4ad25b-b2c2-4eb7-b38e-63e7ddcdab52';
    const rbBetId = '12af93e7-f208-46f1-9399-4c1668fdd675';
    const rbWinId = '85762689-2ab3-40d6-a7cd-e3babb53ae06';

    const balanceBefore = INITIAL_BALANCE;

    const rb = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-J',
      finished: true,
      actions: [
        {
          action: 'rollback',
          action_id: rbBetId,
          original_action_id: betId,
        },
        {
          action: 'rollback',
          action_id: rbWinId,
          original_action_id: winId,
        },
      ],
    });
    expect((rb.json() as { balance: number }).balance).toBe(Number(balanceBefore));

    const later = await post({
      user_id: USER_ID,
      currency: CURRENCY,
      game: 'acceptance:test',
      game_id: 'game-J',
      finished: true,
      actions: [
        { action: 'bet', action_id: betId, amount: 100 },
        { action: 'win', action_id: winId, amount: 200 },
      ],
    });
    expect((later.json() as { balance: number }).balance).toBe(Number(balanceBefore));
  });
});

describe('PDF HMAC vector', () => {
  it('verifies the example signature byte-for-byte', async () => {
    const rawBody = '{"user_id": "8|USDT|USD","currency": "USD","game": "acceptance:test"}';
    const expectedSig =
      '7376e78d5f65ca750c9719d2163daffa129e8a07ba9a1abe12241b3b1de51295';
    const res = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/aggregator/takehome/process',
      headers: {
        'content-type': 'application/json',
        authorization: `HMAC-SHA256 ${expectedSig}`,
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
  });
});
