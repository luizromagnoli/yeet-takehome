import type { ColumnType } from 'kysely';

export type Generated<T> = ColumnType<T, T | undefined, T>;

export type ActionKind = 'bet' | 'win' | 'rollback';
export type ActionStatus = 'applied' | 'noop' | 'rolled_back';

export interface UsersTable {
  id: string;
  currency: string;
  created_at: Generated<Date>;
}

export interface UserBalancesTable {
  user_id: string;
  currency: string;
  balance: bigint;
  updated_at: Generated<Date>;
}

export interface ActionsTable {
  tx_id: string;
  action_id: string;
  user_id: string;
  currency: string;
  game: string;
  game_id: string;
  kind: ActionKind;
  amount: bigint | null;
  original_action_id: string | null;
  status: ActionStatus;
  balance_delta: bigint;
  created_at: Generated<Date>;
}

export interface ActionIdempotencyTable {
  user_id: string;
  action_id: string;
  tx_id: string;
  created_at: Generated<Date>;
}

export interface PendingRollbacksTable {
  user_id: string;
  original_action_id: string;
  rollback_action_id: string;
  rollback_tx_id: string;
  created_at: Generated<Date>;
}

export interface UserDailyStatsTable {
  user_id: string;
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
