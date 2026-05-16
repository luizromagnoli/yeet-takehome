import { Injectable } from '@nestjs/common';
import type { ActionKind } from '../../process/dto/process.dto';
import { BetHandler } from './bet.handler';
import { RollbackHandler } from './rollback.handler';
import { WinHandler } from './win.handler';
import type { ActionHandler } from './action-handler';

@Injectable()
export class HandlerRegistry {
  private readonly handlers: Record<ActionKind, ActionHandler>;

  constructor(
    bet: BetHandler,
    win: WinHandler,
    rollback: RollbackHandler,
  ) {
    this.handlers = { bet, win, rollback };
  }

  for(kind: ActionKind): ActionHandler {
    return this.handlers[kind];
  }
}
