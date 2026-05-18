import type { Transaction } from 'kysely';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Database } from '../db/types';
import type { ProcessRequestDto } from '../process/dto/process.dto';
import { ActionProcessor } from './action-processor';
import { HandlerRegistry } from './handlers/handler-registry';
import { BalanceRepository } from './repositories/balance.repository';
import { DailyStatsRepository } from './repositories/daily-stats.repository';
import { IdempotencyRepository } from './repositories/idempotency.repository';
import { RoundCloseRepository } from './repositories/round-close.repository';
import { Money } from './values/money';

interface Mocks {
  balances: { ensureUser: Mock; lockBalance: Mock; update: Mock };
  idempotency: { claim: Mock };
  dailyStats: { bumpRound: Mock };
  roundCloses: { claim: Mock };
  handlers: { for: Mock };
  handler: { apply: Mock };
}

const trx = {} as Transaction<Database>;

function setup(initialBalance = 500n): { proc: ActionProcessor; mocks: Mocks } {
  const handler = { apply: vi.fn() };
  const mocks: Mocks = {
    balances: {
      ensureUser: vi.fn().mockResolvedValue(undefined),
      lockBalance: vi.fn().mockResolvedValue(new Money(initialBalance, 'USD')),
      update: vi.fn().mockResolvedValue(undefined),
    },
    idempotency: { claim: vi.fn() },
    dailyStats: { bumpRound: vi.fn().mockResolvedValue(undefined) },
    roundCloses: { claim: vi.fn() },
    handlers: { for: vi.fn().mockReturnValue(handler) },
    handler,
  };
  const proc = new ActionProcessor(
    mocks.balances as unknown as BalanceRepository,
    mocks.idempotency as unknown as IdempotencyRepository,
    mocks.dailyStats as unknown as DailyStatsRepository,
    mocks.roundCloses as unknown as RoundCloseRepository,
    mocks.handlers as unknown as HandlerRegistry,
  );
  return { proc, mocks };
}

function request(
  overrides: Partial<ProcessRequestDto> = {},
): ProcessRequestDto {
  return {
    userId: 'u-1',
    currency: 'USD',
    game: 'g',
    gameId: 'game-1',
    actions: [
      {
        action: 'bet',
        actionId: '3b42f070-dab5-4d6c-8bc6-7241b68f00bd',
        amount: 100,
      },
    ],
    ...overrides,
  };
}

describe('ActionProcessor.process', () => {
  let proc: ActionProcessor;
  let mocks: Mocks;

  beforeEach(() => {
    ({ proc, mocks } = setup());
    mocks.idempotency.claim.mockResolvedValue({
      fresh: true,
      txId: 'tx-1',
      createdAt: new Date('2026-05-17T10:00:00Z'),
    });
    mocks.handler.apply.mockResolvedValue({
      delta: new Money(-100n, 'USD'),
    });
  });

  it('throws when called with no actions', async () => {
    await expect(
      proc.process(trx, request({ actions: [] })),
    ).rejects.toThrow(/without actions/);
  });

  it('ensures the user exists and acquires the per-user balance lock', async () => {
    await proc.process(trx, request());
    expect(mocks.balances.ensureUser).toHaveBeenCalledTimes(1);
    expect(mocks.balances.lockBalance).toHaveBeenCalledTimes(1);
  });

  it('claims idempotency for every action and runs the matching handler for fresh ones', async () => {
    const result = await proc.process(trx, request());

    expect(mocks.idempotency.claim).toHaveBeenCalledTimes(1);
    expect(mocks.handlers.for).toHaveBeenCalledWith('bet');
    expect(mocks.handler.apply).toHaveBeenCalledTimes(1);
    expect(result.transactions).toEqual([
      { actionId: '3b42f070-dab5-4d6c-8bc6-7241b68f00bd', txId: 'tx-1' },
    ]);
  });

  it('skips the handler when idempotency reports a non-fresh claim', async () => {
    mocks.idempotency.claim.mockResolvedValueOnce({
      fresh: false,
      txId: 'existing-tx',
    });

    const result = await proc.process(trx, request());

    expect(mocks.handler.apply).not.toHaveBeenCalled();
    expect(result.transactions[0].txId).toBe('existing-tx');
    expect(result.balance.amount).toBe(500n);
  });

  it('persists the running balance via balances.update', async () => {
    await proc.process(trx, request());
    expect(mocks.balances.update).toHaveBeenCalledTimes(1);
    const final = mocks.balances.update.mock.calls[0][2] as Money;
    expect(final.amount).toBe(400n); // 500 - 100
  });

  describe('round-close gating on finished=true', () => {
    it('bumps the rounds counter when the round-close claim is fresh', async () => {
      mocks.roundCloses.claim.mockResolvedValueOnce(true);

      await proc.process(trx, request({ finished: true }));

      expect(mocks.roundCloses.claim).toHaveBeenCalledTimes(1);
      expect(mocks.dailyStats.bumpRound).toHaveBeenCalledTimes(1);
    });

    it('does NOT bump rounds when the round-close claim is stale', async () => {
      mocks.roundCloses.claim.mockResolvedValueOnce(false);

      await proc.process(trx, request({ finished: true }));

      expect(mocks.roundCloses.claim).toHaveBeenCalledTimes(1);
      expect(mocks.dailyStats.bumpRound).not.toHaveBeenCalled();
    });

    it('does NOT even claim the round when finished is false', async () => {
      await proc.process(trx, request({ finished: false }));
      expect(mocks.roundCloses.claim).not.toHaveBeenCalled();
      expect(mocks.dailyStats.bumpRound).not.toHaveBeenCalled();
    });

    it('treats a missing finished flag as false', async () => {
      await proc.process(trx, request({}));
      expect(mocks.roundCloses.claim).not.toHaveBeenCalled();
      expect(mocks.dailyStats.bumpRound).not.toHaveBeenCalled();
    });
  });
});
