import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Kysely } from 'kysely';
import {
  FileMigrationProvider,
  Migrator,
  type MigrationResult,
} from 'kysely/migration';
import type { Database } from './types';

export interface MigrationOutcome {
  results: MigrationResult[];
  error?: unknown;
}

export function buildMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });
}

export async function migrateToLatest(
  db: Kysely<Database>,
): Promise<MigrationOutcome> {
  const migrator = buildMigrator(db);
  const { error, results } = await migrator.migrateToLatest();
  return { results: results ?? [], error };
}
