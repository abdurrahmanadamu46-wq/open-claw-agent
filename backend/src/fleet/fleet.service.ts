import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';
import type { FleetCommandActionType, FleetCommandRecord, FleetNodeRecord } from './fleet.types';
import { FleetWebSocketGateway } from '../gateway/fleet-websocket.gateway';
import type { LobsterTaskPayload } from '../gateway/lobster-sop.types';

const FLEET_NODE_KEY_PREFIX = 'fleet:node:';
const FLEET_COMMAND_KEY_PREFIX = 'fleet:command:';
const FLEET_COMMAND_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class FleetService {
  private readonly logger = new Logger(FleetService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly fleetGateway: FleetWebSocketGateway,
  ) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private toNodeRecord(nodeId: string, hash: Record<string, string>, tenantScope: string): FleetNodeRecord {
    const platforms = (hash.platforms ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean) as FleetNodeRecord['platforms'];
    return {
      nodeId,
      tenantId: hash.tenant_id || tenantScope,
      clientId: hash.client_id || hash.tenant_id || tenantScope,
      clientName: hash.client_name || nodeId,
      status: (hash.status as FleetNodeRecord['status']) || 'OFFLINE',
      lastPingAt: new Date(Number.parseInt(hash.last_seen || String(Date.now()), 10)).toISOString(),
      cpuPercent: Number.parseFloat(hash.cpu_percent || '0') || 0,
      memoryPercent: Number.parseFloat(hash.memory_percent || '0') || 0,
      platforms,
      ...(hash.current_account_summary ? { currentAccountSummary: hash.current_account_summary } : {}),
      ...(hash.circuit_breaker_reason ? { circuitBreakerReason: hash.circuit_breaker_reason } : {}),
      ...(hash.pending_task_count ? { pendingTaskCount: Number.parseInt(hash.pending_task_count, 10) || 0 } : {}),
      ...(hash.running_task_count ? { runningTaskCount: Number.parseInt(hash.running_task_count, 10) || 0 } : {}),
      ...(hash.meta_cache_status ? { metaCacheStatus: hash.meta_cache_status } : {}),
      ...(hash.twin_synced ? { twinSynced: hash.twin_synced === 'true' || hash.twin_synced === '1' } : {}),
      ...(hash.pending_config_updates ? { pendingConfigUpdates: Number.parseInt(hash.pending_config_updates, 10) || 0 } : {}),
      ...(hash.pending_skill_updates ? { pendingSkillUpdates: Number.parseInt(hash.pending_skill_updates, 10) || 0 } : {}),
      ...(hash.max_concurrent_tasks ? { maxConcurrentTasks: Number.parseInt(hash.max_concurrent_tasks, 10) || 0 } : {}),
      ...(hash.log_level ? { logLevel: hash.log_level } : {}),
      ...(hash.edge_version ? { edgeVersion: hash.edge_version } : {}),
      ...(hash.desired_resource_version ? { desiredResourceVersion: Number.parseInt(hash.desired_resource_version, 10) || 0 } : {}),
      ...(hash.reported_resource_version ? { actualResourceVersion: Number.parseInt(hash.reported_resource_version, 10) || 0 } : {}),
      ...(hash.config_version_summary ? { configVersionSummary: hash.config_version_summary } : {}),
      ...(hash.skill_version_summary ? { skillVersionSummary: hash.skill_version_summary } : {}),
    };
  }

  async listNodes(tenantScope: string): Promise<FleetNodeRecord[]> {
    const stream = this.redis.scanStream({ match: `${FLEET_NODE_KEY_PREFIX}*`, count: 200 });
    const keys: string[] = [];
    for await (const chunk of stream as AsyncIterable<string[]>) {
      keys.push(...chunk);
    }
    if (keys.length === 0) return [];

    const rows: FleetNodeRecord[] = [];
    for (const key of keys) {
      const hash = await redisReadWithFallback(
        this.logger,
        `fleet hgetall key=${key}`,
        async () => this.redis.hgetall(key),
        {} as Record<string, string>,
      );
      if (!hash || Object.keys(hash).length === 0) continue;
      const nodeId = key.slice(FLEET_NODE_KEY_PREFIX.length);
      const tenantId = (hash.tenant_id || tenantScope).trim();
      if (tenantId !== tenantScope) continue;
      rows.push(this.toNodeRecord(nodeId, hash, tenantScope));
    }
    rows.sort((a, b) => (a.lastPingAt > b.lastPingAt ? -1 : 1));
    return rows;
  }

  async forceOffline(tenantScope: string, nodeId: string): Promise<{ ok: boolean }> {
    const key = `${FLEET_NODE_KEY_PREFIX}${nodeId}`;
    const tenantId = await redisReadWithFallback(
      this.logger,
      `fleet get tenant key=${key}`,
      async () => this.redis.hget(key, 'tenant_id'),
      null as string | null,
    );
    if (tenantId && tenantId !== tenantScope) {
      return { ok: false };
    }
    await redisWriteOrBlock(this.logger, `fleet force offline node=${nodeId}`, async () => {
      await this.redis
        .multi()
        .hset(key, 'status', 'OFFLINE')
        .hset(key, 'last_seen', String(Date.now()))
        .exec();
      return true;
    });
    return { ok: true };
  }

  private mapActionToLobster(actionType: FleetCommandActionType): LobsterTaskPayload['actionType'] {
    if (actionType === 'STOP_CAMPAIGN') return 'STOP_CAMPAIGN';
    if (actionType === 'SYNC_CONFIG' || actionType === 'PROVISION_ACK' || actionType === 'RESTART_AGENT') return 'SYNC_CONFIG';
    return 'START_CAMPAIGN';
  }

  async dispatchCommand(input: {
    tenantScope: string;
    targetNodeId: string;
    actionType: FleetCommandActionType;
    payload: Record<string, unknown>;
  }): Promise<FleetCommandRecord> {
    const commandId = `cmd_${uuidv4()}`;
    const createdAt = new Date().toISOString();
    const command: FleetCommandRecord = {
      commandId,
      targetNodeId: input.targetNodeId,
      tenantId: input.tenantScope,
      actionType: input.actionType,
      payload: input.payload,
      status: 'SENT',
      createdAt,
    };

    const dispatched = this.fleetGateway.dispatchTask(input.targetNodeId, {
      taskId: commandId,
      campaignId: typeof input.payload.campaignId === 'string' ? input.payload.campaignId : undefined,
      actionType: this.mapActionToLobster(input.actionType),
      params: input.payload,
      createdAt,
    });
    if (!dispatched) {
      command.status = 'PENDING';
    }

    await redisWriteOrBlock(this.logger, `fleet save command ${commandId}`, async () => {
      const key = `${FLEET_COMMAND_KEY_PREFIX}${commandId}`;
      const hash: Record<string, string> = {
        command_id: command.commandId,
        target_node_id: command.targetNodeId,
        tenant_id: command.tenantId,
        action_type: command.actionType,
        payload: JSON.stringify(command.payload ?? {}),
        status: command.status,
        created_at: command.createdAt,
      };
      await this.redis
        .multi()
        .hset(key, hash)
        .expire(key, FLEET_COMMAND_TTL_SECONDS)
        .exec();
      return true;
    });

    return command;
  }

  dispatchSecurityAuditTrigger(input: {
    tenantScope: string;
    nodeId: string;
    sessionId?: string;
  }): boolean {
    return this.fleetGateway.dispatchControlMessage(input.nodeId, {
      type: 'security_audit_trigger',
      session_id: input.sessionId ?? '',
    });
  }

  dispatchSecurityBaselineRebuild(input: {
    tenantScope: string;
    nodeId: string;
    baselineType: 'credential' | 'sop' | 'all';
    sessionId?: string;
  }): boolean {
    return this.fleetGateway.dispatchControlMessage(input.nodeId, {
      type: 'security_baseline_rebuild',
      session_id: input.sessionId ?? '',
      baseline_type: input.baselineType,
    });
  }

  requestEdgeToolManifest(input: {
    tenantScope: string;
    nodeId: string;
    sessionId?: string;
  }): boolean {
    return this.fleetGateway.requestEdgeToolManifest(input.nodeId);
  }

  async dispatchMcpToolCall(input: {
    tenantScope: string;
    nodeId: string;
    tool: string;
    params?: Record<string, unknown>;
    sessionId?: string;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>> {
    const ok = this.fleetGateway.dispatchMcpToolCall(input.nodeId, {
      tool: input.tool,
      params: input.params ?? {},
      session_id: input.sessionId ?? '',
      timeout_ms: input.timeoutMs,
    });
    return { dispatched: ok };
  }

  listEdgeToolManifests(): Array<Record<string, unknown>> {
    this.fleetGateway.listEdgeToolManifests();
    return [];
  }
}
