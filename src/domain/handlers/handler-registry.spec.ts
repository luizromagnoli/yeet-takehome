import { describe, expect, it } from 'vitest';
import { BetHandler } from './bet.handler';
import { HandlerRegistry } from './handler-registry';
import { RollbackHandler } from './rollback.handler';
import { WinHandler } from './win.handler';

describe('HandlerRegistry.for', () => {
  const bet = {} as BetHandler;
  const win = {} as WinHandler;
  const rollback = {} as RollbackHandler;
  const registry = new HandlerRegistry(bet, win, rollback);

  it('returns the BetHandler for kind=bet', () => {
    expect(registry.for('bet')).toBe(bet);
  });

  it('returns the WinHandler for kind=win', () => {
    expect(registry.for('win')).toBe(win);
  });

  it('returns the RollbackHandler for kind=rollback', () => {
    expect(registry.for('rollback')).toBe(rollback);
  });
});
