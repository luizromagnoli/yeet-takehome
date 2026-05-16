import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types';
import { asTxId, type ActionId, type TxId, type UserId } from '../values/ids';

export interface IdempotencyClaim {
  fresh: boolean;
  txId: TxId;
  createdAt?: Date;
}

export interface OriginalClaim {
  txId: TxId;
  createdAt: Date;
}

@Injectable()
export class IdempotencyRepository {
  async claim(
    trx: Transaction<Database>,
    userId: UserId,
    actionId: ActionId,
  ): Promise<IdempotencyClaim> {
    const newTxId = asTxId(randomUUID());
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
        txId: inserted.tx_id,
        createdAt: inserted.created_at as Date,
      };
    }

    const existing = await trx
      .selectFrom('action_idempotency')
      .where('user_id', '=', userId)
      .where('action_id', '=', actionId)
      .select('tx_id')
      .executeTakeFirstOrThrow();
    return { fresh: false, txId: existing.tx_id };
  }

  async find(
    trx: Transaction<Database>,
    userId: UserId,
    actionId: ActionId,
  ): Promise<OriginalClaim | null> {
    const row = await trx
      .selectFrom('action_idempotency')
      .where('user_id', '=', userId)
      .where('action_id', '=', actionId)
      .select(['tx_id', 'created_at'])
      .executeTakeFirst();
    if (!row) return null;
    return { txId: row.tx_id, createdAt: row.created_at as Date };
  }
}
