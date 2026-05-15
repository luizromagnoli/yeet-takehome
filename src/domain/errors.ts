import { HttpException, HttpStatus } from '@nestjs/common';

export const INSUFFICIENT_FUNDS_CODE = 100;

export class InsufficientFundsError extends HttpException {
  constructor() {
    super(
      {
        code: INSUFFICIENT_FUNDS_CODE,
        message: 'Player has not enough funds to process an action',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
