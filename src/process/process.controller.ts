import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { ProcessRequestDto } from './dto/process.dto';
import { ProcessService } from './process.service';

@Controller('aggregator/takehome')
export class ProcessController {
  private readonly logger = new Logger(ProcessController.name);

  constructor(private readonly service: ProcessService) {}

  @Post('process')
  @HttpCode(200)
  async process(@Body() body: ProcessRequestDto): Promise<unknown> {
    const actionCount = body.actions?.length ?? 0;
    this.logger.debug(
      `request received [user_id=${body.user_id} currency=${body.currency}` +
        ` game_id=${body.game_id ?? '-'} actions=${actionCount}]`,
    );

    const result = await this.service.process(body);

    const balance = (result as { balance: number }).balance;
    this.logger.debug(
      `request processed successfully [user_id=${body.user_id}` +
        ` balance=${balance}]`,
    );

    return result;
  }
}
