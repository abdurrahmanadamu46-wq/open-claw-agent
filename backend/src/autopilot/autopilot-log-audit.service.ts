import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { AUTOPILOT_QUEUES } from './autopilot.constants';
import { AutopilotTaskStateService, type TaskStateRecord } from './autopilot-task-state.service';
import { AutopilotDlqService } from './autopilot-dlq.service';
import { BehaviorTraceService, type BehaviorTraceSnapshot } from '../behavior/behavior-trace.service';
import { redisReadWithFallback } from '../common/redis-resilience';

export type AutopilotAuditLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SECURITY';

export type AutopilotAuditLogModule =
  | 'PATROL'
  | 'DISPATCHER'
  | 'ECHOER'
  | 'CATCHER'
  | 'WEBHOOK'
  | 'FLEET'
  | 'BEHAVIOR'
  | 'AUTOPILOT';

export interface AutopilotAuditLogRecord {
  id: string;
  ts: string;
  level: AutopilotAuditLogLevel;
  module: AutopilotAuditLogModule;
  nodeId?: string;
  traceId?: string;
  eventType: string;
  message: string;
  campaignId?: string;
  sourceQueue?: string;
  durationMs?: number;
  taskId?: string;
  stage?: string;
}

export interface AutopilotAuditLogQuery {
  from?: string;
  to?: string;
  errorsOnly?: boolean;
  sourceQueue?: string;
  module?: string;
  level?: string;
  nodeId?: string;
  traceId?: string;
  keyword?: string;
  limit?: number;
}

@Injectable()
export class AutopilotLogAuditService {
  private readonly logger = new Logger(AutopilotLogAuditService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly taskStateService: AutopilotTaskStateService,
    private readonly dlqService: AutopilotDlqService,
    private readonly behaviorTraceService: BehaviorTraceService,
  ) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  async searchLogs(
    tenantScope: string,
    query: AutopilotAuditLogQuery,
  ): Promise<{
    tenantId: string;
    query: {
      from?: string;
      to?: string;
      errorsOnly: boolean;
      sourceQueue?: string;
      module?: string;
      level?: string;
      nodeId?: string;
      traceId?: string;
      keyword?: string;
      limit: number;
    };
    total: number;
    items: AutopilotAuditLogRecord[];
  }> {
    const safeLimit = Number.isFinite(query.limit) ? Math.max(1, Math.min(500, Number(query.limit))) : 100;
    const errorsOnly = query.errorsOnly === true;
    const sourceQueue = query.sourceQueue?.trim();
    const traceId = query.traceId?.trim();

    let records: AutopilotAuditLogRecord[];
    if (traceId) {
      records = await this.collectByTraceId(tenantScope, traceId, sourceQueue);
    } else {
      records = await this.collectByTenant(tenantScope, sourceQueue);
    }

    const filtered = records.filter((item) => this.matchFilter(item, query, errorsOnly));
    filtered.sort((a, b) => b.ts.localeCompare(a.ts));

    return {
      tenantId: tenantScope,
      query: {
        from: query.from?.trim() || undefined,
        to: query.to?.trim() || undefined,
        errorsOnly,
        sourceQueue,
        module: query.module?.trim() || undefined,
        level: query.level?.trim() || undefined,
        nodeId: query.nodeId?.trim() || undefined,
        traceId: traceId || undefined,
        keyword: query.keyword?.trim() || undefined,
        limit: safeLimit,
      },
      total: filtered.length,
      items: filtered.slice(0, safeLimit),
    };
  }

  private async collectByTraceId(
    tenantScope: string,
    traceId: string,
    sourceQueue?: string,
  ): Promise<AutopilotAuditLogRecord[]> {
    const [taskStates, dlqItems, replayAudits, behaviorSnapshots] = await Promise.all([
      this.taskStateService.listByTraceId(traceId, tenantScope),
      this.dlqService.findDlqByTraceId(traceId, tenantScope, 300),
      this.dlqService.findReplayAuditByTraceId(traceId, tenantScope, 300),
      this.behaviorTraceService.listByTraceId(traceId, tenantScope, 300),
    ]);

    const output: AutopilotAuditLogRecord[] = [];
    for (const item of taskStates) {
      if (sourceQueue && item.sourceQueue !== sourceQueue) continue;
      output.push(this.fromTaskState(item));
    }
    for (const item of dlqItems) {
      if (sourceQueue && item.sourceQueue !== sourceQueue) continue;
      output.push({
        id: `dlq:${item.sourceQueue}:${item.dlqJobId}`,
        ts: item.failedAt,
        level: item.retryable ? 'WARN' : 'ERROR',
        module: this.moduleFromQueue(item.sourceQueue),
        traceId: item.traceId,
        eventType: 'dlq.enqueue',
        message: item.errorMessage,
        campaignId: item.campaignId,
        sourceQueue: item.sourceQueue,
        taskId: item.taskId,
        stage: item.stage,
      });
    }
    for (const item of replayAudits) {
      if (sourceQueue && item.sourceQueue !== sourceQueue) continue;
      output.push({
        id: `replay:${item.sourceQueue}:${item.auditId}`,
        ts: item.completedAt ?? item.requestedAt,
        level:
          item.result === 'success' || item.result === 'already_replayed'
            ? 'INFO'
            : item.result === 'lock_not_acquired'
              ? 'WARN'
              : 'ERROR',
        module: 'AUTOPILOT',
        traceId: item.traceId,
        eventType: `dlq.replay.${item.result}`,
        message: item.errorMessage ?? `replay ${item.result}`,
        sourceQueue: item.sourceQueue,
        taskId: item.taskId,
        stage: item.stage,
      });
    }
    for (const item of behaviorSnapshots) {
      output.push(this.fromBehaviorTrace(item));
    }
    return output;
  }

  private async collectByTenant(tenantScope: string, sourceQueue?: string): Promise<AutopilotAuditLogRecord[]> {
    const output: AutopilotAuditLogRecord[] = [];

    const taskStates = await this.listTenantTaskStates(tenantScope, 2000);
    for (const item of taskStates) {
      if (sourceQueue && item.sourceQueue !== sourceQueue) continue;
      output.push(this.fromTaskState(item));
    }

    for (const queueName of AUTOPILOT_QUEUES) {
      if (sourceQueue && queueName !== sourceQueue) continue;
      const [dlqItems, replayAudits] = await Promise.all([
        this.dlqService.listDlq(queueName, tenantScope, 100),
        this.dlqService.listReplayAudit(queueName, tenantScope, 100),
      ]);

      for (const item of dlqItems) {
        output.push({
          id: `dlq:${queueName}:${item.dlqJobId}`,
          ts: item.failedAt,
          level: item.retryable ? 'WARN' : 'ERROR',
          module: this.moduleFromQueue(queueName),
          traceId: item.traceId,
          eventType: 'dlq.enqueue',
          message: item.errorMessage,
          campaignId: item.campaignId,
          sourceQueue: queueName,
          taskId: item.taskId,
          stage: item.stage,
        });
      }

      for (const item of replayAudits) {
        output.push({
          id: `replay:${queueName}:${item.auditId}`,
          ts: item.completedAt ?? item.requestedAt,
          level:
            item.result === 'success' || item.result === 'already_replayed'
              ? 'INFO'
              : item.result === 'lock_not_acquired'
                ? 'WARN'
                : 'ERROR',
          module: 'AUTOPILOT',
          traceId: item.traceId,
          eventType: `dlq.replay.${item.result}`,
          message: item.errorMessage ?? `replay ${item.result}`,
          sourceQueue: queueName,
          taskId: item.taskId,
          stage: item.stage,
        });
      }
    }

    return output;
  }

  private async listTenantTaskStates(tenantScope: string, cap = 2000): Promise<TaskStateRecord[]> {
    const keys = await this.scanKeys('autopilot:task:*', cap);
    const rows: TaskStateRecord[] = [];
    for (const key of keys) {
      if (!key.startsWith('autopilot:task:')) continue;
      if (key.includes(':index:') || key === 'autopilot:task:running:index') continue;
      const hash = await redisReadWithFallback(
        this.logger,
        `audit read task hash key=${key}`,
        async () => this.redis.hgetall(key),
        {} as Record<string, string>,
      );
      if (!hash.taskId || !hash.stage || !hash.state || !hash.tenantId || !hash.sourceQueue) continue;
      if (hash.tenantId !== tenantScope) continue;
      rows.push({
        recordId: hash.recordId || `${hash.taskId}:${hash.stage}`,
        taskId: hash.taskId,
        traceId: hash.traceId || undefined,
        stage: hash.stage,
        state: hash.state as TaskStateRecord['state'],
        tenantId: hash.tenantId,
        campaignId: hash.campaignId || undefined,
        sourceQueue: hash.sourceQueue,
        nodeId: hash.nodeId || undefined,
        errorCode: hash.errorCode || undefined,
        errorMessage: hash.errorMessage || undefined,
        createdAt: hash.createdAt,
        updatedAt: hash.updatedAt,
      });
      if (rows.length >= cap) break;
    }
    return rows;
  }

  private async scanKeys(pattern: string, cap = 2000): Promise<string[]> {
    const out: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redisReadWithFallback(
        this.logger,
        `audit scan pattern=${pattern}`,
        async () => this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200),
        ['0', []] as [string, string[]],
      );
      cursor = nextCursor;
      for (const key of keys) {
        out.push(key);
        if (out.length >= cap) return out;
      }
    } while (cursor !== '0');
    return out;
  }

  private fromTaskState(item: TaskStateRecord): AutopilotAuditLogRecord {
    const level: AutopilotAuditLogLevel =
      item.state === 'failed' || item.state === 'canceled'
        ? 'ERROR'
        : item.errorCode
          ? 'WARN'
          : item.state === 'running'
            ? 'INFO'
            : 'INFO';
    return {
      id: `task:${item.recordId}`,
      ts: item.updatedAt || item.createdAt,
      level,
      module: this.moduleFromQueue(item.sourceQueue),
      nodeId: item.nodeId,
      traceId: item.traceId,
      eventType: `task.state.${item.state}`,
      message: item.errorMessage || `${item.stage} -> ${item.state}`,
      campaignId: item.campaignId,
      sourceQueue: item.sourceQueue,
      taskId: item.taskId,
      stage: item.stage,
    };
  }

  private fromBehaviorTrace(item: BehaviorTraceSnapshot): AutopilotAuditLogRecord {
    return {
      id: `behavior:${item.traceId}:${item.sessionId}:${item.createdAt}`,
      ts: item.createdAt,
      level: item.issueCode ? 'WARN' : 'INFO',
      module: 'BEHAVIOR',
      nodeId: item.nodeId,
      traceId: item.traceId,
      eventType: item.eventType,
      message: item.issueCode ? `behavior issue: ${item.issueCode}` : 'behavior snapshot captured',
      campaignId: item.campaignId,
      taskId: item.taskId,
    };
  }

  private moduleFromQueue(queueName: string): AutopilotAuditLogModule {
    if (queueName.includes('radar')) return 'PATROL';
    if (queueName.includes('dispatch')) return 'DISPATCHER';
    if (queueName.includes('content')) return 'ECHOER';
    if (queueName.includes('harvest')) return 'CATCHER';
    return 'AUTOPILOT';
  }

  private matchFilter(
    item: AutopilotAuditLogRecord,
    query: AutopilotAuditLogQuery,
    errorsOnly: boolean,
  ): boolean {
    const fromMs = this.parseTime(query.from);
    const toMs = this.parseTime(query.to);
    const itemMs = Date.parse(item.ts);
    if (fromMs != null && Number.isFinite(itemMs) && itemMs < fromMs) return false;
    if (toMs != null && Number.isFinite(itemMs) && itemMs > toMs) return false;

    if (query.sourceQueue?.trim() && item.sourceQueue !== query.sourceQueue.trim()) return false;
    if (query.module?.trim() && item.module !== query.module.trim()) return false;
    if (query.level?.trim() && item.level !== query.level.trim()) return false;
    if (query.nodeId?.trim() && item.nodeId !== query.nodeId.trim()) return false;
    if (query.traceId?.trim() && item.traceId !== query.traceId.trim()) return false;

    if (errorsOnly && item.level === 'INFO') return false;

    const keyword = query.keyword?.trim().toLowerCase();
    if (keyword) {
      const haystack = [
        item.eventType,
        item.message,
        item.traceId,
        item.campaignId,
        item.taskId,
        item.stage,
        item.sourceQueue,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  }

  private parseTime(raw?: string): number | undefined {
    const normalized = raw?.trim();
    if (!normalized) return undefined;
    const ms = Date.parse(normalized);
    return Number.isFinite(ms) ? ms : undefined;
  }
}
