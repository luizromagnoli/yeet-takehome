import { describe, expect, it } from 'vitest';
import { monthBoundary, partitionName } from './partition-utils';

describe('monthBoundary', () => {
  it('returns the first of the same month at offset 0', () => {
    const b = monthBoundary(new Date('2026-05-17T14:00:00Z'), 0);
    expect(b).toEqual({ yyyy: '2026', mm: '05', iso: '2026-05-01' });
  });

  it('advances by N months', () => {
    const b = monthBoundary(new Date('2026-05-17T00:00:00Z'), 3);
    expect(b).toEqual({ yyyy: '2026', mm: '08', iso: '2026-08-01' });
  });

  it('rolls into the next year when offset crosses December', () => {
    const b = monthBoundary(new Date('2026-11-17T00:00:00Z'), 2);
    expect(b).toEqual({ yyyy: '2027', mm: '01', iso: '2027-01-01' });
  });

  it('rolls back into the previous year when offset is negative', () => {
    const b = monthBoundary(new Date('2026-01-17T00:00:00Z'), -1);
    expect(b).toEqual({ yyyy: '2025', mm: '12', iso: '2025-12-01' });
  });

  it('zero-pads single-digit months', () => {
    const b = monthBoundary(new Date('2026-01-17T00:00:00Z'), 0);
    expect(b.mm).toBe('01');
    expect(b.iso).toBe('2026-01-01');
  });
});

describe('partitionName', () => {
  it('formats as actions_YYYY_MM', () => {
    expect(
      partitionName({ yyyy: '2026', mm: '05', iso: '2026-05-01' }),
    ).toBe('actions_2026_05');
  });
});
