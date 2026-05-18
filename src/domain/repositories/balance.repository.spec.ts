import type { Kysely, Transaction } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeKyselyMock, type KyselyMock } from '../../test-utils/kysely-mock';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import { CurrencyMismatchError } from '../errors';
import { asGameId, asUserId } from '../values/ids';
import { Money } from '../values/money';
import { BalanceRepository } from './balance.repository';

describe('BalanceRepository', () => {
  let repo: BalanceRepository;
  let trx: KyselyMock;
  const ctx: RequestContext = {
    userId: asUserId('u-1'),
    currency: 'USD',
    game: 'g',
    gameId: asGameId('game-1'),
    finished: false,
  };

  beforeEach(() => {
    repo = new BalanceRepository();
    trx = makeKyselyMock();
  });

  describe('ensureUser', () => {
    it('upserts users and user_balances, then accepts the existing currency match', async () => {
      trx.executeTakeFirstOrThrow.mockResolvedValueOnce({ currency: 'USD' });

      await repo.ensureUser(trx as unknown as Transaction<Database>, ctx);

      expect(trx.insertInto).toHaveBeenCalledWith('users');
      expect(trx.insertInto).toHaveBeenCalledWith('user_balances');
      // Both upserts use ON CONFLICT DO NOTHING.
      expect(trx.doNothing).toHaveBeenCalledTimes(2);
      // Currency lookup followed.
      expect(trx.selectFrom).toHaveBeenCalledWith('users');
      expect(trx.select).toHaveBeenCalledWith('currency');
    });

    it('throws CurrencyMismatchError when stored currency differs from request', async () => {
      trx.executeTakeFirstOrThrow.mockResolvedValueOnce({ currency: 'EUR' });

      await expect(
        repo.ensureUser(trx as unknown as Transaction<Database>, ctx),
      ).rejects.toBeInstanceOf(CurrencyMismatchError);
    });
  });

  describe('lockBalance', () => {
    it('issues SELECT … FOR UPDATE and returns a Money', async () => {
      trx.executeTakeFirstOrThrow.mockResolvedValueOnce({
        balance: 500n,
        currency: 'USD',
      });

      const money = await repo.lockBalance(
        trx as unknown as Transaction<Database>,
        ctx.userId,
      );

      expect(money.amount).toBe(500n);
      expect(money.currency).toBe('USD');
      expect(trx.selectFrom).toHaveBeenCalledWith('user_balances');
      expect(trx.where).toHaveBeenCalledWith('user_id', '=', ctx.userId);
      expect(trx.select).toHaveBeenCalledWith(['balance', 'currency']);
      expect(trx.forUpdate).toHaveBeenCalledOnce();
    });
  });

  describe('read', () => {
    it('returns a Money when the user has a balance row', async () => {
      trx.executeTakeFirst.mockResolvedValueOnce({
        balance: 100n,
        currency: 'USD',
      });

      const m = await repo.read(
        trx as unknown as Kysely<Database>,
        ctx.userId,
      );
      expect(m).toEqual(new Money(100n, 'USD'));
      // Non-locking read — must NOT acquire FOR UPDATE.
      expect(trx.forUpdate).not.toHaveBeenCalled();
    });

    it('returns null when no row exists', async () => {
      trx.executeTakeFirst.mockResolvedValueOnce(undefined);
      const m = await repo.read(
        trx as unknown as Kysely<Database>,
        ctx.userId,
      );
      expect(m).toBeNull();
    });
  });

  describe('update', () => {
    it('updates the balance and bumps updated_at', async () => {
      await repo.update(
        trx as unknown as Transaction<Database>,
        ctx.userId,
        new Money(750n, 'USD'),
      );

      expect(trx.updateTable).toHaveBeenCalledWith('user_balances');
      expect(trx.where).toHaveBeenCalledWith('user_id', '=', ctx.userId);
      const set = trx.set.mock.calls[0][0] as {
        balance: bigint;
        updated_at: Date;
      };
      expect(set.balance).toBe(750n);
      expect(set.updated_at).toBeInstanceOf(Date);
      expect(trx.execute).toHaveBeenCalledOnce();
    });
  });
});
