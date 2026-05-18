import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Database } from '../db/types';
import { ActionProcessor } from '../domain/action-processor';
import { BalanceRepository } from '../domain/repositories/balance.repository';
import { Money } from '../domain/values/money';
import { ProcessService } from './process.service';

interface Mocks {
  db: { transaction: Mock };
  trx: Record<string, unknown>;
  processor: { process: Mock };
  balanceRepository: { read: Mock };
}

function setup(): { service: ProcessService; mocks: Mocks } {
  const trx = {};
  const mocks: Mocks = {
    trx,
    db: {
      transaction: vi.fn(() => ({
        execute: vi.fn(<T>(cb: (trx: typeof mocks.trx) => Promise<T>) => cb(trx)),
      })),
    },
    processor: { process: vi.fn() },
    balanceRepository: { read: vi.fn() },
  };
  const service = new ProcessService(
    mocks.db as unknown as Kysely<Database>,
    mocks.processor as unknown as ActionProcessor,
    mocks.balanceRepository as unknown as BalanceRepository,
  );
  return { service, mocks };
}

describe('ProcessService.process', () => {
  let service: ProcessService;
  let mocks: Mocks;

  beforeEach(() => {
    ({ service, mocks } = setup());
  });

  describe('balance-only path (no actions)', () => {
    it('reads the balance and returns just { balance } for a known user', async () => {
      mocks.balanceRepository.read.mockResolvedValueOnce(new Money(123n, 'USD'));

      const result = await service.process({
        userId: 'u-1',
        currency: 'USD',
      });

      expect(result).toEqual({ balance: 123 });
      expect(mocks.balanceRepository.read).toHaveBeenCalledTimes(1);
      // Balance-only path must NOT open a transaction or invoke the processor.
      expect(mocks.db.transaction).not.toHaveBeenCalled();
      expect(mocks.processor.process).not.toHaveBeenCalled();
    });

    it('returns balance:0 for an unknown user', async () => {
      mocks.balanceRepository.read.mockResolvedValueOnce(null);
      const result = await service.process({
        userId: 'unknown',
        currency: 'USD',
      });
      expect(result).toEqual({ balance: 0 });
    });

    it('treats an empty actions array as a balance-only request', async () => {
      mocks.balanceRepository.read.mockResolvedValueOnce(new Money(50n, 'USD'));
      await service.process({
        userId: 'u-1',
        currency: 'USD',
        actions: [],
      });
      expect(mocks.processor.process).not.toHaveBeenCalled();
    });
  });

  describe('action processing path', () => {
    beforeEach(() => {
      mocks.processor.process.mockResolvedValue({
        gameId: 'game-1',
        transactions: [{ actionId: 'a-1', txId: 'tx-1' }],
        balance: new Money(400n, 'USD'),
      });
    });

    it('runs the processor inside a transaction and maps the result to wire shape', async () => {
      const result = await service.process({
        userId: 'u-1',
        currency: 'USD',
        actions: [{ action: 'bet', actionId: 'a-1', amount: 100 }],
      });

      expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.processor.process).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        game_id: 'game-1',
        transactions: [{ action_id: 'a-1', tx_id: 'tx-1' }],
        balance: 400,
      });
    });

    it('does NOT do a separate balance lookup when actions are present', async () => {
      await service.process({
        userId: 'u-1',
        currency: 'USD',
        actions: [{ action: 'bet', actionId: 'a-1', amount: 100 }],
      });
      expect(mocks.balanceRepository.read).not.toHaveBeenCalled();
    });
  });
});
