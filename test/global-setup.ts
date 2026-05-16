import { Client } from 'pg';
import { createKysely, createPool } from '../src/db/pool.provider';
import { migrateToLatest } from '../src/db/migrator';
import { ensurePartitions } from '../src/partitions/ensure-partitions';

const TEST_DB = 'yeet_test';

export async function setup(): Promise<void> {
  const baseUrl = adminUrl();
  const testUrl =
    process.env.DATABASE_URL ?? `postgres://yeet:yeet@localhost:5432/${TEST_DB}`;
  process.env.DATABASE_URL = testUrl;
  process.env.BET_PROCESSOR_HMAC_SECRET =
    process.env.BET_PROCESSOR_HMAC_SECRET ?? 'test';

  // Ensure the test database exists. The compose init script creates it on
  // first postgres init, but this fallback lets the tests run against any
  // already-running postgres (e.g., one that pre-dates the init script).
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    const existing = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DB],
    );
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    }
  } finally {
    await admin.end();
  }

  const pool = createPool({ databaseUrl: testUrl });
  const db = createKysely(pool);
  try {
    const { error } = await migrateToLatest(db);
    if (error) throw error;
    await ensurePartitions(db, { monthsAhead: 3 });
  } finally {
    await db.destroy();
  }
}

function adminUrl(): string {
  // Always connect to the management `postgres` database to issue CREATE
  // DATABASE — you cannot create a database while connected to it.
  const explicit = process.env.ADMIN_DATABASE_URL;
  if (explicit) return explicit;
  return 'postgres://yeet:yeet@localhost:5432/postgres';
}
