import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PartitionCronService } from './partition-cron.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [PartitionCronService],
})
export class PartitionModule {}
