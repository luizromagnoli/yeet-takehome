import { config as loadEnv } from 'dotenv';
import { createKysely, createPool } from './pool.provider';
import { migrateToLatest } from './migrator';

async function main(): Promise<void> {
  loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = createPool({ databaseUrl });
  const db = createKysely(pool);

  const { results, error } = await migrateToLatest(db);

  for (const result of results) {
    const status = result.status.toLowerCase().padEnd(7);
    console.log(`  ${status} ${result.migrationName}`);
  }

  await db.destroy();

  if (error) {
    console.error('migration failed:', error);
    process.exit(1);
  }
}

void main();
