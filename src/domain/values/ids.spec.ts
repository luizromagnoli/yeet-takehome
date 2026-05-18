import { describe, expect, it } from 'vitest';
import { asActionId, asGameId, asTxId, asUserId } from './ids';

describe('branded id constructors', () => {
  it('asUserId passes the string through', () => {
    expect(asUserId('8|USDT|USD')).toBe('8|USDT|USD');
  });

  it('asActionId passes the string through', () => {
    expect(asActionId('3b42f070-dab5-4d6c-8bc6-7241b68f00bd')).toBe(
      '3b42f070-dab5-4d6c-8bc6-7241b68f00bd',
    );
  });

  it('asTxId passes the string through', () => {
    expect(asTxId('b9d4f6c3-33a2-4aa2-844d-7a9ea7a19e61')).toBe(
      'b9d4f6c3-33a2-4aa2-844d-7a9ea7a19e61',
    );
  });

  it('asGameId passes the string through', () => {
    expect(asGameId('round-abc-123')).toBe('round-abc-123');
  });
});
