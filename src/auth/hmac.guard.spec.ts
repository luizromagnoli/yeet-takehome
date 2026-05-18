import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HmacGuard } from './hmac.guard';

interface RequestShape {
  headers: Record<string, string | undefined>;
  rawBody?: Buffer;
}

function makeContext(request: RequestShape): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => function dummy() {},
  } as unknown as ExecutionContext;
}

function sign(body: Buffer | string, secret = 'test'): string {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return createHmac('sha256', secret).update(buf).digest('hex');
}

interface Mocks {
  config: { getOrThrow: Mock };
  reflector: { getAllAndOverride: Mock };
}

function setup(): { guard: HmacGuard; mocks: Mocks } {
  const mocks: Mocks = {
    config: { getOrThrow: vi.fn().mockReturnValue('test') },
    reflector: { getAllAndOverride: vi.fn().mockReturnValue(false) },
  };
  const guard = new HmacGuard(
    mocks.config as unknown as ConfigService,
    mocks.reflector as unknown as Reflector,
  );
  return { guard, mocks };
}

describe('HmacGuard.canActivate', () => {
  let guard: HmacGuard;
  let mocks: Mocks;

  beforeEach(() => {
    ({ guard, mocks } = setup());
  });

  it('returns true (and does not read the secret) when @SkipHmac is set', () => {
    mocks.reflector.getAllAndOverride.mockReturnValueOnce(true);
    const ctx = makeContext({ headers: {} });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(mocks.config.getOrThrow).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the header is missing', () => {
    expect(() => guard.canActivate(makeContext({ headers: {} }))).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when the scheme is not HMAC-SHA256', () => {
    expect(() =>
      guard.canActivate(
        makeContext({
          headers: { authorization: 'Bearer deadbeef' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when the hex digest is too short', () => {
    expect(() =>
      guard.canActivate(
        makeContext({
          headers: { authorization: 'HMAC-SHA256 deadbeef' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when the hex digest contains non-hex characters', () => {
    expect(() =>
      guard.canActivate(
        makeContext({
          headers: { authorization: 'HMAC-SHA256 ' + 'zz'.repeat(32) },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when the digest is the right length but wrong bytes', () => {
    expect(() =>
      guard.canActivate(
        makeContext({
          headers: { authorization: 'HMAC-SHA256 ' + '0'.repeat(64) },
          rawBody: Buffer.from('{"a":1}', 'utf8'),
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('returns true when the digest matches HMAC over rawBody', () => {
    const body = Buffer.from('{"hello":"world"}', 'utf8');
    const ctx = makeContext({
      headers: { authorization: `HMAC-SHA256 ${sign(body)}` },
      rawBody: body,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('signs against empty bytes when rawBody is absent (GET requests)', () => {
    const ctx = makeContext({
      headers: { authorization: `HMAC-SHA256 ${sign(Buffer.alloc(0))}` },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('reads the secret from BET_PROCESSOR_HMAC_SECRET', () => {
    const body = Buffer.from('{"a":1}', 'utf8');
    const ctx = makeContext({
      headers: { authorization: `HMAC-SHA256 ${sign(body)}` },
      rawBody: body,
    });
    guard.canActivate(ctx);
    expect(mocks.config.getOrThrow).toHaveBeenCalledWith(
      'BET_PROCESSOR_HMAC_SECRET',
    );
  });
});
