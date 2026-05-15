import { Pool, types } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Database } from './types';

// Parse INT8 / BIGINT as native bigint so the application reasons about
// money in arbitrary-precision integers and never silently loses precision
// across Number.MAX_SAFE_INTEGER.
types.setTypeParser(types.builtins.INT8, (value: string) => BigInt(value));

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
