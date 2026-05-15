import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ProcessRequestDto } from './dto/process.dto';
import { ProcessService } from './process.service';

@Controller('aggregator/takehome')
export class ProcessController {
  constructor(private readonly service: ProcessService) {}

  @Post('process')
  @HttpCode(200)
  async process(@Body() body: ProcessRequestDto): Promise<unknown> {
    return this.service.process(body);
  }
}
