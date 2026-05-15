import { Logger, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { type Kysely, sql } from 'kysely';
import { AppModule } from '../../src/app.module';
import { KYSELY } from '../../src/db/pool.provider';
import type { Database } from '../../src/db/types';

export interface TestApp {
  app: NestFastifyApplication;
  db: Kysely<Database>;
}

export async function createTestApp(): Promise<TestApp> {
  if (process.env.NEST_DISABLE_LOGS === '1') {
    Logger.overrideLogger(false);
  }

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { rawBody: true },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const db = app.get<Kysely<Database>>(KYSELY);
  return { app, db };
}

export async function resetDatabase(db: Kysely<Database>): Promise<void> {
  await sql`
    TRUNCATE TABLE
      actions,
      action_idempotency,
      pending_rollbacks,
      user_daily_stats,
      user_balances,
      users
    CASCADE
  `.execute(db);
}

export async function seedUser(
  db: Kysely<Database>,
  userId: string,
  currency: string,
  balance: bigint,
): Promise<void> {
  await db
    .insertInto('users')
    .values({ id: userId, currency })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  await db
    .insertInto('user_balances')
    .values({ user_id: userId, currency, balance })
    .onConflict((oc) =>
      oc.column('user_id').doUpdateSet((eb) => ({
        balance: eb.ref('excluded.balance'),
      })),
    )
    .execute();
}
