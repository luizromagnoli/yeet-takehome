import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ReportController } from './report.controller';
import type { ReportService } from './report.service';

describe('ReportController', () => {
  let controller: ReportController;
  let service: { userReport: Mock; casinoReport: Mock };

  beforeEach(() => {
    service = { userReport: vi.fn(), casinoReport: vi.fn() };
    controller = new ReportController(service as unknown as ReportService);
  });

  describe('users', () => {
    it('forwards from / to / cursor / limit to userReport', async () => {
      const page = { users: [], next_cursor: null };
      service.userReport.mockResolvedValueOnce(page);

      const result = await controller.users({
        from: '2026-05-17T00:00:00Z',
        to: '2026-05-18T00:00:00Z',
        cursor: 'c1',
        limit: 50,
      });

      expect(service.userReport).toHaveBeenCalledWith(
        '2026-05-17T00:00:00Z',
        '2026-05-18T00:00:00Z',
        'c1',
        50,
      );
      expect(result).toBe(page);
      expect(service.casinoReport).not.toHaveBeenCalled();
    });

    it('passes undefined cursor and limit through when omitted', async () => {
      service.userReport.mockResolvedValueOnce({ users: [], next_cursor: null });
      await controller.users({
        from: '2026-05-17T00:00:00Z',
        to: '2026-05-18T00:00:00Z',
      });
      expect(service.userReport).toHaveBeenCalledWith(
        '2026-05-17T00:00:00Z',
        '2026-05-18T00:00:00Z',
        undefined,
        undefined,
      );
    });
  });

  describe('casino', () => {
    it('forwards from / to to casinoReport', async () => {
      const report = { currencies: [] };
      service.casinoReport.mockResolvedValueOnce(report);

      const result = await controller.casino({
        from: '2026-05-17T00:00:00Z',
        to: '2026-05-18T00:00:00Z',
      });

      expect(service.casinoReport).toHaveBeenCalledWith(
        '2026-05-17T00:00:00Z',
        '2026-05-18T00:00:00Z',
      );
      expect(result).toBe(report);
      expect(service.userReport).not.toHaveBeenCalled();
    });
  });
});
