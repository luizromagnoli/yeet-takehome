import type { ActionDto } from '../../process/dto/process.dto';
import { type ActionId, asActionId } from './ids';
import { Money } from './money';

/**
 * Domain-side representation of an action. Discriminated on `kind` so the
 * compiler enforces that a bet/win carries an amount and a rollback carries
 * an `originalActionId` — eliminating the optional-field gymnastics the DTO
 * has to live with for JSON's sake.
 */
export type DomainAction = BetAction | WinAction | RollbackAction;

export interface BetAction {
  kind: 'bet';
  actionId: ActionId;
  amount: Money;
}

export interface WinAction {
  kind: 'win';
  actionId: ActionId;
  amount: Money;
}

export interface RollbackAction {
  kind: 'rollback';
  actionId: ActionId;
  originalActionId: ActionId;
}

export function toDomainAction(dto: ActionDto, currency: string): DomainAction {
  const actionId = asActionId(dto.actionId);
  if (dto.action === 'bet' || dto.action === 'win') {
    if (dto.amount === undefined) {
      throw new Error(`${dto.action} action requires an amount`);
    }
    return {
      kind: dto.action,
      actionId,
      amount: Money.of(dto.amount, currency),
    };
  }
  if (!dto.originalActionId) {
    throw new Error('rollback action requires original_action_id');
  }
  return {
    kind: 'rollback',
    actionId,
    originalActionId: asActionId(dto.originalActionId),
  };
}
