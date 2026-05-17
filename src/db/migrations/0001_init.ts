import { type Kysely, sql } from 'kysely';

const ACTIONS_INITIAL_PARTITIONS_AHEAD = 3;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);

  await sql`
    CREATE TABLE users (
      id text PRIMARY KEY,
      currency text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE user_balances (
      user_id text PRIMARY KEY REFERENCES users(id),
      currency text NOT NULL,
      balance bigint NOT NULL CHECK (balance >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE actions (
      tx_id uuid NOT NULL DEFAULT gen_random_uuid(),
      action_id uuid NOT NULL,
      user_id text NOT NULL,
      currency text NOT NULL,
      game text NOT NULL,
      game_id text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('bet','win','rollback')),
      amount bigint,
      original_action_id uuid,
      status text NOT NULL CHECK (status IN ('applied','noop','rolled_back')),
      balance_delta bigint NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tx_id, created_at)
    ) PARTITION BY RANGE (created_at)
  `.execute(db);

  await sql`
    CREATE INDEX actions_user_created_idx ON actions (user_id, created_at DESC)
  `.execute(db);

  // Seed the parent with the current month plus the next two so the table is
  // immediately usable. ensurePartitions() keeps it topped up afterwards.
  const now = new Date();
  for (let i = 0; i < ACTIONS_INITIAL_PARTITIONS_AHEAD; i++) {
    const start = monthStart(now, i);
    const end = monthStart(now, i + 1);
    const name = `actions_${start.yyyy}_${start.mm}`;
    await sql.raw(
      `CREATE TABLE ${name} PARTITION OF actions ` +
        `FOR VALUES FROM ('${start.iso}') TO ('${end.iso}')`,
    ).execute(db);
  }

  // Plain table — see the architecture-decisions section of README.md. We
  // treat this as operational state rather than history: a daily cron prunes
  // rows older than the rollback window, which bounds the row count and
  // removes the case for partitioning. The created_at index supports that
  // cron's range delete.
  await sql`
    CREATE TABLE action_idempotency (
      user_id text NOT NULL,
      action_id uuid NOT NULL,
      tx_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, action_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX action_idempotency_created_idx
      ON action_idempotency (created_at)
  `.execute(db);

  await sql`
    CREATE TABLE pending_rollbacks (
      user_id text NOT NULL,
      original_action_id uuid NOT NULL,
      rollback_action_id uuid NOT NULL,
      rollback_tx_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, original_action_id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE user_daily_stats (
      user_id text NOT NULL,
      currency text NOT NULL,
      day date NOT NULL,
      bets bigint NOT NULL DEFAULT 0,
      wins bigint NOT NULL DEFAULT 0,
      rounds integer NOT NULL DEFAULT 0,
      rolled_back_bets bigint NOT NULL DEFAULT 0,
      rolled_back_wins bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, currency, day)
    )
  `.execute(db);

  await sql`
    CREATE INDEX user_daily_stats_day_idx ON user_daily_stats (day)
  `.execute(db);
}

interface MonthBoundary {
  yyyy: string;
  mm: string;
  iso: string;
}

function monthStart(reference: Date, offsetMonths: number): MonthBoundary {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const d = new Date(Date.UTC(year, month + offsetMonths, 1));
  const yyyy = d.getUTCFullYear().toString();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const iso = `${yyyy}-${mm}-01`;
  return { yyyy, mm, iso };
}
