import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';

@Module({
  imports: [ConfigModule, DbModule],
})
export class AppModule {}
