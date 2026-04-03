import { Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import { ensureSocketTrace, wsTracePrefix } from '../common/socket-trace.util';
import { LeadService } from '../lead/lead.service';
import { SecurityAuditRepository } from '../security-audit/security-audit.repository';
import { TerminalSessionRegistry } from '../terminal/terminal-session.registry';
import type {
  LobsterTaskPayload,
  NodePingPayload,
  TaskCompletedPayload,
  TaskProgressPayload,
  BehaviorSessionDispatchPayload,
} from './lobster-sop.types';

const REDIS_NODE_PREFIX = 'fleet:node:';
const REDIS_TASK_PREFIX = 'fleet:task:';
const REDIS_TRACE_TASK_INDEX_PREFIX = 'fleet:trace:';
const NODE_TTL_SEC = 60;
const TASK_TTL_SEC = 86400 * 7;

type ClientTaskAckPayload = {
  task_id?: string;
  taskId?: string;
  job_id?: string;
  campaign_id?: string;
  status?: string;
  timestamp?: number;
  trace_id?: string;
  traceId?: string;
  node_id?: string;
  nodeId?: string;
  message?: string;
};

type ClientLeadReportPayload = {
  tenant_id?: string;
  campaign_id?: string;
  contact_info?: string;
  intention_score?: number;
  source_platform?: string;
  user_message?: string;
  captured_at?: string;
  webhook_status?: 'PENDING' | 'SUCCESS' | 'FAILED';
  trace_id?: string;
  traceId?: string;
  node_id?: string;
  nodeId?: string;
};

type ClientHeartbeatPayload = {
  cpu_usage?: number;
  memory_usage_mb?: number;
  active_browsers?: number;
  status?: string;
  node_id?: string;
  nodeId?: string;
  trace_id?: string;
  traceId?: string;
  tenant_id?: string;
  tenantId?: string;
};

type ClientNodeStatusPayload = {
  campaign_id?: string;
  current_status?: string;
  progress?: string;
  node_id?: string;
  nodeId?: string;
  trace_id?: string;
  traceId?: string;
};

@WebSocketGateway({
  path: '/fleet',
  cors: { origin: true },
  namespace: '/',
})
export class FleetWebSocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(FleetWebSocketGateway.name);
  private readonly nodeToSocket = new Map<string, string>();
  private readonly socketToNode = new Map<string, string>();
  private readonly edgeToolManifests = new Map<string, { nodeId: string; tenantId?: string; tools: Array<Record<string, unknown>>; updatedAt: string }>();
  private readonly pendingMcpToolCalls = new Map<
    string,
    { resolve: (value: Record<string, unknown>) => void; reject: (reason?: unknown) => void; timer: NodeJS.Timeout }
  >();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly redisService: RedisService,
    private readonly leadService: LeadService,
    private readonly securityAuditRepository: SecurityAuditRepository,
    private readonly terminalSessions: TerminalSessionRegistry,
  ) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  afterInit() {
    this.logger.log('FleetWebSocketGateway initialized at /fleet');
  }

  handleConnection(client: Socket) {
    const trace = ensureSocketTrace(client);
    if (!this.verifyEdgeHandshake(client)) {
      this.logger.warn(`${wsTracePrefix(trace.traceId, trace.spanId)}[Fleet] Reject: invalid edge auth signature`);
      client.disconnect();
      return;
    }
    const nodeId = this.resolveNodeId(client);
    if (!nodeId) {
      this.logger.warn(`${wsTracePrefix(trace.traceId, trace.spanId)}[Fleet] Reject: missing nodeId`);
      client.disconnect();
      return;
    }

    const existingSocketId = this.nodeToSocket.get(nodeId);
    if (existingSocketId && existingSocketId !== client.id) {
      const old = this.server.sockets.sockets.get(existingSocketId);
      if (old?.connected) {
        old.emit('server.kicked', { reason: 'SAME_NODE_ELSEWHERE' });
        old.disconnect(true);
      }
      this.nodeToSocket.delete(nodeId);
      this.socketToNode.delete(existingSocketId);
    }

    this.nodeToSocket.set(nodeId, client.id);
    this.socketToNode.set(client.id, nodeId);
    client.join(`node:${nodeId}`);

    const tenantId = this.resolveTenantId(client);
    void this.setNodeStatus(nodeId, 'ONLINE', tenantId);
    this.logger.log(
      `${wsTracePrefix(trace.traceId, trace.spanId)}[Fleet] Node connected: nodeId=${nodeId}, socketId=${client.id}`,
    );
  }

  async handleDisconnect(client: Socket) {
    const trace = ensureSocketTrace(client);
    const nodeId = this.socketToNode.get(client.id);
    if (nodeId) {
      this.nodeToSocket.delete(nodeId);
      this.socketToNode.delete(client.id);
      await this.setNodeStatus(nodeId, 'OFFLINE');
    }
    this.logger.log(
      `${wsTracePrefix(trace.traceId, trace.spanId)}[Fleet] Node disconnected: socketId=${client.id}, nodeId=${nodeId ?? '-'}`,
    );
  }

  private resolveNodeId(client: Socket, payload?: { node_id?: string; nodeId?: string }): string {
    const fromPayload = payload?.nodeId ?? payload?.node_id;
    const fromSocket = this.socketToNode.get(client.id);
    const fromAuth = client.handshake.auth?.nodeId ?? client.handshake.auth?.node_id;
    const fromQuery = client.handshake.query?.nodeId ?? client.handshake.query?.node_id;
    const machineCodeHeader = client.handshake.headers['x-machine-code'];
    const fromHeader = typeof machineCodeHeader === 'string' ? machineCodeHeader : '';
    return String(fromPayload ?? fromSocket ?? fromAuth ?? fromQuery ?? fromHeader ?? '').trim();
  }

  private resolveTenantId(client: Socket, payload?: { tenant_id?: string; tenantId?: string }): string | undefined {
    const fromPayload = payload?.tenantId ?? payload?.tenant_id;
    const fromAuth = client.handshake.auth?.tenantId ?? client.handshake.auth?.tenant_id;
    const fromQuery = client.handshake.query?.tenantId ?? client.handshake.query?.tenant_id;
    const normalized = String(fromPayload ?? fromAuth ?? fromQuery ?? '').trim();
    return normalized || undefined;
  }

  private edgeSharedSecret(): string {
    return String(process.env.EDGE_SHARED_SECRET ?? '').trim();
  }

  private verifyEdgeHandshake(client: Socket): boolean {
    const sharedSecret = this.edgeSharedSecret();
    if (!sharedSecret) {
      return true;
    }
    const auth = (client.handshake.auth ?? {}) as Record<string, unknown>;
    const nodeId = String(auth.nodeId ?? auth.node_id ?? '').trim();
    const legacyEdgeSecret = String(auth.edgeSecret ?? auth.edge_secret ?? '').trim();
    if (legacyEdgeSecret && legacyEdgeSecret === sharedSecret) {
      return true;
    }
    const timestamp = String(auth.timestamp ?? '').trim();
    const nonce = String(auth.nonce ?? '').trim();
    const signature = String(auth.signature ?? '').trim();
    if (!nodeId || !timestamp || !nonce || !signature) {
      return false;
    }
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      return false;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > 60) {
      return false;
    }
    const payload = `${nodeId}:${timestamp}:${nonce}`;
    const expected = createHmac('sha256', sharedSecret).update(payload).digest('hex');
    if (expected.length !== signature.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  private async getTenantFromNode(nodeId: string): Promise<string | undefined> {
    const value = await this.redis.hget(`${REDIS_NODE_PREFIX}${nodeId}`, 'tenant_id');
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
  }

  private async setNodeStatus(nodeId: string, status: string, tenantId?: string) {
    const key = `${REDIS_NODE_PREFIX}${nodeId}`;
    const lastSeen = Date.now();
    const multi = this.redis.multi();
    multi.hset(key, 'last_seen', String(lastSeen));
    multi.hset(key, 'status', status);
    if (tenantId?.trim()) {
      multi.hset(key, 'tenant_id', tenantId.trim());
    }
    multi.expire(key, NODE_TTL_SEC);
    await multi.exec();
  }

  @SubscribeMessage('node_ping')
  async handleNodePing(@MessageBody() payload: NodePingPayload, @ConnectedSocket() client: Socket) {
    const trace = ensureSocketTrace(client, payload?.traceId);
    const nodeId = this.resolveNodeId(client, payload);
    if (!nodeId) return;

    const key = `${REDIS_NODE_PREFIX}${nodeId}`;
    const lastSeen = Date.now();
    const tenantId = this.resolveTenantId(client, payload) ?? (await this.getTenantFromNode(nodeId)) ?? '';
    await this.redis
      .multi()
      .hset(key, 'last_seen', String(lastSeen))
      .hset(key, 'status', payload.status ?? 'IDLE')
      .hset(key, 'tenant_id', tenantId)
      .hset(key, 'client_id', payload.clientId ?? '')
      .hset(key, 'client_name', payload.clientName ?? '')
      .hset(key, 'current_account_summary', payload.currentAccountSummary ?? '')
      .hset(key, 'circuit_breaker_reason', payload.circuitBreakerReason ?? '')
      .hset(key, 'cpu_percent', String(typeof payload.cpuPercent === 'number' ? payload.cpuPercent : 0))
      .hset(key, 'memory_percent', String(typeof payload.memoryPercent === 'number' ? payload.memoryPercent : 0))
      .hset(key, 'memory_usage_mb', String(typeof payload.memoryUsageMb === 'number' ? payload.memoryUsageMb : 0))
      .hset(
        key,
        'platforms',
        Array.isArray(payload.platforms) ? payload.platforms.map((p) => String(p)).join(',') : '',
      )
      .hset(key, 'current_task_id', payload.currentTaskId ?? '')
      .hset(key, 'lobster_configs', JSON.stringify(payload.lobsterConfigs ?? {}))
      .hset(key, 'skill_versions', JSON.stringify(payload.skillVersions ?? {}))
      .hset(key, 'pending_task_count', String(typeof payload.pendingTaskCount === 'number' ? payload.pendingTaskCount : 0))
      .hset(key, 'running_task_count', String(typeof payload.runningTaskCount === 'number' ? payload.runningTaskCount : 0))
      .hset(key, 'max_concurrent_tasks', String(typeof payload.maxConcurrentTasks === 'number' ? payload.maxConcurrentTasks : 0))
      .hset(key, 'log_level', payload.logLevel ?? '')
      .hset(key, 'meta_cache_status', payload.metaCacheStatus ?? '')
      .hset(key, 'edge_version', payload.edgeVersion ?? payload.version ?? '')
      .hset(key, 'reported_resource_version', String(typeof payload.reportedResourceVersion === 'number' ? payload.reportedResourceVersion : 0))
      .hset(key, 'config_version_summary', payload.configVersionSummary ?? '')
      .hset(key, 'skill_version_summary', payload.skillVersionSummary ?? '')
      .expire(key, NODE_TTL_SEC)
      .exec();

    this.server.to('fleet:report').emit('node_heartbeat', { nodeId, status: payload.status, lastSeen });
    this.logger.log(
      `${wsTracePrefix(trace.traceId, trace.spanId)}[Fleet] node_ping nodeId=${nodeId} status=${payload.status ?? 'IDLE'} currentTaskId=${payload.currentTaskId ?? '-'}`,
    );
  }

  @SubscribeMessage('client.heartbeat')
  async handleClientHeartbeat(@MessageBody() payload: ClientHeartbeatPayload, @ConnectedSocket() client: Socket) {
    const status = payload?.active_browsers && payload.active_browsers > 0 ? 'BUSY' : 'IDLE';
    await this.handleNodePing(
      {
        nodeId: this.resolveNodeId(client, payload),
        traceId: payload?.traceId ?? payload?.trace_id,
        tenantId: this.resolveTenantId(client, payload),
        status,
        cpuPercent: typeof payload?.cpu_usage === 'number' ? payload.cpu_usage : 0,
        memoryPercent: typeof payload?.memory_usage_mb === 'number' ? Math.min(100, payload.memory_usage_mb / 100) : 0,
      },
      client,
    );
  }

  @SubscribeMessage('task_progress')
  async handleTaskProgress(@MessageBody() payload: TaskProgressPayload, @ConnectedSocket() client: Socket) {
    const taskId = payload?.taskId?.trim();
    if (!taskId) return;
    const nodeId = payload?.nodeId?.trim() || this.resolveNodeId(client);
    const key = `${REDIS_TASK_PREFIX}${taskId}`;
    const traceId = payload.traceId?.trim();
    const multi = this.redis.multi();
    multi.hset(key, 'progress', String(payload.progress));
    multi.hset(key, 'message', payload.message ?? '');
    multi.hset(key, 'step', payload.step ?? '');
    multi.hset(key, 'nodeId', nodeId);
    multi.hset(key, 'traceId', traceId ?? '');
    multi.hset(key, 'updatedAt', new Date().toISOString());
    if (traceId) {
      multi.sadd(`${REDIS_TRACE_TASK_INDEX_PREFIX}${traceId}:tasks`, taskId);
      multi.expire(`${REDIS_TRACE_TASK_INDEX_PREFIX}${traceId}:tasks`, TASK_TTL_SEC);
    }
    multi.expire(key, TASK_TTL_SEC);
    await multi.exec();
    this.server.to('fleet:report').emit('task_progress', { ...payload, nodeId });
    this.logger.log(
      `${wsTracePrefix(traceId)}[Fleet] task_progress taskId=${taskId} nodeId=${nodeId} progress=${payload.progress}`,
    );
  }

  @SubscribeMessage('client.node.status')
  async handleClientNodeStatus(@MessageBody() payload: ClientNodeStatusPayload, @ConnectedSocket() client: Socket) {
    const nodeId = this.resolveNodeId(client, payload);
    if (!nodeId) return;
    const campaignId = payload.campaign_id?.trim() || 'campaign-legacy';
    const lowerStatus = String(payload.current_status ?? '').toLowerCase();
    let progress = 20;
    if (lowerStatus.includes('generat')) progress = 55;
    if (lowerStatus.includes('publish')) progress = 85;
    if (lowerStatus.includes('done') || lowerStatus.includes('finish')) progress = 100;

    await this.handleTaskProgress(
      {
        taskId: campaignId,
        nodeId,
        traceId: payload.traceId ?? payload.trace_id,
        progress,
        message: payload.progress || payload.current_status || 'legacy status update',
        step: payload.current_status || 'legacy_status',
      },
      client,
    );
  }

  @SubscribeMessage('task_completed')
  async handleTaskCompleted(@MessageBody() payload: TaskCompletedPayload, @ConnectedSocket() client: Socket) {
    const taskId = payload?.taskId?.trim();
    if (!taskId) return;
    const nodeId = payload?.nodeId?.trim() || this.resolveNodeId(client);
    const key = `${REDIS_TASK_PREFIX}${taskId}`;
    const traceId = payload.traceId?.trim();
    const multi = this.redis.multi();
    multi.hset(key, 'completed', '1');
    multi.hset(key, 'success', payload.success ? '1' : '0');
    multi.hset(key, 'error', payload.error ?? '');
    multi.hset(key, 'completedAt', payload.completedAt);
    multi.hset(key, 'nodeId', nodeId);
    multi.hset(key, 'traceId', traceId ?? '');
    multi.hset(key, 'updatedAt', new Date().toISOString());
    if (traceId) {
      multi.sadd(`${REDIS_TRACE_TASK_INDEX_PREFIX}${traceId}:tasks`, taskId);
      multi.expire(`${REDIS_TRACE_TASK_INDEX_PREFIX}${traceId}:tasks`, TASK_TTL_SEC);
    }
    multi.expire(key, TASK_TTL_SEC);
    await multi.exec();
    this.server.to('fleet:report').emit('task_completed', { ...payload, nodeId });
    this.logger.log(
      `${wsTracePrefix(traceId)}[Fleet] task_completed taskId=${taskId} nodeId=${nodeId} success=${payload.success}`,
    );
  }

  @SubscribeMessage('client.task.ack')
  async handleClientTaskAck(@MessageBody() payload: ClientTaskAckPayload, @ConnectedSocket() client: Socket) {
    const taskId = String(payload?.taskId ?? payload?.task_id ?? payload?.job_id ?? '').trim();
    if (!taskId) return;
    const nodeId = this.resolveNodeId(client, payload);
    const traceId = String(payload?.traceId ?? payload?.trace_id ?? '').trim();
    const key = `${REDIS_TASK_PREFIX}${taskId}`;
    const ackAt =
      typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp)
        ? new Date(payload.timestamp).toISOString()
        : new Date().toISOString();
    const multi = this.redis.multi();
    multi.hset(key, 'nodeId', nodeId);
    multi.hset(key, 'traceId', traceId);
    multi.hset(key, 'ackStatus', payload.status ?? 'ACCEPTED');
    multi.hset(key, 'ackMessage', payload.message ?? '');
    multi.hset(key, 'ackAt', ackAt);
    multi.hset(key, 'updatedAt', new Date().toISOString());
    if (payload.campaign_id?.trim()) {
      multi.hset(key, 'campaignId', payload.campaign_id.trim());
    }
    if (traceId) {
      multi.sadd(`${REDIS_TRACE_TASK_INDEX_PREFIX}${traceId}:tasks`, taskId);
      multi.expire(`${REDIS_TRACE_TASK_INDEX_PREFIX}${traceId}:tasks`, TASK_TTL_SEC);
    }
    multi.expire(key, TASK_TTL_SEC);
    await multi.exec();
    this.server.to('fleet:report').emit('task_ack', {
      taskId,
      nodeId,
      traceId: traceId || undefined,
      status: payload.status ?? 'ACCEPTED',
      ackAt,
      campaignId: payload.campaign_id,
    });
    this.logger.log(
      `${wsTracePrefix(traceId)}[Fleet] task_ack taskId=${taskId} nodeId=${nodeId} status=${payload.status ?? 'ACCEPTED'}`,
    );
  }

  @SubscribeMessage('client.lead.report')
  async handleClientLeadReport(@MessageBody() payload: ClientLeadReportPayload, @ConnectedSocket() client: Socket) {
    const nodeId = this.resolveNodeId(client, payload);
    const traceId = String(payload?.traceId ?? payload?.trace_id ?? '').trim() || undefined;
    const contact = String(payload?.contact_info ?? '').trim();
    if (!contact) return;

    const campaignId = String(payload?.campaign_id ?? '').trim() || 'campaign-edge-unknown';
    const tenantFromPayload = String(payload?.tenant_id ?? '').trim();
    const tenantFromNode = nodeId ? await this.getTenantFromNode(nodeId) : undefined;
    const tenantId = tenantFromPayload || tenantFromNode;
    if (!tenantId) {
      this.logger.warn(
        `${wsTracePrefix(traceId)}[Fleet] lead_reported skipped: missing tenant_id nodeId=${nodeId || '-'}`,
      );
      return;
    }

    const lead = await this.leadService.ingestFromEdge({
      tenant_id: tenantId,
      campaign_id: campaignId,
      contact_info: contact,
      intention_score: Number(payload?.intention_score ?? 0),
      source_platform: payload?.source_platform?.trim() || 'other',
      user_message: payload?.user_message?.trim() || '',
      captured_at: payload?.captured_at?.trim() || undefined,
      webhook_status: payload?.webhook_status,
    });

    this.server.to('fleet:report').emit('lead_reported', {
      lead_id: lead.lead_id,
      tenant_id: lead.tenant_id,
      campaign_id: lead.campaign_id,
      node_id: nodeId,
      trace_id: traceId,
      intent_score: lead.intent_score,
      source_platform: lead.source_platform,
      captured_at: lead.captured_at,
    });
    this.logger.log(
      `${wsTracePrefix(traceId)}[Fleet] lead_reported leadId=${lead.lead_id} tenant=${lead.tenant_id} campaign=${lead.campaign_id} nodeId=${nodeId}`,
    );
  }

  private async persistDispatchedTask(nodeId: string, payload: LobsterTaskPayload): Promise<void> {
    const key = `${REDIS_TASK_PREFIX}${payload.taskId}`;
    const now = new Date().toISOString();
    const multi = this.redis.multi();
    multi.hset(key, 'nodeId', nodeId);
    multi.hset(key, 'taskId', payload.taskId);
    multi.hset(key, 'campaignId', payload.campaignId ?? '');
    multi.hset(key, 'traceId', payload.traceId ?? '');
    multi.hset(key, 'status', 'DISPATCHED');
    multi.hset(key, 'createdAt', payload.createdAt ?? now);
    multi.hset(key, 'updatedAt', now);
    multi.hset(key, 'completed', '0');
    if (payload.traceId?.trim()) {
      multi.sadd(`${REDIS_TRACE_TASK_INDEX_PREFIX}${payload.traceId.trim()}:tasks`, payload.taskId);
      multi.expire(`${REDIS_TRACE_TASK_INDEX_PREFIX}${payload.traceId.trim()}:tasks`, TASK_TTL_SEC);
    }
    multi.expire(key, TASK_TTL_SEC);
    await multi.exec();
  }

  dispatchTask(nodeId: string, payload: LobsterTaskPayload): boolean {
    const socketId = this.nodeToSocket.get(nodeId);
    if (!socketId) {
      this.logger.warn(`${wsTracePrefix(payload.traceId)}[Fleet] Dispatch failed: node not connected nodeId=${nodeId}`);
      return false;
    }
    this.server.to(socketId).emit('execute_task', payload);

    // legacy compatibility channel: older clients still listen to `server.task.dispatch`
    this.server.to(socketId).emit('server.task.dispatch', {
      job_id: payload.taskId,
      task_id: payload.taskId,
      trace_id: payload.traceId,
      campaign_id: payload.campaignId,
      action: payload.actionType,
      config: payload.params,
      created_at: payload.createdAt,
    });

    void this.persistDispatchedTask(nodeId, payload);
    this.logger.log(`${wsTracePrefix(payload.traceId)}[Fleet] Dispatched taskId=${payload.taskId} to nodeId=${nodeId}`);
    return true;
  }

  /**
   * Dispatch behavior session to edge runtime.
   */
  dispatchBehaviorSession(nodeId: string, payload: BehaviorSessionDispatchPayload): boolean {
    const socketId = this.nodeToSocket.get(nodeId);
    if (!socketId) {
      this.logger.warn(`[Fleet] Dispatch behavior session failed: node not connected nodeId=${nodeId}`);
      return false;
    }
    this.server.to(socketId).emit('execute_behavior_session', payload);
    this.logger.log(`[Fleet] Dispatched behavior session=${payload.session_id} to nodeId=${nodeId}`);
    return true;
  }

  dispatchControlMessage(
    nodeId: string,
    payload: {
      type:
        | 'terminal_start'
        | 'terminal_command'
        | 'terminal_stop'
        | 'scheduler_status_request'
        | 'scheduler_toggle_request'
        | 'backup_trigger'
        | 'backup_list'
        | 'backup_restore'
        | 'security_audit_trigger'
        | 'security_baseline_rebuild'
        | 'mcp_tool_call'
        | 'get_tool_manifest';
      session_id: string;
      command?: string;
      job_name?: string;
      enabled?: boolean;
      output_dir?: string;
      dir?: string;
      filename?: string;
      dry_run?: boolean;
      baseline_type?: string;
      call_id?: string;
      tool?: string;
      params?: Record<string, unknown>;
    },
  ): boolean {
    const socketId = this.nodeToSocket.get(nodeId);
    if (!socketId) {
      this.logger.warn(`[Fleet] Dispatch terminal message failed: node not connected nodeId=${nodeId}`);
      return false;
    }
    this.server.to(socketId).emit(payload.type, payload);
    this.logger.log(
      `[Fleet] Dispatched ${payload.type} session=${payload.session_id} nodeId=${nodeId} command=${payload.command ?? '-'}`,
    );
    return true;
  }

  dispatchTerminalMessage(
    nodeId: string,
    payload: Parameters<FleetWebSocketGateway['dispatchControlMessage']>[1],
  ): boolean {
    return this.dispatchControlMessage(nodeId, payload);
  }

  requestEdgeToolManifest(nodeId: string, sessionId = ''): boolean {
    return this.dispatchControlMessage(nodeId, {
      type: 'get_tool_manifest',
      session_id: sessionId,
    });
  }

  async dispatchMcpToolCall(
    nodeId: string,
    payload: { tool: string; params?: Record<string, unknown>; session_id?: string; timeout_ms?: number },
  ): Promise<Record<string, unknown>> {
    const callId = `edge-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMcpToolCalls.delete(callId);
        reject(new Error('edge_mcp_timeout'));
      }, Math.max(1000, Math.min(Number(payload.timeout_ms ?? 15000), 60000)));
      this.pendingMcpToolCalls.set(callId, { resolve, reject, timer });
      const dispatched = this.dispatchControlMessage(nodeId, {
        type: 'mcp_tool_call',
        session_id: payload.session_id ?? '',
        call_id: callId,
        tool: payload.tool,
        params: payload.params ?? {},
      });
      if (!dispatched) {
        clearTimeout(timer);
        this.pendingMcpToolCalls.delete(callId);
        reject(new Error('edge_node_not_connected'));
      }
    });
  }

  listEdgeToolManifests(): Array<Record<string, unknown>> {
    return Array.from(this.edgeToolManifests.values())
      .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
      .map((item) => ({ ...item }));
  }

  @SubscribeMessage('terminal_output')
  handleTerminalOutput(
    @MessageBody()
    payload: {
      session_id?: string;
      data?: string;
      timestamp?: string;
      node_id?: string;
      nodeId?: string;
      command?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sessionId = String(payload?.session_id ?? '').trim();
    if (!sessionId) return;
    const nodeId = this.resolveNodeId(client, payload);
    this.terminalSessions.emitOutput(sessionId, {
      sessionId,
      nodeId,
      command: payload?.command,
      data: String(payload?.data ?? ''),
      timestamp: payload?.timestamp ?? new Date().toISOString(),
    });
  }

  @SubscribeMessage('terminal_error')
  handleTerminalError(
    @MessageBody()
    payload: {
      session_id?: string;
      message?: string;
      node_id?: string;
      nodeId?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sessionId = String(payload?.session_id ?? '').trim();
    if (!sessionId) return;
    const nodeId = this.resolveNodeId(client, payload);
    this.terminalSessions.emitError(sessionId, {
      sessionId,
      nodeId,
      message: String(payload?.message ?? 'terminal error'),
    });
  }

  @SubscribeMessage('terminal_closed')
  handleTerminalClosed(
    @MessageBody()
    payload: {
      session_id?: string;
      node_id?: string;
      nodeId?: string;
      reason?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sessionId = String(payload?.session_id ?? '').trim();
    if (!sessionId) return;
    const nodeId = this.resolveNodeId(client, payload);
    this.terminalSessions.emitClosed(sessionId, {
      sessionId,
      nodeId,
      reason: payload?.reason ?? 'stopped',
    });
    this.terminalSessions.remove(sessionId);
  }

  @SubscribeMessage('scheduler_status_response')
  handleSchedulerStatusResponse(
    @MessageBody()
    payload: {
      session_id?: string;
      jobs?: Array<Record<string, unknown>>;
      scheduled_tasks?: Array<Record<string, unknown>>;
      node_id?: string;
      nodeId?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sessionId = String(payload?.session_id ?? '').trim();
    if (!sessionId) return;
    const nodeId = this.resolveNodeId(client, payload);
    this.terminalSessions.emitSchedulerStatus(sessionId, {
      sessionId,
      nodeId,
      jobs: payload?.jobs ?? [],
      scheduledTasks: payload?.scheduled_tasks ?? [],
    });
  }

  @SubscribeMessage('scheduler_toggle_response')
  handleSchedulerToggleResponse(
    @MessageBody()
    payload: {
      session_id?: string;
      job_name?: string;
      enabled?: boolean;
      success?: boolean;
      message?: string;
      node_id?: string;
      nodeId?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sessionId = String(payload?.session_id ?? '').trim();
    if (!sessionId) return;
    const nodeId = this.resolveNodeId(client, payload);
    this.terminalSessions.emitSchedulerToggle(sessionId, {
      sessionId,
      nodeId,
      jobName: payload?.job_name,
      enabled: payload?.enabled,
      success: payload?.success,
      message: payload?.message,
    });
  }

  @SubscribeMessage('backup_complete')
  handleBackupComplete(
    @MessageBody()
    payload: {
      session_id?: string;
      success?: boolean;
      archive?: string;
      output?: string;
      backup_name?: string;
      size_bytes?: number;
      node_id?: string;
      nodeId?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sessionId = String(payload?.session_id ?? '').trim();
    if (!sessionId) return;
    const nodeId = this.resolveNodeId(client, payload);
    this.terminalSessions.emit(sessionId, 'edge_backup_complete', {
      sessionId,
      nodeId,
      success: payload?.success,
      archive: payload?.archive,
      output: payload?.output,
      backupName: payload?.backup_name,
      sizeBytes: payload?.size_bytes,
    });
  }

  @SubscribeMessage('backup_list_response')
  handleBackupListResponse(
    @MessageBody()
    payload: {
      session_id?: string;
      backups?: Array<Record<string, unknown>>;
      node_id?: string;
      nodeId?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sessionId = String(payload?.session_id ?? '').trim();
    if (!sessionId) return;
    const nodeId = this.resolveNodeId(client, payload);
    this.terminalSessions.emit(sessionId, 'edge_backup_list', {
      sessionId,
      nodeId,
      backups: payload?.backups ?? [],
    });
  }

  @SubscribeMessage('backup_restore_response')
  handleBackupRestoreResponse(
    @MessageBody()
    payload: {
      session_id?: string;
      dry_run?: boolean;
      success?: boolean;
      output?: string;
      manifest?: Record<string, unknown> | null;
      node_id?: string;
      nodeId?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sessionId = String(payload?.session_id ?? '').trim();
    if (!sessionId) return;
    const nodeId = this.resolveNodeId(client, payload);
    this.terminalSessions.emit(sessionId, 'edge_backup_restore', {
      sessionId,
      nodeId,
      dryRun: payload?.dry_run,
      success: payload?.success,
      output: payload?.output,
      manifest: payload?.manifest ?? null,
    });
  }

  @SubscribeMessage('restore_complete_report')
  handleRestoreCompleteReport(
    @MessageBody()
    payload: {
      backup_name?: string;
      restored_at?: string;
      node_id?: string;
      nodeId?: string;
      tenant_id?: string;
      tenantId?: string;
      contents?: string[];
      session_id?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const nodeId = this.resolveNodeId(client, payload);
    const tenantId = this.resolveTenantId(client, payload) ?? '';
    const event = {
      nodeId,
      tenantId,
      backupName: payload?.backup_name,
      restoredAt: payload?.restored_at,
      contents: payload?.contents ?? [],
    };
    this.server.to('fleet:report').emit('edge_restore_complete', event);
    const sessionId = String(payload?.session_id ?? '').trim();
    if (sessionId) {
      this.terminalSessions.emit(sessionId, 'edge_restore_complete', {
        sessionId,
        ...event,
      });
    }
  }

  @SubscribeMessage('security_audit_report')
  async handleSecurityAuditReport(
    @MessageBody()
    payload: {
      session_id?: string;
      node_id?: string;
      nodeId?: string;
      tenant_id?: string;
      tenantId?: string;
      report?: string;
      summary?: { crit?: number; warn?: number; ok?: number };
      timestamp?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const nodeId = this.resolveNodeId(client, payload);
    const tenantId = this.resolveTenantId(client, payload) ?? '';
    const reportText = String(payload?.report ?? '').trim();
    const summary = payload?.summary ?? {};
    const stored = await this.securityAuditRepository.storeReport({
      node_id: nodeId,
      tenant_id: tenantId || undefined,
      report_text: reportText,
      crit_count: Number(summary.crit ?? 0),
      warn_count: Number(summary.warn ?? 0),
      ok_count: Number(summary.ok ?? 0),
      created_at: String(payload?.timestamp ?? new Date().toISOString()),
    });
    const event = {
      report_id: stored.id,
      node_id: nodeId,
      tenant_id: tenantId,
      report: stored.report_text,
      summary: {
        crit: stored.crit_count,
        warn: stored.warn_count,
        ok: stored.ok_count,
      },
      timestamp: stored.created_at,
    };
    this.server.to('fleet:report').emit('security_audit_report', event);
    const sessionId = String(payload?.session_id ?? '').trim();
    if (sessionId) {
      this.terminalSessions.emit(sessionId, 'edge_security_audit_report', {
        sessionId,
        ...event,
      });
    }
  }

  @SubscribeMessage('security_baseline_rebuild_response')
  handleSecurityBaselineRebuildResponse(
    @MessageBody()
    payload: {
      session_id?: string;
      baseline_type?: string;
      rebuilt?: Record<string, unknown>;
      success?: boolean;
      timestamp?: string;
      node_id?: string;
      nodeId?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sessionId = String(payload?.session_id ?? '').trim();
    if (!sessionId) return;
    const nodeId = this.resolveNodeId(client, payload);
    this.terminalSessions.emit(sessionId, 'edge_security_baseline_rebuild', {
      sessionId,
      nodeId,
      baselineType: payload?.baseline_type,
      rebuilt: payload?.rebuilt ?? {},
      success: payload?.success ?? false,
      timestamp: payload?.timestamp ?? new Date().toISOString(),
    });
  }

  @SubscribeMessage('edge_memory_sync_batch')
  async handleEdgeMemorySyncBatch(
    @MessageBody()
    payload: {
      node_id?: string;
      nodeId?: string;
      tenant_id?: string;
      tenantId?: string;
      items?: Array<Record<string, unknown>>;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const nodeId = this.resolveNodeId(client, payload);
    const tenantId = this.resolveTenantId(client, payload) ?? '';
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const now = new Date().toISOString();
    const key = `fleet:edge:memory_sync:${tenantId}:${nodeId}:${Date.now()}`;
    await this.redis
      .multi()
      .hset(
        key,
        'node_id',
        nodeId,
        'tenant_id',
        tenantId,
        'count',
        String(items.length),
        'created_at',
        now,
        'items_json',
        JSON.stringify(items),
      )
      .expire(key, TASK_TTL_SEC)
      .exec();
    this.server.to('fleet:report').emit('edge_memory_sync', {
      nodeId,
      tenantId,
      count: items.length,
      createdAt: now,
    });
    return { success: true, received: items.length };
  }

  @SubscribeMessage('tool_manifest')
  handleToolManifest(
    @MessageBody()
    payload: {
      node_id?: string;
      nodeId?: string;
      tenant_id?: string;
      tenantId?: string;
      tools?: Array<Record<string, unknown>>;
      timestamp?: string;
      session_id?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const nodeId = this.resolveNodeId(client, payload);
    const tenantId = this.resolveTenantId(client, payload) ?? '';
    const tools = Array.isArray(payload?.tools) ? payload.tools : [];
    const snapshot = {
      nodeId,
      tenantId,
      tools,
      updatedAt: String(payload?.timestamp ?? new Date().toISOString()),
    };
    this.edgeToolManifests.set(nodeId, snapshot);
    this.server.to('fleet:report').emit('edge_tool_manifest', snapshot);
    const sessionId = String(payload?.session_id ?? '').trim();
    if (sessionId) {
      this.terminalSessions.emit(sessionId, 'edge_tool_manifest', {
        sessionId,
        ...snapshot,
      });
    }
  }

  @SubscribeMessage('mcp_tool_result')
  handleMcpToolResult(
    @MessageBody()
    payload: {
      call_id?: string;
      callId?: string;
      tool?: string;
      result?: Record<string, unknown>;
      latency_ms?: number;
      node_id?: string;
      nodeId?: string;
      tenant_id?: string;
      tenantId?: string;
      timestamp?: string;
      session_id?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const callId = String(payload?.call_id ?? payload?.callId ?? '').trim();
    const nodeId = this.resolveNodeId(client, payload);
    const tenantId = this.resolveTenantId(client, payload) ?? '';
    const event = {
      callId,
      nodeId,
      tenantId,
      tool: payload?.tool,
      result: payload?.result ?? {},
      latencyMs: payload?.latency_ms ?? 0,
      timestamp: payload?.timestamp ?? new Date().toISOString(),
    };
    this.server.to('fleet:report').emit('edge_mcp_tool_result', event);
    const pending = callId ? this.pendingMcpToolCalls.get(callId) : undefined;
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingMcpToolCalls.delete(callId);
      pending.resolve(event);
    }
    const sessionId = String(payload?.session_id ?? '').trim();
    if (sessionId) {
      this.terminalSessions.emit(sessionId, 'edge_mcp_tool_result', {
        sessionId,
        ...event,
      });
    }
  }

  joinReportRoom(client: Socket) {
    client.join('fleet:report');
  }
}
