import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { ProcessRequestDto } from './dto/process.dto';
import { ProcessService, type ProcessResponse } from './process.service';

@Controller('aggregator/takehome')
export class ProcessController {
  private readonly logger = new Logger(ProcessController.name);

  constructor(private readonly service: ProcessService) {}

  @Post('process')
  @HttpCode(200)
  async process(@Body() body: ProcessRequestDto): Promise<ProcessResponse> {
    this.logger.debug(
      `request received [userId=${body.userId} currency=${body.currency}` +
        ` gameId=${body.gameId ?? '-'} actions=${body.actions?.length ?? 0}]`,
    );

    const result = await this.service.process(body);

    this.logger.debug(
      `request processed successfully [userId=${body.userId}` +
        ` balance=${result.balance}]`,
    );

    return result;
  }
}
