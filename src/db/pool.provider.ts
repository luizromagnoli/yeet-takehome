import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Database } from './types';

export const KYSELY = Symbol('Kysely');

export interface PoolOptions {
  databaseUrl: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  statementTimeoutMillis?: number;
}

export function createPool(opts: PoolOptions): Pool {
  return new Pool({
    connectionString: opts.databaseUrl,
    max: opts.max ?? 20,
    idleTimeoutMillis: opts.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 5_000,
    statement_timeout: opts.statementTimeoutMillis ?? 10_000,
  });
}

export function createKysely(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}
