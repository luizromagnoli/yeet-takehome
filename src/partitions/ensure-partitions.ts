import { type Kysely, sql } from 'kysely';
import type { Database } from '../db/types';
import { monthBoundary, partitionName } from './partition-utils';

export interface EnsurePartitionsOptions {
  monthsAhead: number;
  reference?: Date;
}

export async function ensurePartitions(
  db: Kysely<Database>,
  opts: EnsurePartitionsOptions,
): Promise<string[]> {
  const reference = opts.reference ?? new Date();
  const created: string[] = [];

  for (let i = 0; i <= opts.monthsAhead; i++) {
    const start = monthBoundary(reference, i);
    const end = monthBoundary(reference, i + 1);
    const name = partitionName(start);

    const result = await sql.raw(
      `CREATE TABLE IF NOT EXISTS ${name} ` +
        `PARTITION OF actions ` +
        `FOR VALUES FROM ('${start.iso}') TO ('${end.iso}')`,
    ).execute(db);

    // pg's CREATE TABLE IF NOT EXISTS does not tell us whether it actually
    // created the table. Check existence post-fact by counting matching
    // entries in pg_inherits — cheap and exact.
    void result;
    const exists = await sql<{ exists: boolean }>`
      SELECT EXISTS(
        SELECT 1 FROM pg_inherits
        WHERE inhrelid = ${name}::regclass
          AND inhparent = 'actions'::regclass
      ) AS exists
    `.execute(db);

    if (exists.rows[0]?.exists) {
      // Only report partitions that didn't exist before this call by checking
      // pg_stat_user_tables timestamps would be overkill; we report all
      // ensured partitions and let the caller dedupe on prior known state.
      created.push(name);
    }
  }

  return created;
}
