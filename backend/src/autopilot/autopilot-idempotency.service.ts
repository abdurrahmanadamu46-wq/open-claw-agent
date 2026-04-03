import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { redisWriteOrBlock } from '../common/redis-resilience';

const IDEMPOTENCY_KEY_PREFIX = 'autopilot:idempotency:';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface IdempotencyScope {
  tenantId: string;
  campaignId: string;
  taskId: string;
  nodeId: string;
  stage: string;
}

@Injectable()
export class AutopilotIdempotencyService {
  private readonly logger = new Logger(AutopilotIdempotencyService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  buildExecutionKey(scope: IdempotencyScope): string {
    return `${IDEMPOTENCY_KEY_PREFIX}${scope.tenantId}:${scope.campaignId}:${scope.taskId}:${scope.nodeId}:${scope.stage}`;
  }

  async claim(scope: IdempotencyScope, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<boolean> {
    const key = this.buildExecutionKey(scope);
    const result = await redisWriteOrBlock(
      this.logger,
      `idempotency claim key=${key}`,
      async () => this.redis.set(key, new Date().toISOString(), 'EX', ttlSeconds, 'NX'),
    );
    return result === 'OK';
  }
}
