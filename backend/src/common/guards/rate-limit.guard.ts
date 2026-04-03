import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, type RateLimitMeta } from '../decorators/rate-limit.decorator';

type RateAwareRequest = {
  path?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string;
  };
};

const inMemoryWindows = new Map<string, number[]>();

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redisService: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get<RateLimitMeta | undefined>(RATE_LIMIT_KEY, context.getHandler());
    if (!config || context.getType<'http' | 'ws' | 'rpc'>() !== 'http') {
      return true;
    }

    const req = context.switchToHttp().getRequest<RateAwareRequest>();
    const path = req.originalUrl ?? req.path ?? 'unknown';
    const ip = this.getClientIp(req);
    const key = `rate_limit:${path}:${ip}`;
    const limit = Math.max(1, Number(config.limit) || 1);
    const windowMs = Math.max(1000, Number(config.windowMs) || 1000);
    const count = await this.incrementAndCount(key, windowMs);

    if (count > limit) {
      const retryAfter = Math.ceil(windowMs / 1000);
      throw new HttpException(
        {
          statusCode: 429,
          message: `请求过于频繁，请在 ${retryAfter} 秒后重试`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private async incrementAndCount(key: string, windowMs: number): Promise<number> {
    try {
      const redis = this.redisService.getOrThrow();
      const now = Date.now();
      const start = now - windowMs;
      const multi = redis.multi();
      multi.zremrangebyscore(key, 0, start);
      multi.zadd(key, now, `${now}:${Math.random()}`);
      multi.zcard(key);
      multi.expire(key, Math.ceil(windowMs / 1000) + 1);
      const rows = await multi.exec();
      const count = Number(rows?.[2]?.[1] ?? 0);
      return count;
    } catch {
      const now = Date.now();
      const start = now - windowMs;
      const list = (inMemoryWindows.get(key) ?? []).filter((item) => item >= start);
      list.push(now);
      inMemoryWindows.set(key, list);
      return list.length;
    }
  }

  private getClientIp(req: RateAwareRequest): string {
    const forwarded = req.headers?.['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return first?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  }
}

export { RATE_LIMIT_KEY, RateLimit } from '../decorators/rate-limit.decorator';
