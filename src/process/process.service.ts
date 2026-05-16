import { Inject, Injectable } from '@nestjs/common';
import { type Kysely } from 'kysely';
import { KYSELY } from '../db/pool.provider';
import type { Database } from '../db/types';
import { ActionProcessor } from '../domain/action-processor';
import { BalanceRepository } from '../domain/repositories/balance.repository';
import { asUserId } from '../domain/values/ids';
import type { ProcessRequestDto } from './dto/process.dto';

export interface ProcessResponse {
  game_id?: string;
  transactions?: Array<{ action_id: string; tx_id: string }>;
  balance: number;
}

@Injectable()
export class ProcessService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly processor: ActionProcessor,
    private readonly balances: BalanceRepository,
  ) {}

  async process(body: ProcessRequestDto): Promise<ProcessResponse> {
    if (!body.actions || body.actions.length === 0) {
      return this.lookupBalance(body.userId);
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

  private async lookupBalance(userId: string): Promise<ProcessResponse> {
    const balance = await this.balances.read(this.db, asUserId(userId));
    return { balance: balance?.toNumber() ?? 0 };
  }
}
