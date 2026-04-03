import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { redisReadWithFallback } from '../common/redis-resilience';
import { AutopilotTaskStateService, type TaskStateRecord } from './autopilot-task-state.service';
import { AutopilotDlqService } from './autopilot-dlq.service';
import { BehaviorTraceService, type BehaviorTraceSnapshot } from '../behavior/behavior-trace.service';

const FLEET_TASK_KEY_PREFIX = 'fleet:task:';
const FLEET_TRACE_TASK_INDEX_PREFIX = 'fleet:trace:';

export interface FleetTaskSnapshot {
  taskId: string;
  nodeId?: string;
  progress?: number;
  message?: string;
  step?: string;
  completed?: boolean;
  success?: boolean;
  error?: string;
  completedAt?: string;
  traceId?: string;
}

export interface TraceSnapshotQuery {
  from?: string;
  to?: string;
  errorsOnly?: boolean;
  sourceQueue?: string;
}

@Injectable()
export class AutopilotTraceService {
  private readonly logger = new Logger(AutopilotTraceService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly taskStateService: AutopilotTaskStateService,
    private readonly dlqService: AutopilotDlqService,
    private readonly behaviorTraceService: BehaviorTraceService,
  ) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  async getTraceSnapshot(traceId: string, tenantScope: string, query?: TraceSnapshotQuery): Promise<{
    traceId: string;
    tenantId: string;
    taskStates: TaskStateRecord[];
    dlqItems: Awaited<ReturnType<AutopilotDlqService['findDlqByTraceId']>>;
    replayAudits: Awaited<ReturnType<AutopilotDlqService['findReplayAuditByTraceId']>>;
    behavior: {
      snapshots: BehaviorTraceSnapshot[];
    };
    fleet: {
      taskIds: string[];
      snapshots: FleetTaskSnapshot[];
    };
  }> {
    const normalizedTraceId = traceId.trim();
    const fromMs = this.parseTime(query?.from);
    const toMs = this.parseTime(query?.to);
    const errorsOnly = query?.errorsOnly === true;
    const sourceQueue = query?.sourceQueue?.trim();

    const rawTaskStates = await this.taskStateService.listByTraceId(normalizedTraceId, tenantScope);
    const rawDlqItems = await this.dlqService.findDlqByTraceId(normalizedTraceId, tenantScope, 200);
    const rawReplayAudits = await this.dlqService.findReplayAuditByTraceId(normalizedTraceId, tenantScope, 200);
    const rawBehaviorSnapshots = await this.behaviorTraceService.listByTraceId(normalizedTraceId, tenantScope, 300);

    const taskStates = rawTaskStates.filter((item) => {
      const timeOk = this.inWindow(item.updatedAt || item.createdAt, fromMs, toMs);
      if (!timeOk) return false;
      if (sourceQueue && item.sourceQueue !== sourceQueue) return false;
      if (!errorsOnly) return true;
      return item.state === 'failed' || item.state === 'canceled' || !!item.errorCode;
    });
    const dlqItems = rawDlqItems.filter((item) => {
      if (!this.inWindow(item.failedAt, fromMs, toMs)) return false;
      if (sourceQueue && item.sourceQueue !== sourceQueue) return false;
      return true;
    });
    const replayAudits = rawReplayAudits.filter((item) => {
      const baseTs = item.completedAt || item.requestedAt;
      const timeOk = this.inWindow(baseTs, fromMs, toMs);
      if (!timeOk) return false;
      if (sourceQueue && item.sourceQueue !== sourceQueue) return false;
      if (!errorsOnly) return true;
      return item.result === 'failed' || item.result === 'lock_not_acquired' || !!item.errorMessage;
    });
    const behaviorSnapshots = rawBehaviorSnapshots.filter((item) => {
      const timeOk = this.inWindow(item.createdAt, fromMs, toMs);
      if (!timeOk) return false;
      if (sourceQueue) return false;
      if (!errorsOnly) return true;
      return !!item.issueCode;
    });

    const taskIds = new Set<string>();
    for (const item of taskStates) taskIds.add(item.taskId);
    for (const item of dlqItems) taskIds.add(item.taskId);
    const indexedTaskIds = await redisReadWithFallback(
      this.logger,
      `trace index task ids traceId=${normalizedTraceId}`,
      async () => this.redis.smembers(`${FLEET_TRACE_TASK_INDEX_PREFIX}${normalizedTraceId}:tasks`),
      [] as string[],
    );
    if (!sourceQueue) {
      for (const id of indexedTaskIds) taskIds.add(id);
    }

    const snapshots: FleetTaskSnapshot[] = [];
    for (const taskId of taskIds) {
      const hash = await redisReadWithFallback(
        this.logger,
        `fleet task snapshot taskId=${taskId}`,
        async () => this.redis.hgetall(FLEET_TASK_KEY_PREFIX + taskId),
        {} as Record<string, string>,
      );
      if (!hash || Object.keys(hash).length === 0) continue;
      if (hash.traceId && hash.traceId !== normalizedTraceId) continue;
      const snapshot: FleetTaskSnapshot = {
        taskId,
        nodeId: hash.nodeId || undefined,
        progress: hash.progress ? Number(hash.progress) : undefined,
        message: hash.message || undefined,
        step: hash.step || undefined,
        completed: hash.completed === '1' ? true : hash.completed === '0' ? false : undefined,
        success: hash.success === '1' ? true : hash.success === '0' ? false : undefined,
        error: hash.error || undefined,
        completedAt: hash.completedAt || undefined,
        traceId: hash.traceId || normalizedTraceId,
      };
      const timeOk = this.inWindow(snapshot.completedAt, fromMs, toMs);
      if (!timeOk) continue;
      if (errorsOnly && !snapshot.error && snapshot.success !== false) {
        continue;
      }
      snapshots.push(snapshot);
    }

    return {
      traceId: normalizedTraceId,
      tenantId: tenantScope,
      taskStates,
      dlqItems,
      replayAudits,
      behavior: {
        snapshots: behaviorSnapshots,
      },
      fleet: {
        taskIds: Array.from(taskIds),
        snapshots,
      },
    };
  }

  private parseTime(raw?: string): number | undefined {
    const normalized = raw?.trim();
    if (!normalized) return undefined;
    const ms = Date.parse(normalized);
    return Number.isFinite(ms) ? ms : undefined;
  }

  private inWindow(value: string | undefined, fromMs?: number, toMs?: number): boolean {
    if (!fromMs && !toMs) return true;
    if (!value) return false;
    const currentMs = Date.parse(value);
    if (!Number.isFinite(currentMs)) return false;
    if (fromMs && currentMs < fromMs) return false;
    if (toMs && currentMs > toMs) return false;
    return true;
  }
}
