import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ProcessController } from './process.controller';
import type { ProcessService } from './process.service';

describe('ProcessController.process', () => {
  let controller: ProcessController;
  let service: { process: Mock };

  beforeEach(() => {
    service = { process: vi.fn() };
    controller = new ProcessController(service as unknown as ProcessService);
  });

  it('delegates to ProcessService.process with the request body', async () => {
    service.process.mockResolvedValueOnce({ balance: 100 });
    const body = { userId: 'u-1', currency: 'USD' };

    const result = await controller.process(body);

    expect(service.process).toHaveBeenCalledTimes(1);
    expect(service.process).toHaveBeenCalledWith(body);
    expect(result).toEqual({ balance: 100 });
  });

  it('propagates errors from the service unchanged', async () => {
    const err = new Error('boom');
    service.process.mockRejectedValueOnce(err);
    await expect(
      controller.process({ userId: 'u-1', currency: 'USD' }),
    ).rejects.toBe(err);
  });
});
