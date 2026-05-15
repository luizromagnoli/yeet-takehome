import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { SkipHmac } from '../auth/hmac.guard';
import { KYSELY } from '../db/pool.provider';
import type { Database } from '../db/types';

@Controller()
export class HealthController {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  @Get('/health')
  @SkipHmac()
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('/ready')
  @SkipHmac()
  async ready(): Promise<{ status: string }> {
    try {
      await sql`SELECT 1`.execute(this.db);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not ready' });
    }
  }
}
