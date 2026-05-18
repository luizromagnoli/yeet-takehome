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

/**
 * Returns a Postgres connection string from the environment.
 *
 * Prefers `DATABASE_URL` when set (local dev, docker compose, every existing
 * CLI script). Falls back to composing the URL from the discrete `DB_HOST`,
 * `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` env vars that the AWS CDK
 * stack injects — Secrets Manager wires `DB_USER`/`DB_PASSWORD` as `ecs.Secret`
 * values resolved by the ECS agent at task start, and the other three as
 * plain env from RDS endpoint outputs. Throws if neither source is usable.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
    throw new Error(
      'database connection not configured: set DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD',
    );
  }
  const user = encodeURIComponent(DB_USER);
  const pass = encodeURIComponent(DB_PASSWORD);
  const port = DB_PORT ?? '5432';
  const name = DB_NAME ?? 'yeet';
  return `postgres://${user}:${pass}@${DB_HOST}:${port}/${name}`;
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
