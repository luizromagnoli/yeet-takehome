import { createHmac } from 'node:crypto';

const SECRET = process.env.BET_PROCESSOR_HMAC_SECRET ?? 'test';

export function signBody(rawBody: string | Buffer): string {
  return createHmac('sha256', SECRET).update(rawBody).digest('hex');
}

export function authHeader(rawBody: string | Buffer): string {
  return `HMAC-SHA256 ${signBody(rawBody)}`;
}
