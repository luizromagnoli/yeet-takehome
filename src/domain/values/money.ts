/**
 * Money is the unit of value in the system. It pairs a `BIGINT` amount in
 * minor units with a currency code, and guards the arithmetic operations
 * against accidental currency mixing.
 */
export class Money {
  constructor(
    public readonly amount: bigint,
    public readonly currency: string,
  ) {}

  static zero(currency: string): Money {
    return new Money(0n, currency);
  }

  static of(amount: bigint | number, currency: string): Money {
    return new Money(typeof amount === 'bigint' ? amount : BigInt(amount), currency);
  }

  add(other: Money): Money {
    this.requireSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.requireSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  negate(): Money {
    return new Money(-this.amount, this.currency);
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  isLessThan(other: Money): boolean {
    this.requireSameCurrency(other);
    return this.amount < other.amount;
  }

  toNumber(): number {
    return Number(this.amount);
  }

  private requireSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `currency mismatch: ${this.currency} vs ${other.currency}`,
      );
    }
  }
}
