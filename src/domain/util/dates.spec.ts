import { describe, expect, it } from 'vitest';
import { isoDate, nextDayUTC, startOfDayUTC } from './dates';

describe('date utils', () => {
  describe('isoDate', () => {
    it('returns the YYYY-MM-DD slice of an ISO date string', () => {
      expect(isoDate(new Date('2026-05-17T14:23:45.678Z'))).toBe('2026-05-17');
    });

    it('uses UTC, not the local timezone', () => {
      // 23:00 UTC on the 17th is the next day in many local timezones, but
      // the slice we keep is the UTC day.
      expect(isoDate(new Date('2026-05-17T23:00:00.000Z'))).toBe('2026-05-17');
    });
  });

  describe('startOfDayUTC', () => {
    it('rolls a mid-day timestamp back to 00:00:00.000 UTC of the same day', () => {
      const d = startOfDayUTC(new Date('2026-05-17T14:23:45.678Z'));
      expect(d.toISOString()).toBe('2026-05-17T00:00:00.000Z');
    });

    it('is idempotent on an already-start-of-day timestamp', () => {
      const start = new Date('2026-05-17T00:00:00.000Z');
      expect(startOfDayUTC(start).toISOString()).toBe(start.toISOString());
    });
  });

  describe('nextDayUTC', () => {
    it('adds 24 hours', () => {
      const d = nextDayUTC(new Date('2026-05-17T00:00:00.000Z'));
      expect(d.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    });

    it('respects DST-free 86_400_000 ms arithmetic (always 24h)', () => {
      const d = nextDayUTC(new Date('2026-03-29T00:00:00.000Z')); // EU DST spring-forward
      expect(d.toISOString()).toBe('2026-03-30T00:00:00.000Z');
    });
  });
});
