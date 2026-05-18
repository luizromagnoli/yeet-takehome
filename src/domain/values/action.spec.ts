import { describe, expect, it } from 'vitest';
import type { ActionDto } from '../../process/dto/process.dto';
import { toDomainAction } from './action';

describe('toDomainAction', () => {
  it('converts a bet DTO into a BetAction with a Money amount', () => {
    const dto: ActionDto = {
      action: 'bet',
      actionId: '3b42f070-dab5-4d6c-8bc6-7241b68f00bd',
      amount: 100,
    };
    const out = toDomainAction(dto, 'USD');
    expect(out.kind).toBe('bet');
    if (out.kind !== 'bet') throw new Error('kind narrowing failed');
    expect(out.actionId).toBe(dto.actionId);
    expect(out.amount.amount).toBe(100n);
    expect(out.amount.currency).toBe('USD');
  });

  it('converts a win DTO into a WinAction', () => {
    const dto: ActionDto = {
      action: 'win',
      actionId: '86441c7a-560e-4501-b829-110af6a1b956',
      amount: 250,
    };
    const out = toDomainAction(dto, 'EUR');
    expect(out.kind).toBe('win');
    if (out.kind !== 'win') throw new Error('kind narrowing failed');
    expect(out.amount.amount).toBe(250n);
    expect(out.amount.currency).toBe('EUR');
  });

  it('converts a rollback DTO into a RollbackAction with originalActionId', () => {
    const dto: ActionDto = {
      action: 'rollback',
      actionId: 'c9a9c3a7-e9e8-4f5a-9fdf-1d8a377d1b8f',
      originalActionId: '4dbcbf1d-bcf6-43e9-9a62-7d3c0f3c6486',
    };
    const out = toDomainAction(dto, 'USD');
    expect(out.kind).toBe('rollback');
    if (out.kind !== 'rollback') throw new Error('kind narrowing failed');
    expect(out.actionId).toBe(dto.actionId);
    expect(out.originalActionId).toBe(dto.originalActionId);
  });

  it('throws when bet has no amount', () => {
    const dto = {
      action: 'bet',
      actionId: '3b42f070-dab5-4d6c-8bc6-7241b68f00bd',
    } as ActionDto;
    expect(() => toDomainAction(dto, 'USD')).toThrow(/bet action requires an amount/);
  });

  it('throws when win has no amount', () => {
    const dto = {
      action: 'win',
      actionId: '86441c7a-560e-4501-b829-110af6a1b956',
    } as ActionDto;
    expect(() => toDomainAction(dto, 'USD')).toThrow(/win action requires an amount/);
  });

  it('throws when rollback has no original_action_id', () => {
    const dto = {
      action: 'rollback',
      actionId: 'c9a9c3a7-e9e8-4f5a-9fdf-1d8a377d1b8f',
    } as ActionDto;
    expect(() => toDomainAction(dto, 'USD')).toThrow(
      /rollback action requires original_action_id/,
    );
  });
});
