import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app';

let app: NestFastifyApplication;

beforeAll(async () => {
  ({ app } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

const URL = '/aggregator/takehome/process';
const BODY = '{"user_id":"u","currency":"USD"}';

async function send(headers: Record<string, string>): Promise<number> {
  const res = await app.getHttpAdapter().getInstance().inject({
    method: 'POST',
    url: URL,
    headers: { 'content-type': 'application/json', ...headers },
    payload: BODY,
  });
  return res.statusCode;
}

describe('HMAC negative cases', () => {
  it('rejects when Authorization is missing', async () => {
    expect(await send({})).toBe(403);
  });

  it('rejects when scheme is not HMAC-SHA256', async () => {
    expect(
      await send({
        authorization: 'Bearer 7376e78d5f65ca750c9719d2163daffa129e8a07ba9a1abe12241b3b1de51295',
      }),
    ).toBe(403);
  });

  it('rejects when the hex digest is too short', async () => {
    expect(await send({ authorization: 'HMAC-SHA256 deadbeef' })).toBe(403);
  });

  it('rejects when the hex digest is the right length but wrong', async () => {
    expect(
      await send({
        authorization: 'HMAC-SHA256 ' + '0'.repeat(64),
      }),
    ).toBe(403);
  });

  it('rejects when the hex digest contains non-hex characters', async () => {
    expect(
      await send({
        authorization: 'HMAC-SHA256 ' + 'zz'.repeat(32),
      }),
    ).toBe(403);
  });
});
