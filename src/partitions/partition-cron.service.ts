import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type Kysely, sql } from 'kysely';
import { KYSELY } from '../db/pool.provider';
import type { Database } from '../db/types';
import { ensurePartitions } from './ensure-partitions';

const LOCK_KEY = 'ensure_partitions';

@Injectable()
export class PartitionCronService {
  private readonly logger = new Logger(PartitionCronService.name);

  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  @Cron('0 3 * * *')
  async runDaily(): Promise<void> {
    // Single-leader semantics across horizontally-scaled instances: only the
    // instance that wins the advisory lock executes the DDL. Others observe
    // the false return and exit. The lock auto-releases on session
    // disconnect, and we also explicitly unlock in the finally so connection
    // reuse stays correct.
    const lockResult = await sql<{ acquired: boolean }>`
      SELECT pg_try_advisory_lock(hashtext(${LOCK_KEY})) AS acquired
    `.execute(this.db);
    const acquired = lockResult.rows[0]?.acquired === true;

    if (!acquired) {
      this.logger.debug('partition lock not acquired, another instance is running');
      return;
    }

    try {
      const partitions = await ensurePartitions(this.db, { monthsAhead: 3 });
      this.logger.log(`partition coverage ensured (${partitions.length} partitions)`);
    } finally {
      await sql`SELECT pg_advisory_unlock(hashtext(${LOCK_KEY}))`.execute(this.db);
    }
  }
}
