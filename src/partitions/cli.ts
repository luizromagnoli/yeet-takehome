import { config as loadEnv } from 'dotenv';
import { createKysely, createPool } from '../db/pool.provider';
import { ensurePartitions } from './ensure-partitions';

async function main(): Promise<void> {
  loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const monthsAhead = Number(process.env.PARTITIONS_MONTHS_AHEAD ?? 3);

  const pool = createPool({ databaseUrl });
  const db = createKysely(pool);

  const ensured = await ensurePartitions(db, { monthsAhead });
  for (const name of ensured) {
    console.log(`  ok      ${name}`);
  }

  await db.destroy();
}

void main();
