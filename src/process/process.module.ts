import { Module } from '@nestjs/common';
import { DomainModule } from '../domain/domain.module';
import { ProcessController } from './process.controller';
import { ProcessService } from './process.service';

@Module({
  imports: [DomainModule],
  controllers: [ProcessController],
  providers: [ProcessService],
})
export class ProcessModule {}
