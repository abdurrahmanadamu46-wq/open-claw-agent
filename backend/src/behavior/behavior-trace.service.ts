import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';
import type { ActionBias } from './types';

const BEHAVIOR_TRACE_KEY_PREFIX = 'behavior:trace:';
const BEHAVIOR_TRACE_TTL_SECONDS = 3 * 24 * 60 * 60;
const BEHAVIOR_TRACE_MAX_ITEMS = 500;

export interface BehaviorTraceSnapshot {
  traceId: string;
  sessionId: string;
  tenantId?: string;
  campaignId?: string;
  nodeId?: string;
  taskId?: string;
  templateId?: string;
  eventType: 'behavior.path.generated' | 'behavior.session.created';
  memoryHits: number;
  blendedBias: Required<ActionBias>;
  issueCode?: 'memory.empty';
  createdAt: string;
}

@Injectable()
export class BehaviorTraceService {
  private readonly logger = new Logger(BehaviorTraceService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private traceKey(traceId: string): string {
    return `${BEHAVIOR_TRACE_KEY_PREFIX}${traceId}:snapshots`;
  }

  private parseSnapshot(raw: string): BehaviorTraceSnapshot | null {
    try {
      const parsed = JSON.parse(raw) as Partial<BehaviorTraceSnapshot>;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.traceId || !parsed.sessionId || !parsed.eventType || !parsed.createdAt) return null;
      return {
        traceId: parsed.traceId,
        sessionId: parsed.sessionId,
        tenantId: parsed.tenantId,
        campaignId: parsed.campaignId,
        nodeId: parsed.nodeId,
        taskId: parsed.taskId,
        templateId: parsed.templateId,
        eventType: parsed.eventType,
        memoryHits: Number(parsed.memoryHits ?? 0),
        blendedBias: {
          like: Number(parsed.blendedBias?.like ?? 0),
          comment: Number(parsed.blendedBias?.comment ?? 0),
          follow: Number(parsed.blendedBias?.follow ?? 0),
          share: Number(parsed.blendedBias?.share ?? 0),
        },
        issueCode: parsed.issueCode === 'memory.empty' ? parsed.issueCode : undefined,
        createdAt: parsed.createdAt,
      };
    } catch {
      return null;
    }
  }

  async appendSnapshot(
    traceId: string,
    snapshot: Omit<BehaviorTraceSnapshot, 'traceId' | 'createdAt'> & { createdAt?: string },
  ): Promise<BehaviorTraceSnapshot> {
    const normalizedTraceId = traceId.trim();
    const record: BehaviorTraceSnapshot = {
      traceId: normalizedTraceId,
      ...snapshot,
      createdAt: snapshot.createdAt ?? new Date().toISOString(),
    };
    const key = this.traceKey(normalizedTraceId);

    await redisWriteOrBlock(this.logger, `behavior trace append traceId=${normalizedTraceId}`, async () => {
      const multi = this.redis.multi();
      multi.lpush(key, JSON.stringify(record));
      multi.ltrim(key, 0, BEHAVIOR_TRACE_MAX_ITEMS - 1);
      multi.expire(key, BEHAVIOR_TRACE_TTL_SECONDS);
      await multi.exec();
      return true;
    });

    return record;
  }

  async listByTraceId(traceId: string, tenantScope: string, limit = 200): Promise<BehaviorTraceSnapshot[]> {
    const normalizedTraceId = traceId.trim();
    const normalizedTenant = tenantScope.trim();
    const safeLimit = Math.max(1, Math.min(limit, BEHAVIOR_TRACE_MAX_ITEMS));
    const items = await redisReadWithFallback(
      this.logger,
      `behavior trace list traceId=${normalizedTraceId}`,
      async () => this.redis.lrange(this.traceKey(normalizedTraceId), 0, safeLimit - 1),
      [] as string[],
    );

    const output: BehaviorTraceSnapshot[] = [];
    for (const raw of items) {
      const parsed = this.parseSnapshot(raw);
      if (!parsed) continue;
      if (!parsed.tenantId || parsed.tenantId !== normalizedTenant) continue;
      output.push(parsed);
    }
    return output;
  }
}
