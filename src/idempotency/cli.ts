import { config as loadEnv } from 'dotenv';
import { createKysely, createPool } from '../db/pool.provider';
import { pruneExpired } from './prune-expired';

const DEFAULT_RETENTION_DAYS = 90;

async function main(): Promise<void> {
  loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const retentionDays = Number(
    process.env.ACTION_IDEMPOTENCY_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS,
  );

  const pool = createPool({ databaseUrl });
  const db = createKysely(pool);

  const deleted = await pruneExpired(db, { retentionDays });
  console.log(`pruned ${deleted} idempotency rows older than ${retentionDays} days`);

  await db.destroy();
}

void main();
