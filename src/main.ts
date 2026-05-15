import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { Kysely } from 'kysely';
import { AppModule } from './app.module';
import { KYSELY } from './db/pool.provider';
import type { Database } from './db/types';
import { ensurePartitions } from './partitions/ensure-partitions';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { rawBody: true, bufferLogs: true },
  );

  app.enableShutdownHooks();

  const logger = new Logger('Bootstrap');
  const db = app.get<Kysely<Database>>(KYSELY);
  const monthsAhead = Number(process.env.PARTITIONS_MONTHS_AHEAD ?? 3);
  const partitions = await ensurePartitions(db, { monthsAhead });
  logger.log(`partition coverage verified (${partitions.length} partitions)`);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

void bootstrap();
