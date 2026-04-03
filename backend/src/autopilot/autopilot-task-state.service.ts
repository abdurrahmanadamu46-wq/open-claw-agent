import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';

export type AutopilotTaskState = 'queued' | 'running' | 'success' | 'failed' | 'canceled';

const TASK_KEY_PREFIX = 'autopilot:task:';
const RUNNING_INDEX_KEY = 'autopilot:task:running:index';
const TASK_INDEX_PREFIX = 'autopilot:task:index:';
const TRACE_INDEX_PREFIX = 'autopilot:task:trace:';
const TASK_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface TaskStateTransitionInput {
  taskId: string;
  traceId?: string;
  stage: string;
  state: AutopilotTaskState;
  tenantId: string;
  campaignId?: string;
  sourceQueue: string;
  nodeId?: string;
  errorCode?: string;
  errorMessage?: string;
  meta?: Record<string, unknown>;
}

export interface TaskStateRecord {
  recordId: string;
  taskId: string;
  traceId?: string;
  stage: string;
  state: AutopilotTaskState;
  tenantId: string;
  campaignId?: string;
  sourceQueue: string;
  nodeId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class AutopilotTaskStateService {
  private readonly logger = new Logger(AutopilotTaskStateService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  buildRecordId(taskId: string, stage: string): string {
    return `${taskId}:${stage}`;
  }

  async transition(input: TaskStateTransitionInput): Promise<TaskStateRecord> {
    const recordId = this.buildRecordId(input.taskId, input.stage);
    const key = TASK_KEY_PREFIX + recordId;
    const now = new Date().toISOString();
    const existingCreatedAt = await redisReadWithFallback(
      this.logger,
      `task state read createdAt record=${recordId}`,
      async () => this.redis.hget(key, 'createdAt'),
      null,
    );
    const createdAt = existingCreatedAt ?? now;
    const payload: Record<string, string> = {
      recordId,
      taskId: input.taskId,
      traceId: input.traceId ?? '',
      stage: input.stage,
      state: input.state,
      tenantId: input.tenantId,
      campaignId: input.campaignId ?? '',
      sourceQueue: input.sourceQueue,
      nodeId: input.nodeId ?? '',
      errorCode: input.errorCode ?? '',
      errorMessage: input.errorMessage ?? '',
      createdAt,
      updatedAt: now,
      meta: input.meta ? JSON.stringify(input.meta) : '',
    };

    await redisWriteOrBlock(
      this.logger,
      `task state transition record=${recordId} state=${input.state}`,
      async () => {
        const multi = this.redis.multi();
        multi.hset(key, payload);
        multi.expire(key, TASK_TTL_SECONDS);
        multi.sadd(TASK_INDEX_PREFIX + input.taskId, recordId);
        multi.expire(TASK_INDEX_PREFIX + input.taskId, TASK_TTL_SECONDS);
        if (input.traceId) {
          multi.sadd(TRACE_INDEX_PREFIX + input.traceId, recordId);
          multi.expire(TRACE_INDEX_PREFIX + input.traceId, TASK_TTL_SECONDS);
        }
        if (input.state === 'running') {
          multi.zadd(RUNNING_INDEX_KEY, Date.now(), recordId);
        } else {
          multi.zrem(RUNNING_INDEX_KEY, recordId);
        }
        await multi.exec();
      },
    );

    return {
      recordId,
      taskId: input.taskId,
      traceId: input.traceId,
      stage: input.stage,
      state: input.state,
      tenantId: input.tenantId,
      campaignId: input.campaignId,
      sourceQueue: input.sourceQueue,
      nodeId: input.nodeId,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      createdAt,
      updatedAt: now,
      meta: input.meta,
    };
  }

  async markQueued(input: Omit<TaskStateTransitionInput, 'state'>): Promise<TaskStateRecord> {
    return this.transition({ ...input, state: 'queued' });
  }

  async markRunning(input: Omit<TaskStateTransitionInput, 'state'>): Promise<TaskStateRecord> {
    return this.transition({ ...input, state: 'running' });
  }

  async markSuccess(input: Omit<TaskStateTransitionInput, 'state' | 'errorCode' | 'errorMessage'>): Promise<TaskStateRecord> {
    return this.transition({ ...input, state: 'success', errorCode: undefined, errorMessage: undefined });
  }

  async markFailed(input: Omit<TaskStateTransitionInput, 'state'>): Promise<TaskStateRecord> {
    return this.transition({ ...input, state: 'failed' });
  }

  async markCanceled(input: Omit<TaskStateTransitionInput, 'state'>): Promise<TaskStateRecord> {
    return this.transition({ ...input, state: 'canceled' });
  }

  async recoverStaleRunning(maxRunningAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxRunningAgeMs;
    const staleRecordIds = await redisReadWithFallback(
      this.logger,
      `recover stale running cutoff=${cutoff}`,
      async () => this.redis.zrangebyscore(RUNNING_INDEX_KEY, 0, cutoff),
      [] as string[],
    );
    let recovered = 0;
    for (const recordId of staleRecordIds) {
      const key = TASK_KEY_PREFIX + recordId;
      const row = await redisReadWithFallback(
        this.logger,
        `read stale task record=${recordId}`,
        async () => this.redis.hgetall(key),
        {} as Record<string, string>,
      );
      if (!row.taskId || !row.stage || !row.tenantId || !row.sourceQueue) {
        await redisWriteOrBlock(
          this.logger,
          `cleanup invalid stale record=${recordId}`,
          async () => this.redis.zrem(RUNNING_INDEX_KEY, recordId),
        );
        continue;
      }
      await this.markFailed({
        taskId: row.taskId,
        stage: row.stage,
        tenantId: row.tenantId,
        campaignId: row.campaignId || undefined,
        sourceQueue: row.sourceQueue,
        nodeId: row.nodeId || undefined,
        errorCode: 'RUNNING_STALE_TIMEOUT',
        errorMessage: 'Task stayed in running state past recovery threshold',
        meta: { recoveredByScanner: true },
      });
      recovered += 1;
    }
    return recovered;
  }

  async listByTaskId(taskId: string): Promise<TaskStateRecord[]> {
    const recordIds = await redisReadWithFallback(
      this.logger,
      `listByTaskId taskId=${taskId}`,
      async () => this.redis.smembers(TASK_INDEX_PREFIX + taskId),
      [] as string[],
    );
    const rows: TaskStateRecord[] = [];
    for (const recordId of recordIds) {
      const hash = await redisReadWithFallback(
        this.logger,
        `listByTaskId read record=${recordId}`,
        async () => this.redis.hgetall(TASK_KEY_PREFIX + recordId),
        {} as Record<string, string>,
      );
      if (!hash.taskId || !hash.stage || !hash.state || !hash.tenantId || !hash.sourceQueue) {
        continue;
      }
      rows.push({
        recordId,
        taskId: hash.taskId,
        traceId: hash.traceId || undefined,
        stage: hash.stage,
        state: hash.state as AutopilotTaskState,
        tenantId: hash.tenantId,
        campaignId: hash.campaignId || undefined,
        sourceQueue: hash.sourceQueue,
        nodeId: hash.nodeId || undefined,
        errorCode: hash.errorCode || undefined,
        errorMessage: hash.errorMessage || undefined,
        createdAt: hash.createdAt,
        updatedAt: hash.updatedAt,
        meta: this.safeParseMeta(hash.meta),
      });
    }
    return rows.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }

  async listByTraceId(traceId: string, tenantScope?: string): Promise<TaskStateRecord[]> {
    const normalizedTraceId = traceId.trim();
    if (!normalizedTraceId) return [];
    const recordIds = await redisReadWithFallback(
      this.logger,
      `listByTraceId traceId=${normalizedTraceId}`,
      async () => this.redis.smembers(TRACE_INDEX_PREFIX + normalizedTraceId),
      [] as string[],
    );
    const rows: TaskStateRecord[] = [];
    for (const recordId of recordIds) {
      const hash = await redisReadWithFallback(
        this.logger,
        `listByTraceId read record=${recordId}`,
        async () => this.redis.hgetall(TASK_KEY_PREFIX + recordId),
        {} as Record<string, string>,
      );
      if (!hash.taskId || !hash.stage || !hash.state || !hash.tenantId || !hash.sourceQueue) {
        continue;
      }
      if (tenantScope && hash.tenantId !== tenantScope) {
        continue;
      }
      const rowTraceId = hash.traceId || this.safeParseMeta(hash.meta)?.traceId;
      if (typeof rowTraceId === 'string' && rowTraceId !== normalizedTraceId) {
        continue;
      }
      rows.push({
        recordId,
        taskId: hash.taskId,
        traceId: typeof rowTraceId === 'string' ? rowTraceId : undefined,
        stage: hash.stage,
        state: hash.state as AutopilotTaskState,
        tenantId: hash.tenantId,
        campaignId: hash.campaignId || undefined,
        sourceQueue: hash.sourceQueue,
        nodeId: hash.nodeId || undefined,
        errorCode: hash.errorCode || undefined,
        errorMessage: hash.errorMessage || undefined,
        createdAt: hash.createdAt,
        updatedAt: hash.updatedAt,
        meta: this.safeParseMeta(hash.meta),
      });
    }
    return rows.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }

  private safeParseMeta(raw?: string): Record<string, unknown> | undefined {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { raw };
    }
  }
}
