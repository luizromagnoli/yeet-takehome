import type { ColumnType } from 'kysely';
import type { ActionId, GameId, TxId, UserId } from '../domain/values/ids';

export type Generated<T> = ColumnType<T, T | undefined, T>;

export type ActionKind = 'bet' | 'win' | 'rollback';
export type ActionStatus = 'applied' | 'noop' | 'rolled_back';

export interface UsersTable {
  id: UserId;
  currency: string;
  created_at: Generated<Date>;
}

export interface UserBalancesTable {
  user_id: UserId;
  currency: string;
  balance: bigint;
  updated_at: Generated<Date>;
}

export interface ActionsTable {
  tx_id: TxId;
  action_id: ActionId;
  user_id: UserId;
  currency: string;
  game: string;
  game_id: GameId;
  kind: ActionKind;
  amount: bigint | null;
  original_action_id: ActionId | null;
  status: ActionStatus;
  balance_delta: bigint;
  created_at: Generated<Date>;
}

export interface ActionIdempotencyTable {
  user_id: UserId;
  action_id: ActionId;
  tx_id: TxId;
  created_at: Generated<Date>;
}

export interface PendingRollbacksTable {
  user_id: UserId;
  original_action_id: ActionId;
  rollback_action_id: ActionId;
  rollback_tx_id: TxId;
  created_at: Generated<Date>;
}

export interface UserDailyStatsTable {
  user_id: UserId;
  currency: string;
  day: string;
  bets: Generated<bigint>;
  wins: Generated<bigint>;
  rounds: Generated<number>;
  rolled_back_bets: Generated<bigint>;
  rolled_back_wins: Generated<bigint>;
}

export interface Database {
  users: UsersTable;
  user_balances: UserBalancesTable;
  actions: ActionsTable;
  action_idempotency: ActionIdempotencyTable;
  pending_rollbacks: PendingRollbacksTable;
  user_daily_stats: UserDailyStatsTable;
}
