import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type Kysely, sql } from 'kysely';
import { KYSELY } from '../db/pool.provider';
import type { Database } from '../db/types';
import { pruneExpired } from './prune-expired';

const LOCK_KEY = 'idempotency_cleanup';
const DEFAULT_RETENTION_DAYS = 90;

@Injectable()
export class IdempotencyCleanupService {
  private readonly logger = new Logger(IdempotencyCleanupService.name);

  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  @Cron('0 4 * * *')
  async runDaily(): Promise<void> {
    const retentionDays = Number(
      process.env.ACTION_IDEMPOTENCY_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS,
    );

    // Single-leader semantics across horizontally-scaled instances: only the
    // instance that wins the advisory lock prunes. Others observe the false
    // return and exit. The lock auto-releases on session disconnect, and we
    // also explicitly unlock in the finally so connection reuse stays correct.
    const lockResult = await sql<{ acquired: boolean }>`
      SELECT pg_try_advisory_lock(hashtext(${LOCK_KEY})) AS acquired
    `.execute(this.db);
    const acquired = lockResult.rows[0]?.acquired === true;

    if (!acquired) {
      this.logger.debug(
        'idempotency cleanup lock not acquired, another instance is running',
      );
      return;
    }

    try {
      const deleted = await pruneExpired(this.db, { retentionDays });
      this.logger.log(
        `pruned ${deleted} idempotency rows older than ${retentionDays} days`,
      );
    } finally {
      await sql`SELECT pg_advisory_unlock(hashtext(${LOCK_KEY}))`.execute(this.db);
    }
  }
}
