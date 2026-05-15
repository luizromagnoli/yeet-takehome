import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'node:crypto';

const HMAC_PREFIX = 'HMAC-SHA256 ';
const HMAC_DIGEST_HEX_LENGTH = 64;
const HMAC_DIGEST_BYTES = 32;

export const SKIP_HMAC_KEY = 'skipHmac';
export const SkipHmac = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_HMAC_KEY, true);

interface RequestWithRawBody {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
}

@Injectable()
export class HmacGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_HMAC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    const header = request.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith(HMAC_PREFIX)) {
      throw new ForbiddenException();
    }

    const providedHex = header.slice(HMAC_PREFIX.length).trim();
    if (providedHex.length !== HMAC_DIGEST_HEX_LENGTH) {
      throw new ForbiddenException();
    }

    const rawBody = request.rawBody;
    if (!Buffer.isBuffer(rawBody)) {
      throw new ForbiddenException();
    }

    const secret = this.config.getOrThrow<string>('BET_PROCESSOR_HMAC_SECRET');
    const expected = createHmac('sha256', secret).update(rawBody).digest();

    const provided = Buffer.from(providedHex, 'hex');
    if (provided.length !== HMAC_DIGEST_BYTES) {
      throw new ForbiddenException();
    }

    if (!timingSafeEqual(provided, expected)) {
      throw new ForbiddenException();
    }

    return true;
  }
}
