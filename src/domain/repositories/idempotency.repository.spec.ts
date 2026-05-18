import type { Transaction } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKyselyMock, type KyselyMock } from '../../test-utils/kysely-mock';
import type { Database } from '../../db/types';
import { asActionId, asUserId } from '../values/ids';
import { IdempotencyRepository } from './idempotency.repository';

vi.mock('node:crypto', async (original) => {
  const actual = await original<typeof import('node:crypto')>();
  return { ...actual, randomUUID: () => 'minted-tx-id' };
});

describe('IdempotencyRepository', () => {
  let repo: IdempotencyRepository;
  let trx: KyselyMock;
  const userId = asUserId('u-1');
  const actionId = asActionId('a-1');

  beforeEach(() => {
    repo = new IdempotencyRepository();
    trx = makeKyselyMock();
  });

  describe('claim', () => {
    it('returns fresh:true with the minted tx_id when the INSERT succeeds', async () => {
      const now = new Date('2026-05-17T12:00:00Z');
      trx.executeTakeFirst.mockResolvedValueOnce({
        tx_id: 'minted-tx-id',
        created_at: now,
      });

      const result = await repo.claim(
        trx as unknown as Transaction<Database>,
        userId,
        actionId,
      );

      expect(result).toEqual({
        fresh: true,
        txId: 'minted-tx-id',
        createdAt: now,
      });
      expect(trx.insertInto).toHaveBeenCalledWith('action_idempotency');
      expect(trx.values).toHaveBeenCalledWith({
        user_id: userId,
        action_id: actionId,
        tx_id: 'minted-tx-id',
      });
      expect(trx.onConflict).toHaveBeenCalledOnce();
      expect(trx.columns).toHaveBeenCalledWith(['user_id', 'action_id']);
      expect(trx.doNothing).toHaveBeenCalledOnce();
      expect(trx.returning).toHaveBeenCalledWith(['tx_id', 'created_at']);
      // The fresh path returns without doing the existing-lookup SELECT.
      expect(trx.selectFrom).not.toHaveBeenCalled();
    });

    it('returns fresh:false with the existing tx_id on conflict', async () => {
      trx.executeTakeFirst.mockResolvedValueOnce(undefined); // INSERT conflicted
      trx.executeTakeFirstOrThrow.mockResolvedValueOnce({ tx_id: 'original-tx' });

      const result = await repo.claim(
        trx as unknown as Transaction<Database>,
        userId,
        actionId,
      );

      expect(result).toEqual({ fresh: false, txId: 'original-tx' });
      expect(trx.selectFrom).toHaveBeenCalledWith('action_idempotency');
      expect(trx.where).toHaveBeenCalledWith('user_id', '=', userId);
      expect(trx.where).toHaveBeenCalledWith('action_id', '=', actionId);
      expect(trx.select).toHaveBeenCalledWith('tx_id');
    });
  });

  describe('find', () => {
    it('returns the tx_id and createdAt when a row exists', async () => {
      const now = new Date('2026-05-17T12:00:00Z');
      trx.executeTakeFirst.mockResolvedValueOnce({
        tx_id: 'existing-tx',
        created_at: now,
      });

      const result = await repo.find(
        trx as unknown as Transaction<Database>,
        userId,
        actionId,
      );

      expect(result).toEqual({ txId: 'existing-tx', createdAt: now });
      expect(trx.selectFrom).toHaveBeenCalledWith('action_idempotency');
      expect(trx.where).toHaveBeenCalledWith('user_id', '=', userId);
      expect(trx.where).toHaveBeenCalledWith('action_id', '=', actionId);
      expect(trx.select).toHaveBeenCalledWith(['tx_id', 'created_at']);
    });

    it('returns null when no row exists', async () => {
      trx.executeTakeFirst.mockResolvedValueOnce(undefined);
      const result = await repo.find(
        trx as unknown as Transaction<Database>,
        userId,
        actionId,
      );
      expect(result).toBeNull();
    });
  });
});
