import { HttpException, HttpStatus } from '@nestjs/common';

export const INSUFFICIENT_FUNDS_CODE = 100;
export const CURRENCY_MISMATCH_CODE = 101;

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

export class CurrencyMismatchError extends HttpException {
  constructor(requested: string, stored: string) {
    super(
      {
        code: CURRENCY_MISMATCH_CODE,
        message: `currency mismatch: user is registered as ${stored}, request used ${requested}`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
