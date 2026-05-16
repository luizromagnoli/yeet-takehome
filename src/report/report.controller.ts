import { Controller, Get, Logger, Query } from '@nestjs/common';
import { CasinoReportQueryDto, UserReportQueryDto } from './dto/report.dto';
import { ReportService } from './report.service';

@Controller('aggregator/takehome/report')
export class ReportController {
  private readonly logger = new Logger(ReportController.name);

  constructor(private readonly service: ReportService) {}

  @Get('users')
  async users(@Query() query: UserReportQueryDto): Promise<unknown> {
    this.logger.debug(
      `request received [endpoint=users from=${query.from} to=${query.to}` +
        ` cursor=${query.cursor ?? '-'} limit=${query.limit ?? '-'}]`,
    );

    const result = await this.service.userReport(
      query.from,
      query.to,
      query.cursor,
      query.limit,
    );

    this.logger.debug(
      `request processed successfully [endpoint=users` +
        ` users=${result.users.length} next_cursor=${result.next_cursor ?? '-'}]`,
    );

    return result;
  }

  @Get('casino')
  async casino(@Query() query: CasinoReportQueryDto): Promise<unknown> {
    this.logger.debug(
      `request received [endpoint=casino from=${query.from} to=${query.to}]`,
    );

    const result = await this.service.casinoReport(query.from, query.to);

    this.logger.debug(
      `request processed successfully [endpoint=casino` +
        ` currencies=${result.currencies.length}]`,
    );

    return result;
  }
}
