import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import type { RequestContext } from '../action-context';
import { isoDate } from '../util/dates';

@Injectable()
export class RoundCloseRepository {
  /**
   * Atomically records that this (user, game_id, day) round has been closed.
   * Returns true if the claim was fresh (first finished=true for this
   * round), false if the round had already been closed by an earlier
   * request. Callers use the boolean to gate the rounds-counter bump so it
   * runs exactly once per round regardless of retry or split-request shape.
   */
  async claim(
    trx: Transaction<Database>,
    ctx: RequestContext,
  ): Promise<boolean> {
    const day = isoDate(new Date());
    const inserted = await trx
      .insertInto('round_closes')
      .values({ user_id: ctx.userId, game_id: ctx.gameId, day })
      .onConflict((oc) =>
        oc.columns(['user_id', 'game_id', 'day']).doNothing(),
      )
      .returning('user_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }
}
