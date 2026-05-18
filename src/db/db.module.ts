import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  createKysely,
  createPool,
  KYSELY,
  resolveDatabaseUrl,
} from './pool.provider';
import type { Database } from './types';

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      useFactory: (): Kysely<Database> => {
        const pool = createPool({ databaseUrl: resolveDatabaseUrl() });
        return createKysely(pool);
      },
    },
  ],
  exports: [KYSELY],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown(): Promise<void> {
    // Kysely's destroy() closes the pg connection pool — it does not touch
    // any data. Same idea as pg.Pool.end().
    await this.db.destroy();
  }
}
