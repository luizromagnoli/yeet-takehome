import type { Transaction } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeKyselyMock, type KyselyMock } from '../../../test/helpers/kysely-mock';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import { asGameId, asUserId } from '../values/ids';
import { RoundCloseRepository } from './round-close.repository';

describe('RoundCloseRepository.claim', () => {
  let repo: RoundCloseRepository;
  let trx: KyselyMock;
  const ctx: RequestContext = {
    userId: asUserId('u-1'),
    currency: 'USD',
    game: 'g',
    gameId: asGameId('game-1'),
    finished: true,
  };

  beforeEach(() => {
    repo = new RoundCloseRepository();
    trx = makeKyselyMock();
  });

  it('returns true when the INSERT inserts a fresh row', async () => {
    trx.executeTakeFirst.mockResolvedValueOnce({ user_id: 'u-1' });

    const fresh = await repo.claim(
      trx as unknown as Transaction<Database>,
      ctx,
    );

    expect(fresh).toBe(true);
    expect(trx.insertInto).toHaveBeenCalledWith('round_closes');
    expect(trx.values).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u-1',
        game_id: 'game-1',
      }),
    );
    expect(trx.onConflict).toHaveBeenCalledOnce();
    expect(trx.columns).toHaveBeenCalledWith(['user_id', 'game_id', 'day']);
    expect(trx.doNothing).toHaveBeenCalledOnce();
    expect(trx.returning).toHaveBeenCalledWith('user_id');
    expect(trx.executeTakeFirst).toHaveBeenCalledOnce();
  });

  it('returns false when the INSERT conflicts and returns no row', async () => {
    trx.executeTakeFirst.mockResolvedValueOnce(undefined);

    const fresh = await repo.claim(
      trx as unknown as Transaction<Database>,
      ctx,
    );

    expect(fresh).toBe(false);
    // We still issued the INSERT; we just didn't get a row back.
    expect(trx.insertInto).toHaveBeenCalledOnce();
    expect(trx.doNothing).toHaveBeenCalledOnce();
  });

  it('writes the day field as a YYYY-MM-DD slice of today', async () => {
    trx.executeTakeFirst.mockResolvedValueOnce({ user_id: 'u-1' });
    await repo.claim(trx as unknown as Transaction<Database>, ctx);
    const written = trx.values.mock.calls[0][0] as { day: string };
    expect(written.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
