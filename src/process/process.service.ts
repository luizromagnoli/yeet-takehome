import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { KYSELY } from '../db/pool.provider';
import type { Database } from '../db/types';
import { processActions } from '../domain/process-actions';
import type { ProcessRequestDto } from './dto/process.dto';

export interface BalanceOnlyResponse {
  balance: number;
}

export interface ProcessResponse {
  game_id: string;
  transactions: Array<{ action_id: string; tx_id: string }>;
  balance: number;
}

@Injectable()
export class ProcessService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async process(
    body: ProcessRequestDto,
  ): Promise<BalanceOnlyResponse | ProcessResponse> {
    if (!body.actions || body.actions.length === 0) {
      return this.lookupBalance(body.user_id);
    }

    const result = await this.db
      .transaction()
      .execute((trx) => processActions(trx, body));

    return {
      game_id: result.game_id,
      transactions: result.transactions,
      balance: Number(result.balance),
    };
  }

  private async lookupBalance(userId: string): Promise<BalanceOnlyResponse> {
    const result = await sql<{ balance: string }>`
      SELECT balance::text AS balance
      FROM user_balances
      WHERE user_id = ${userId}
    `.execute(this.db);

    const balance = Number(result.rows[0]?.balance ?? '0');
    return { balance };
  }
}
