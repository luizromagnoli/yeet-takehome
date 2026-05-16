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
    userId: asUserId(request.user_id),
    currency: request.currency,
    game: request.game ?? '',
    gameId: asGameId(request.game_id ?? ''),
    finished: request.finished === true,
  };
}
