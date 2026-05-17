import { type Kysely, sql } from 'kysely';
import type { Database } from '../db/types';

export interface PruneOptions {
  retentionDays: number;
  batchSize?: number;
  maxBatches?: number;
}

const DEFAULT_BATCH_SIZE = 10_000;
// Safety cap: bounds a single run at ~10M rows even if the table is wildly out
// of retention. The daily cron picks up where this leaves off.
const DEFAULT_MAX_BATCHES = 1_000;

/**
 * Deletes action_idempotency rows older than the retention window. Runs as a
 * loop of small DELETEs so dead tuples are spread across batches and autovacuum
 * can keep pace. Each batch commits independently; an aborted run resumes
 * cleanly on the next invocation.
 */
export async function pruneExpired(
  db: Kysely<Database>,
  options: PruneOptions,
): Promise<number> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  const cutoff = new Date(Date.now() - options.retentionDays * 86_400_000);

  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const result = await sql<{ deleted: number }>`
      WITH deleted AS (
        DELETE FROM action_idempotency
        WHERE ctid IN (
          SELECT ctid FROM action_idempotency
          WHERE created_at < ${cutoff}
          LIMIT ${batchSize}
        )
        RETURNING 1
      )
      SELECT count(*)::int AS deleted FROM deleted
    `.execute(db);
    const deleted = result.rows[0]?.deleted ?? 0;
    total += deleted;
    if (deleted === 0) break;
  }
  return total;
}
