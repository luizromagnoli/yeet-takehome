import type { ProcessRequestDto } from '../process/dto/process.dto';

export interface RequestContext {
  user_id: string;
  currency: string;
  game: string;
  game_id: string;
  finished: boolean;
}

export function buildContext(request: ProcessRequestDto): RequestContext {
  return {
    user_id: request.user_id,
    currency: request.currency,
    game: request.game ?? '',
    game_id: request.game_id ?? '',
    finished: request.finished === true,
  };
}
