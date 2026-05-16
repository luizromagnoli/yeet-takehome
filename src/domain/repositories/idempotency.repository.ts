import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';

export interface IdempotencyClaim {
  fresh: boolean;
  tx_id: string;
  created_at?: Date;
}

export interface OriginalClaim {
  tx_id: string;
  created_at: Date;
}

@Injectable()
export class IdempotencyRepository {
  async claim(
    trx: Transaction<Database>,
    userId: string,
    actionId: string,
  ): Promise<IdempotencyClaim> {
    const newTxId = randomUUID();
    const inserted = await trx
      .insertInto('action_idempotency')
      .values({ user_id: userId, action_id: actionId, tx_id: newTxId })
      .onConflict((oc) =>
        oc.columns(['user_id', 'action_id']).doNothing(),
      )
      .returning(['tx_id', 'created_at'])
      .executeTakeFirst();

    if (inserted) {
      return {
        fresh: true,
        tx_id: inserted.tx_id,
        created_at: inserted.created_at as Date,
      };
    }

    const existing = await trx
      .selectFrom('action_idempotency')
      .where('user_id', '=', userId)
      .where('action_id', '=', actionId)
      .select('tx_id')
      .executeTakeFirstOrThrow();
    return { fresh: false, tx_id: existing.tx_id };
  }

  async find(
    trx: Transaction<Database>,
    userId: string,
    actionId: string,
  ): Promise<OriginalClaim | null> {
    const row = await trx
      .selectFrom('action_idempotency')
      .where('user_id', '=', userId)
      .where('action_id', '=', actionId)
      .select(['tx_id', 'created_at'])
      .executeTakeFirst();
    if (!row) return null;
    return { tx_id: row.tx_id, created_at: row.created_at as Date };
  }
}
