import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import type {
  BaseJobPayload,
  AutopilotDeadLetterPayload,
  DlqReplayOperator,
  DlqReplayResult,
  DlqReplayAuditLog,
} from './autopilot.types';
import {
  AUTOPILOT_QUEUES,
  CONTENT_FORGE_QUEUE,
  CONTENT_FORGE_DLQ,
  LEAD_HARVEST_QUEUE,
  LEAD_HARVEST_DLQ,
  MATRIX_DISPATCH_QUEUE,
  MATRIX_DISPATCH_DLQ,
  RADAR_SNIFFING_QUEUE,
  RADAR_SNIFFING_DLQ,
} from './autopilot.constants';
import { resolveTaskId } from './autopilot-task-id';
import { AutopilotTaskStateService } from './autopilot-task-state.service';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';
import { ensureTraceId } from './autopilot-trace.util';
import { emitStructuredLog } from '../common/structured-log';
import { AutopilotMetricsService } from './autopilot-metrics.service';

const REPLAY_LOCK_PREFIX = 'autopilot:dlq:replay:lock:';
const REPLAY_DONE_PREFIX = 'autopilot:dlq:replay:done:';
const REPLAY_AUDIT_LIST_PREFIX = 'autopilot:dlq:replay:audit:';
const REPLAY_LOCK_TTL_SECONDS = 60;
const REPLAY_DONE_TTL_SECONDS = 7 * 24 * 60 * 60;
const REPLAY_AUDIT_MAX_ITEMS = 2000;

@Injectable()
export class AutopilotDlqService {
  private readonly logger = new Logger(AutopilotDlqService.name);

  constructor(
    @InjectQueue(RADAR_SNIFFING_QUEUE) private readonly radarQueue: Queue,
    @InjectQueue(CONTENT_FORGE_QUEUE) private readonly contentQueue: Queue,
    @InjectQueue(MATRIX_DISPATCH_QUEUE) private readonly dispatchQueue: Queue,
    @InjectQueue(LEAD_HARVEST_QUEUE) private readonly harvestQueue: Queue,
    @InjectQueue(RADAR_SNIFFING_DLQ) private readonly radarDlqQueue: Queue,
    @InjectQueue(CONTENT_FORGE_DLQ) private readonly contentDlqQueue: Queue,
    @InjectQueue(MATRIX_DISPATCH_DLQ) private readonly dispatchDlqQueue: Queue,
    @InjectQueue(LEAD_HARVEST_DLQ) private readonly harvestDlqQueue: Queue,
    private readonly redisService: RedisService,
    private readonly taskStateService: AutopilotTaskStateService,
    private readonly metricsService: AutopilotMetricsService,
  ) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  async enqueue<TPayload extends BaseJobPayload>(
    sourceQueue: string,
    payload: AutopilotDeadLetterPayload<TPayload>,
  ): Promise<void> {
    const queue = this.getQueueForSource(sourceQueue);
    await queue.add(`dlq:${payload.sourceJobId}`, payload, {
      attempts: 1,
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 5000 },
    });
    await this.metricsService.recordDlqEnqueue(payload.tenantId, sourceQueue);
    emitStructuredLog(this.logger, 'warn', {
      service: AutopilotDlqService.name,
      eventType: 'queue.enqueue',
      message: 'dead letter job enqueued',
      traceId: payload.traceId,
      tenantId: payload.tenantId,
      campaignId: payload.campaignId,
      nodeId: payload.nodeId,
      taskId: payload.taskId,
      queueName: `${sourceQueue}:dlq`,
      sourceQueue,
      sourceJobId: payload.sourceJobId,
      stage: payload.stage,
      errorCode: payload.errorCode,
      retryable: payload.retryable,
      attemptsMade: payload.attemptsMade,
      maxAttempts: payload.maxAttempts,
    });
  }

  async replayFromDlq(
    sourceQueue: string,
    dlqJobId: string,
    operator: DlqReplayOperator,
    tenantScope: string,
  ): Promise<{ replayJobId: string; replayCount: number; result: DlqReplayResult }> {
    if (!AUTOPILOT_QUEUES.includes(sourceQueue as (typeof AUTOPILOT_QUEUES)[number])) {
      throw new Error(`Unsupported source queue for replay: ${sourceQueue}`);
    }

    const requestedAt = new Date().toISOString();
    const replayLockKey = this.buildReplayLockKey(sourceQueue, dlqJobId);
    const replayDoneKey = this.buildReplayDoneKey(sourceQueue, dlqJobId);
    const lockToken = `${operator.operatorId}:${Date.now()}`;
    const lockSetResult = await redisWriteOrBlock(
      this.logger,
      `acquire dlq replay lock sourceQueue=${sourceQueue} dlqJobId=${dlqJobId}`,
      async () => this.redis.set(replayLockKey, lockToken, 'EX', REPLAY_LOCK_TTL_SECONDS, 'NX'),
    );
    if (lockSetResult !== 'OK') {
      await this.metricsService.recordReplayResult(tenantScope, false, sourceQueue);
      await this.appendReplayAudit({
        auditId: this.buildAuditId(sourceQueue, dlqJobId),
        sourceQueue,
        dlqJobId,
        requestedAt,
        completedAt: new Date().toISOString(),
        operatorId: operator.operatorId,
        operatorName: operator.operatorName,
        operatorSource: operator.operatorSource,
        result: 'lock_not_acquired',
        errorMessage: 'Replay is already running for this DLQ job',
        tenantId: tenantScope,
      });
      throw new Error(`Replay lock not acquired for ${sourceQueue}:${dlqJobId}`);
    }

    let sourceJobIdForAudit: string | undefined;
    let taskIdForAudit: string | undefined;
    let stageForAudit: string | undefined;
    let traceIdForAudit: string | undefined;
    const dlqQueue = this.getDlqQueueForSource(sourceQueue);
    const source = this.getSourceQueue(sourceQueue);
    try {
      const replayDoneRaw = await this.redis.get(replayDoneKey);
      if (replayDoneRaw) {
        const replayDone = this.safeParseReplayDone(replayDoneRaw);
        if (replayDone?.replayJobId && replayDone.tenantId) {
          await this.appendReplayAudit({
            auditId: this.buildAuditId(sourceQueue, dlqJobId),
            sourceQueue,
            dlqJobId,
            sourceJobId: replayDone.sourceJobId,
            taskId: replayDone.taskId,
            stage: replayDone.stage,
            traceId: replayDone.traceId,
            replayJobId: replayDone.replayJobId,
            replayCount: replayDone.replayCount,
            requestedAt,
            completedAt: new Date().toISOString(),
            operatorId: operator.operatorId,
            operatorName: operator.operatorName,
            operatorSource: operator.operatorSource,
            result: 'already_replayed',
            tenantId: replayDone.tenantId,
          });
          if (replayDone.tenantId && replayDone.tenantId !== tenantScope) {
            throw new ForbiddenException(`Tenant scope mismatch for DLQ replay ${sourceQueue}:${dlqJobId}`);
          }
          await this.metricsService.recordReplayResult(tenantScope, true, sourceQueue);
          return {
            replayJobId: replayDone.replayJobId,
            replayCount: replayDone.replayCount ?? 1,
            result: 'already_replayed',
          };
        }
      }

      const dlqJob = await dlqQueue.getJob(dlqJobId);
      if (!dlqJob) {
        throw new Error(`DLQ job not found: ${dlqJobId}`);
      }

      const payload = dlqJob.data as AutopilotDeadLetterPayload<BaseJobPayload>;
      const traceId = ensureTraceId(payload.traceId ?? payload.originalPayload.traceId);
      if (payload.tenantId !== tenantScope) {
        throw new ForbiddenException(`Tenant scope mismatch for DLQ replay ${sourceQueue}:${dlqJobId}`);
      }
      sourceJobIdForAudit = payload.sourceJobId;
      taskIdForAudit = payload.taskId;
      stageForAudit = payload.stage;
      traceIdForAudit = traceId;
      if (payload.replayedAt && payload.replayJobId) {
        await this.appendReplayAudit({
          auditId: this.buildAuditId(sourceQueue, dlqJobId),
          sourceQueue,
          dlqJobId,
          sourceJobId: payload.sourceJobId,
          taskId: payload.taskId,
          stage: payload.stage,
          traceId,
          replayJobId: payload.replayJobId,
          replayCount: payload.originalPayload.replay?.replayCount ?? 1,
          requestedAt,
          completedAt: new Date().toISOString(),
          operatorId: operator.operatorId,
          operatorName: operator.operatorName,
          operatorSource: operator.operatorSource,
          result: 'already_replayed',
          tenantId: payload.tenantId,
        });
        await this.setReplayDoneMarker(replayDoneKey, {
          replayJobId: payload.replayJobId,
          replayCount: payload.originalPayload.replay?.replayCount ?? 1,
          sourceJobId: payload.sourceJobId,
          taskId: payload.taskId,
          stage: payload.stage,
          traceId,
          tenantId: payload.tenantId,
        });
        await this.metricsService.recordReplayResult(payload.tenantId, true, sourceQueue);
        return {
          replayJobId: payload.replayJobId,
          replayCount: payload.originalPayload.replay?.replayCount ?? 1,
          result: 'already_replayed',
        };
      }
      if (payload.replayedAt && !payload.replayJobId) {
        throw new Error(`DLQ job already replayed at ${payload.replayedAt}, but replayJobId is missing`);
      }

      const replayCount = (payload.originalPayload.replay?.replayCount ?? 0) + 1;
      const replayPayload: BaseJobPayload = {
        ...payload.originalPayload,
        traceId,
        replay: {
          replayOfJobId: payload.sourceJobId,
          replayCount,
          replayNonce: `replay-${Date.now()}`,
        },
      };

      const replayJob = await source.add('replay', replayPayload, {
        attempts: payload.maxAttempts,
        backoff: { type: 'exponential', delay: 1000 },
      });
      emitStructuredLog(this.logger, 'log', {
        service: AutopilotDlqService.name,
        eventType: 'queue.enqueue',
        message: 'replay job re-enqueued to source queue',
        traceId,
        tenantId: payload.tenantId,
        campaignId: payload.campaignId,
        nodeId: payload.nodeId,
        taskId: resolveTaskId(replayPayload),
        queueName: sourceQueue,
        queueJobId: String(replayJob.id ?? ''),
        replayOfJobId: payload.sourceJobId,
        replayCount,
      });
      await this.taskStateService.markQueued({
        taskId: resolveTaskId(replayPayload),
        traceId,
        stage: payload.stage,
        tenantId: payload.tenantId,
        campaignId: payload.campaignId,
        sourceQueue,
        nodeId: payload.nodeId,
        meta: { replay: true, replayOfJobId: payload.sourceJobId },
      });

      const replayJobId = String(replayJob.id ?? '');
      const replayedAt = new Date().toISOString();
      await dlqJob.updateData({
        ...payload,
        traceId,
        replayedAt,
        replayJobId,
      });

      await this.setReplayDoneMarker(replayDoneKey, {
        replayJobId,
        replayCount,
        sourceJobId: payload.sourceJobId,
        taskId: payload.taskId,
        stage: payload.stage,
        traceId,
        tenantId: payload.tenantId,
      });

      await this.appendReplayAudit({
        auditId: this.buildAuditId(sourceQueue, dlqJobId),
        sourceQueue,
        dlqJobId,
        sourceJobId: payload.sourceJobId,
        taskId: payload.taskId,
        stage: payload.stage,
        traceId,
        replayJobId,
        replayCount,
        requestedAt,
        completedAt: replayedAt,
        operatorId: operator.operatorId,
        operatorName: operator.operatorName,
        operatorSource: operator.operatorSource,
        result: 'success',
        tenantId: payload.tenantId,
      });
      await this.metricsService.recordReplayResult(payload.tenantId, true, sourceQueue);

      return { replayJobId, replayCount, result: 'success' };
    } catch (error) {
      await this.metricsService.recordReplayResult(tenantScope, false, sourceQueue);
      await this.appendReplayAuditBestEffort({
        auditId: this.buildAuditId(sourceQueue, dlqJobId),
        sourceQueue,
        dlqJobId,
        sourceJobId: sourceJobIdForAudit,
        taskId: taskIdForAudit,
        stage: stageForAudit,
        traceId: traceIdForAudit,
        requestedAt,
        completedAt: new Date().toISOString(),
        operatorId: operator.operatorId,
        operatorName: operator.operatorName,
        operatorSource: operator.operatorSource,
        result: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        tenantId: tenantScope,
      });
      throw error;
    } finally {
      await this.releaseReplayLockBestEffort(replayLockKey, lockToken);
    }
  }

  async listDlq(
    sourceQueue: string,
    tenantScope: string,
    limit = 20,
  ): Promise<
    Array<{
      dlqJobId: string;
      sourceJobId: string;
      tenantId: string;
      traceId: string;
      campaignId?: string;
      taskId: string;
      stage: string;
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
      attemptsMade: number;
      maxAttempts: number;
      failedAt: string;
      replayedAt?: string;
      replayJobId?: string;
    }>
  > {
    if (!AUTOPILOT_QUEUES.includes(sourceQueue as (typeof AUTOPILOT_QUEUES)[number])) {
      throw new Error(`Unsupported source queue for DLQ list: ${sourceQueue}`);
    }
    const safeLimit = Math.max(1, Math.min(100, limit));
    const dlqQueue = this.getDlqQueueForSource(sourceQueue);
    const fetchWindow = Math.min(500, safeLimit * 5);
    const jobs = await dlqQueue.getJobs(
      ['waiting', 'active', 'delayed', 'failed', 'completed'],
      0,
      fetchWindow - 1,
      true,
    );
    return jobs
      .map((job) => {
      const payload = job.data as AutopilotDeadLetterPayload<BaseJobPayload>;
      return {
        dlqJobId: String(job.id ?? ''),
        sourceJobId: payload.sourceJobId,
        tenantId: payload.tenantId,
        traceId: ensureTraceId(payload.traceId ?? payload.originalPayload.traceId),
        campaignId: payload.campaignId,
        taskId: payload.taskId,
        stage: payload.stage,
        errorCode: payload.errorCode,
        errorMessage: payload.errorMessage,
        retryable: payload.retryable,
        attemptsMade: payload.attemptsMade,
        maxAttempts: payload.maxAttempts,
        failedAt: payload.failedAt,
        replayedAt: payload.replayedAt,
        replayJobId: payload.replayJobId,
      };
      })
      .filter((item) => item.tenantId === tenantScope)
      .slice(0, safeLimit);
  }

  async listReplayAudit(sourceQueue: string, tenantScope: string, limit = 50): Promise<DlqReplayAuditLog[]> {
    if (!AUTOPILOT_QUEUES.includes(sourceQueue as (typeof AUTOPILOT_QUEUES)[number])) {
      throw new Error(`Unsupported source queue for replay audit list: ${sourceQueue}`);
    }
    const safeLimit = Math.max(1, Math.min(200, limit));
    const key = this.buildAuditListKey(sourceQueue);
    const fetchWindow = Math.min(500, safeLimit * 5);
    const rows = await redisReadWithFallback(
      this.logger,
      `list replay audit sourceQueue=${sourceQueue} limit=${safeLimit}`,
      async () => this.redis.lrange(key, 0, fetchWindow - 1),
      [] as string[],
    );
    const items: DlqReplayAuditLog[] = [];
    for (const row of rows) {
      try {
        items.push(JSON.parse(row) as DlqReplayAuditLog);
      } catch {
        // ignore malformed rows to keep endpoint robust
      }
    }
    return items.filter((item) => item.tenantId === tenantScope).slice(0, safeLimit);
  }

  async findDlqByTraceId(
    traceId: string,
    tenantScope: string,
    limit = 100,
  ): Promise<
    Array<{
      sourceQueue: string;
      dlqJobId: string;
      sourceJobId: string;
      tenantId: string;
      traceId: string;
      campaignId?: string;
      taskId: string;
      stage: string;
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
      attemptsMade: number;
      maxAttempts: number;
      failedAt: string;
      replayedAt?: string;
      replayJobId?: string;
    }>
  > {
    const normalizedTraceId = traceId.trim();
    if (!normalizedTraceId) return [];
    const safeLimit = Math.max(1, Math.min(200, limit));
    const all: Array<{
      sourceQueue: string;
      dlqJobId: string;
      sourceJobId: string;
      tenantId: string;
      traceId: string;
      campaignId?: string;
      taskId: string;
      stage: string;
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
      attemptsMade: number;
      maxAttempts: number;
      failedAt: string;
      replayedAt?: string;
      replayJobId?: string;
    }> = [];
    for (const sourceQueue of AUTOPILOT_QUEUES) {
      const queueItems = await this.listDlq(sourceQueue, tenantScope, Math.min(100, safeLimit * 2));
      for (const item of queueItems) {
        if (item.traceId !== normalizedTraceId) continue;
        all.push({ sourceQueue, ...item });
        if (all.length >= safeLimit) {
          return all;
        }
      }
    }
    return all;
  }

  async findReplayAuditByTraceId(
    traceId: string,
    tenantScope: string,
    limit = 100,
  ): Promise<DlqReplayAuditLog[]> {
    const normalizedTraceId = traceId.trim();
    if (!normalizedTraceId) return [];
    const safeLimit = Math.max(1, Math.min(200, limit));
    const all: DlqReplayAuditLog[] = [];
    for (const sourceQueue of AUTOPILOT_QUEUES) {
      const items = await this.listReplayAudit(sourceQueue, tenantScope, Math.min(100, safeLimit * 2));
      for (const item of items) {
        if (item.traceId !== normalizedTraceId) continue;
        all.push(item);
        if (all.length >= safeLimit) {
          return all;
        }
      }
    }
    return all;
  }

  private getQueueForSource(sourceQueue: string): Queue {
    return this.getDlqQueueForSource(sourceQueue);
  }

  private getDlqQueueForSource(sourceQueue: string): Queue {
    switch (sourceQueue) {
      case RADAR_SNIFFING_QUEUE:
        return this.radarDlqQueue;
      case CONTENT_FORGE_QUEUE:
        return this.contentDlqQueue;
      case MATRIX_DISPATCH_QUEUE:
        return this.dispatchDlqQueue;
      case LEAD_HARVEST_QUEUE:
        return this.harvestDlqQueue;
      default:
        return this.dispatchDlqQueue;
    }
  }

  private getSourceQueue(sourceQueue: string): Queue {
    switch (sourceQueue) {
      case RADAR_SNIFFING_QUEUE:
        return this.radarQueue;
      case CONTENT_FORGE_QUEUE:
        return this.contentQueue;
      case MATRIX_DISPATCH_QUEUE:
        return this.dispatchQueue;
      case LEAD_HARVEST_QUEUE:
        return this.harvestQueue;
      default:
        return this.dispatchQueue;
    }
  }

  private buildReplayLockKey(sourceQueue: string, dlqJobId: string): string {
    return `${REPLAY_LOCK_PREFIX}${sourceQueue}:${dlqJobId}`;
  }

  private buildReplayDoneKey(sourceQueue: string, dlqJobId: string): string {
    return `${REPLAY_DONE_PREFIX}${sourceQueue}:${dlqJobId}`;
  }

  private buildAuditListKey(sourceQueue: string): string {
    return `${REPLAY_AUDIT_LIST_PREFIX}${sourceQueue}`;
  }

  private buildAuditId(sourceQueue: string, dlqJobId: string): string {
    return `${sourceQueue}:${dlqJobId}:${Date.now()}`;
  }

  private async setReplayDoneMarker(
    key: string,
    marker: {
      replayJobId: string;
      replayCount: number;
      sourceJobId?: string;
      taskId?: string;
      stage?: string;
      traceId?: string;
      tenantId?: string;
    },
  ): Promise<void> {
    await redisWriteOrBlock(
      this.logger,
      `set dlq replay done marker key=${key}`,
      async () => this.redis.set(key, JSON.stringify(marker), 'EX', REPLAY_DONE_TTL_SECONDS),
    );
  }

  private safeParseReplayDone(
    raw: string,
  ): {
    replayJobId: string;
    replayCount?: number;
    sourceJobId?: string;
    taskId?: string;
    stage?: string;
    traceId?: string;
    tenantId?: string;
  } | null {
    try {
      return JSON.parse(raw) as {
        replayJobId: string;
        replayCount?: number;
        sourceJobId?: string;
        taskId?: string;
        stage?: string;
        traceId?: string;
        tenantId?: string;
      };
    } catch {
      return null;
    }
  }

  private async appendReplayAudit(log: DlqReplayAuditLog): Promise<void> {
    const key = this.buildAuditListKey(log.sourceQueue);
    await redisWriteOrBlock(
      this.logger,
      `append dlq replay audit sourceQueue=${log.sourceQueue} dlqJobId=${log.dlqJobId} result=${log.result}`,
      async () => {
        const multi = this.redis.multi();
        multi.lpush(key, JSON.stringify(log));
        multi.ltrim(key, 0, REPLAY_AUDIT_MAX_ITEMS - 1);
        multi.expire(key, REPLAY_DONE_TTL_SECONDS);
        await multi.exec();
      },
    );
  }

  private async appendReplayAuditBestEffort(log: DlqReplayAuditLog): Promise<void> {
    try {
      await this.appendReplayAudit(log);
    } catch (error) {
      this.logger.warn(
        `[ReplayAuditSkipped] sourceQueue=${log.sourceQueue} dlqJobId=${log.dlqJobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async releaseReplayLock(lockKey: string, lockToken: string): Promise<void> {
    await redisWriteOrBlock(
      this.logger,
      `release dlq replay lock key=${lockKey}`,
      async () => {
        const currentToken = await this.redis.get(lockKey);
        if (currentToken === lockToken) {
          await this.redis.del(lockKey);
        }
      },
    );
  }

  private async releaseReplayLockBestEffort(lockKey: string, lockToken: string): Promise<void> {
    try {
      await this.releaseReplayLock(lockKey, lockToken);
    } catch (error) {
      this.logger.warn(
        `[ReplayLockReleaseSkipped] lockKey=${lockKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
