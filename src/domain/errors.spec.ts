import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  CURRENCY_MISMATCH_CODE,
  CurrencyMismatchError,
  INSUFFICIENT_FUNDS_CODE,
  InsufficientFundsError,
} from './errors';

describe('domain errors', () => {
  describe('InsufficientFundsError', () => {
    it('uses HTTP 400 and the spec-exact payload', () => {
      const err = new InsufficientFundsError();
      expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(err.getResponse()).toEqual({
        code: INSUFFICIENT_FUNDS_CODE,
        message: 'Player has not enough funds to process an action',
      });
    });

    it('exposes code 100 (spec-defined value)', () => {
      expect(INSUFFICIENT_FUNDS_CODE).toBe(100);
    });
  });

  describe('CurrencyMismatchError', () => {
    it('encodes the requested/stored mismatch in the message', () => {
      const err = new CurrencyMismatchError('EUR', 'USD');
      expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(err.getResponse()).toEqual({
        code: CURRENCY_MISMATCH_CODE,
        message: 'currency mismatch: user is registered as USD, request used EUR',
      });
    });

    it('uses an out-of-band code that does not collide with insufficient funds', () => {
      expect(CURRENCY_MISMATCH_CODE).toBe(101);
      expect(CURRENCY_MISMATCH_CODE).not.toBe(INSUFFICIENT_FUNDS_CODE);
    });
  });
});
