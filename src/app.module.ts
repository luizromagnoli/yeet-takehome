import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { PartitionModule } from './partitions/partition.module';

@Module({
  imports: [ConfigModule, DbModule, PartitionModule],
})
export class AppModule {}
