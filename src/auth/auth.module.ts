import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HmacGuard } from './hmac.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: HmacGuard,
    },
  ],
})
export class AuthModule {}
