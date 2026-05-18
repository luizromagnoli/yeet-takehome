import { describe, expect, it } from 'vitest';
import type { ProcessRequestDto } from '../process/dto/process.dto';
import { buildContext } from './action-context';

describe('buildContext', () => {
  it('promotes the DTO fields into a RequestContext', () => {
    const req: ProcessRequestDto = {
      userId: '8|USDT|USD',
      currency: 'USD',
      game: 'acceptance:test',
      gameId: 'g-1',
      finished: true,
    };
    const ctx = buildContext(req);
    expect(ctx.userId).toBe('8|USDT|USD');
    expect(ctx.currency).toBe('USD');
    expect(ctx.game).toBe('acceptance:test');
    expect(ctx.gameId).toBe('g-1');
    expect(ctx.finished).toBe(true);
  });

  it('defaults game and gameId to empty strings when absent', () => {
    const req: ProcessRequestDto = {
      userId: '8|USDT|USD',
      currency: 'USD',
    };
    const ctx = buildContext(req);
    expect(ctx.game).toBe('');
    expect(ctx.gameId).toBe('');
  });

  it('treats finished as strictly boolean — only literal true survives', () => {
    expect(
      buildContext({ userId: 'u', currency: 'USD', finished: false }).finished,
    ).toBe(false);
    expect(
      buildContext({ userId: 'u', currency: 'USD' }).finished,
    ).toBe(false);
  });

  it('coerces non-true truthy values to false', () => {
    // The DTO is validated upstream, but buildContext defensively normalises
    // to a strict boolean rather than trusting the field's truthiness.
    const req = {
      userId: 'u',
      currency: 'USD',
      finished: 'true' as unknown as boolean,
    } satisfies ProcessRequestDto;
    expect(buildContext(req).finished).toBe(false);
  });
});
