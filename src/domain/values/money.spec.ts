import { describe, expect, it } from 'vitest';
import { Money } from './money';

describe('Money', () => {
  describe('constructors', () => {
    it('exposes amount and currency', () => {
      const m = new Money(100n, 'USD');
      expect(m.amount).toBe(100n);
      expect(m.currency).toBe('USD');
    });

    it('Money.zero creates a zero-amount Money in the given currency', () => {
      const z = Money.zero('EUR');
      expect(z.amount).toBe(0n);
      expect(z.currency).toBe('EUR');
    });

    it('Money.of accepts a bigint', () => {
      const m = Money.of(250n, 'GBP');
      expect(m.amount).toBe(250n);
    });

    it('Money.of accepts a number and converts to bigint', () => {
      const m = Money.of(250, 'GBP');
      expect(m.amount).toBe(250n);
      expect(typeof m.amount).toBe('bigint');
    });
  });

  describe('arithmetic', () => {
    it('adds two same-currency Moneys', () => {
      const a = new Money(100n, 'USD');
      const b = new Money(250n, 'USD');
      expect(a.add(b).amount).toBe(350n);
    });

    it('subtracts two same-currency Moneys', () => {
      const a = new Money(100n, 'USD');
      const b = new Money(70n, 'USD');
      expect(a.subtract(b).amount).toBe(30n);
    });

    it('negates the amount and keeps the currency', () => {
      const m = new Money(100n, 'USD').negate();
      expect(m.amount).toBe(-100n);
      expect(m.currency).toBe('USD');
    });

    it('throws on cross-currency addition', () => {
      expect(() => new Money(100n, 'USD').add(new Money(100n, 'EUR'))).toThrow(
        /currency mismatch/,
      );
    });

    it('throws on cross-currency subtraction', () => {
      expect(() =>
        new Money(100n, 'USD').subtract(new Money(100n, 'EUR')),
      ).toThrow(/currency mismatch/);
    });

    it('throws on cross-currency comparison', () => {
      expect(() =>
        new Money(100n, 'USD').isLessThan(new Money(100n, 'EUR')),
      ).toThrow(/currency mismatch/);
    });
  });

  describe('predicates', () => {
    it('isNegative returns true for negative amounts', () => {
      expect(new Money(-1n, 'USD').isNegative()).toBe(true);
    });

    it('isNegative returns false for zero', () => {
      expect(new Money(0n, 'USD').isNegative()).toBe(false);
    });

    it('isNegative returns false for positive amounts', () => {
      expect(new Money(1n, 'USD').isNegative()).toBe(false);
    });

    it('isLessThan compares same-currency amounts', () => {
      expect(new Money(50n, 'USD').isLessThan(new Money(51n, 'USD'))).toBe(
        true,
      );
      expect(new Money(50n, 'USD').isLessThan(new Money(50n, 'USD'))).toBe(
        false,
      );
      expect(new Money(50n, 'USD').isLessThan(new Money(49n, 'USD'))).toBe(
        false,
      );
    });
  });

  describe('toNumber', () => {
    it('converts the bigint amount to number', () => {
      expect(new Money(74_322_001n, 'USD').toNumber()).toBe(74322001);
    });
  });
});
