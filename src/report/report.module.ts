import { Module } from '@nestjs/common';
import { DomainModule } from '../domain/domain.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

@Module({
  imports: [DomainModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
