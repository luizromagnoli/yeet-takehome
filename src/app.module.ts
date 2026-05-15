import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { PartitionModule } from './partitions/partition.module';
import { ProcessModule } from './process/process.module';
import { ReportModule } from './report/report.module';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    AuthModule,
    HealthModule,
    PartitionModule,
    ProcessModule,
    ReportModule,
  ],
})
export class AppModule {}
