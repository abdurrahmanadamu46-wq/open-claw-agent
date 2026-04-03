import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';

const METRIC_KEY_PREFIX = 'autopilot:metrics:tenant:';
const METRIC_TTL_SECONDS = 3 * 24 * 60 * 60;

type QueueFailInput = {
  tenantId: string;
  queueName: string;
};

type MetricsQuery = {
  windowMinutes?: number;
  from?: Date;
  to?: Date;
  sourceQueue?: string;
};

@Injectable()
export class AutopilotMetricsService {
  private readonly logger = new Logger(AutopilotMetricsService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private toMinuteBucket(date = new Date()): string {
    const iso = date.toISOString();
    return iso.slice(0, 16); // YYYY-MM-DDTHH:mm
  }

  private metricKey(tenantId: string, bucket: string): string {
    return `${METRIC_KEY_PREFIX}${tenantId}:${bucket}`;
  }

  async recordQueueProcessFail(input: QueueFailInput): Promise<void> {
    const bucket = this.toMinuteBucket();
    const key = this.metricKey(input.tenantId, bucket);
    await redisWriteOrBlock(this.logger, `metrics queue.process.fail tenant=${input.tenantId}`, async () => {
      const multi = this.redis.multi();
      multi.hincrby(key, 'queue.process.fail', 1);
      multi.hincrby(key, `queue.process.fail.${input.queueName}`, 1);
      multi.expire(key, METRIC_TTL_SECONDS);
      await multi.exec();
      return true;
    });
  }

  async recordDlqEnqueue(tenantId: string, sourceQueue: string): Promise<void> {
    const bucket = this.toMinuteBucket();
    const key = this.metricKey(tenantId, bucket);
    await redisWriteOrBlock(this.logger, `metrics dlq.enqueue tenant=${tenantId}`, async () => {
      const multi = this.redis.multi();
      multi.hincrby(key, 'dlq.enqueue', 1);
      multi.hincrby(key, `dlq.enqueue.${sourceQueue}`, 1);
      multi.expire(key, METRIC_TTL_SECONDS);
      await multi.exec();
      return true;
    });
  }

  async recordReplayResult(tenantId: string, success: boolean, sourceQueue?: string): Promise<void> {
    const bucket = this.toMinuteBucket();
    const key = this.metricKey(tenantId, bucket);
    await redisWriteOrBlock(this.logger, `metrics replay.result tenant=${tenantId}`, async () => {
      const multi = this.redis.multi();
      multi.hincrby(key, 'replay.attempt', 1);
      multi.hincrby(key, success ? 'replay.success' : 'replay.failed', 1);
      if (sourceQueue) {
        multi.hincrby(key, `replay.attempt.${sourceQueue}`, 1);
        multi.hincrby(key, success ? `replay.success.${sourceQueue}` : `replay.failed.${sourceQueue}`, 1);
      }
      multi.expire(key, METRIC_TTL_SECONDS);
      await multi.exec();
      return true;
    });
  }

  async getDashboardMetrics(tenantId: string, query: MetricsQuery): Promise<{
    tenantId: string;
    windowMinutes: number;
    query: { from?: string; to?: string; sourceQueue?: string };
    totals: {
      queueProcessFail: number;
      dlqEnqueue: number;
      replayAttempt: number;
      replaySuccess: number;
      replayFailed: number;
      replaySuccessRate: number;
    };
    byQueue: {
      queueProcessFail: Record<string, number>;
      dlqEnqueue: Record<string, number>;
    };
  }> {
    const safeWindow = Math.max(1, Math.min(24 * 60, query.windowMinutes ?? 60));
    const now = Date.now();
    const fromTs = query.from?.getTime();
    const toTs = query.to?.getTime();
    const sourceQueue = query.sourceQueue?.trim() || undefined;

    const keys: string[] = [];
    if (fromTs !== undefined && toTs !== undefined) {
      const start = Math.min(fromTs, toTs);
      const end = Math.max(fromTs, toTs);
      for (let ts = end; ts >= start; ts -= 60_000) {
        keys.push(this.metricKey(tenantId, this.toMinuteBucket(new Date(ts))));
      }
    } else {
      for (let i = 0; i < safeWindow; i++) {
        const dt = new Date(now - i * 60_000);
        keys.push(this.metricKey(tenantId, this.toMinuteBucket(dt)));
      }
    }

    const totals = {
      queueProcessFail: 0,
      dlqEnqueue: 0,
      replayAttempt: 0,
      replaySuccess: 0,
      replayFailed: 0,
      replaySuccessRate: 0,
    };
    const byQueue = {
      queueProcessFail: {} as Record<string, number>,
      dlqEnqueue: {} as Record<string, number>,
    };

    for (const key of keys) {
      const hash = await redisReadWithFallback(
        this.logger,
        `metrics hgetall key=${key}`,
        async () => this.redis.hgetall(key),
        {} as Record<string, string>,
      );
      for (const [field, raw] of Object.entries(hash)) {
        const value = Number.parseInt(raw, 10);
        if (!Number.isFinite(value)) continue;
        if (!sourceQueue) {
          if (field === 'queue.process.fail') totals.queueProcessFail += value;
          else if (field === 'dlq.enqueue') totals.dlqEnqueue += value;
          else if (field === 'replay.attempt') totals.replayAttempt += value;
          else if (field === 'replay.success') totals.replaySuccess += value;
          else if (field === 'replay.failed') totals.replayFailed += value;
        } else {
          if (field === `queue.process.fail.${sourceQueue}`) totals.queueProcessFail += value;
          else if (field === `dlq.enqueue.${sourceQueue}`) totals.dlqEnqueue += value;
          else if (field === `replay.attempt.${sourceQueue}`) totals.replayAttempt += value;
          else if (field === `replay.success.${sourceQueue}`) totals.replaySuccess += value;
          else if (field === `replay.failed.${sourceQueue}`) totals.replayFailed += value;
        }
        if (field.startsWith('queue.process.fail.')) {
          const queue = field.slice('queue.process.fail.'.length);
          byQueue.queueProcessFail[queue] = (byQueue.queueProcessFail[queue] ?? 0) + value;
        } else if (field.startsWith('dlq.enqueue.')) {
          const queue = field.slice('dlq.enqueue.'.length);
          byQueue.dlqEnqueue[queue] = (byQueue.dlqEnqueue[queue] ?? 0) + value;
        }
      }
    }

    totals.replaySuccessRate =
      totals.replayAttempt > 0 ? Number((totals.replaySuccess / totals.replayAttempt).toFixed(4)) : 1;

    return {
      tenantId,
      windowMinutes: safeWindow,
      query: {
        from: query.from?.toISOString(),
        to: query.to?.toISOString(),
        sourceQueue,
      },
      totals,
      byQueue,
    };
  }
}
