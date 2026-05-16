import type { ProcessRequestDto } from '../process/dto/process.dto';
import { asGameId, asUserId, type GameId, type UserId } from './values/ids';

export interface RequestContext {
  userId: UserId;
  currency: string;
  game: string;
  gameId: GameId;
  finished: boolean;
}

export function buildContext(request: ProcessRequestDto): RequestContext {
  return {
    userId: asUserId(request.userId),
    currency: request.currency,
    game: request.game ?? '',
    gameId: asGameId(request.gameId ?? ''),
    finished: request.finished === true,
  };
}
