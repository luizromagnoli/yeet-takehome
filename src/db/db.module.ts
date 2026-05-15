import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Kysely } from 'kysely';
import { createKysely, createPool, KYSELY } from './pool.provider';
import type { Database } from './types';

@Module({
  providers: [
    {
      provide: KYSELY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Kysely<Database> => {
        const databaseUrl = config.getOrThrow<string>('DATABASE_URL');
        const pool = createPool({ databaseUrl });
        return createKysely(pool);
      },
    },
  ],
  exports: [KYSELY],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
