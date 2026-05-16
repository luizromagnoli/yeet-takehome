import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { KYSELY } from '../db/pool.provider';
import type { Database } from '../db/types';
import { ActionProcessor } from '../domain/action-processor';
import type { ProcessRequestDto } from './dto/process.dto';

export interface BalanceOnlyResponse {
  balance: number;
}

export interface ProcessResponse {
  game_id: string;
  transactions: Array<{ action_id: string; tx_id: string }>;
  balance: number;
}

export type ProcessActionResult = BalanceOnlyResponse | ProcessResponse;

@Injectable()
export class ProcessService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly processor: ActionProcessor,
  ) {}

  async process(body: ProcessRequestDto): Promise<ProcessActionResult> {
    if (!body.actions || body.actions.length === 0) {
      return this.lookupBalance(body.user_id);
    }

    const result = await this.db
      .transaction()
      .execute((trx) => this.processor.process(trx, body));

    return {
      game_id: result.gameId,
      transactions: result.transactions.map((t) => ({
        action_id: t.actionId,
        tx_id: t.txId,
      })),
      balance: result.balance.toNumber(),
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
