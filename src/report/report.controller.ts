import { Controller, Get, Query } from '@nestjs/common';
import { CasinoReportQueryDto, UserReportQueryDto } from './dto/report.dto';
import { ReportService } from './report.service';

@Controller('aggregator/takehome/report')
export class ReportController {
  constructor(private readonly service: ReportService) {}

  @Get('users')
  async users(@Query() query: UserReportQueryDto): Promise<unknown> {
    return this.service.userReport(
      query.from,
      query.to,
      query.cursor,
      query.limit,
    );
  }

  @Get('casino')
  async casino(@Query() query: CasinoReportQueryDto): Promise<unknown> {
    return this.service.casinoReport(query.from, query.to);
  }
}
