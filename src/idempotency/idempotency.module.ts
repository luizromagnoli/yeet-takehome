import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [IdempotencyCleanupService],
})
export class IdempotencyModule {}
