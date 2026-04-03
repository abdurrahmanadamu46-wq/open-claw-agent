import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
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
import { Server, Socket } from 'socket.io';
import { ensureSocketTrace, wsTracePrefix } from '../common/socket-trace.util';
import { FleetWebSocketGateway } from '../gateway/fleet-websocket.gateway';
import { TerminalSessionRegistry } from './terminal-session.registry';

const REDIS_NODE_PREFIX = 'fleet:node:';
const ALLOWED_COMMANDS = new Set(['status', 'ps', 'disk', 'mem', 'log', 'tasks']);

type TerminalUser = {
  tenantId: string;
  roles: string[];
  isAdmin: boolean;
  userId?: string;
};

@WebSocketGateway({
  namespace: '/edge-terminal',
  cors: { origin: true },
})
export class TerminalGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TerminalGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly fleetGateway: FleetWebSocketGateway,
    private readonly terminalSessions: TerminalSessionRegistry,
  ) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  afterInit() {
    this.logger.log('TerminalGateway initialized at /edge-terminal');
  }

  handleConnection(client: Socket) {
    const trace = ensureSocketTrace(client);
    const user = this.authorizeClient(client);
    if (!user) {
      this.logger.warn(`${wsTracePrefix(trace.traceId, trace.spanId)}[Terminal] Reject unauthorized socket=${client.id}`);
      client.emit('edge_terminal_error', { message: '未授权的终端连接' });
      client.disconnect(true);
      return;
    }
    client.data.user = user;
    this.logger.log(
      `${wsTracePrefix(trace.traceId, trace.spanId)}[Terminal] Client connected socketId=${client.id} tenant=${user.tenantId}`,
    );
  }

  async handleDisconnect(client: Socket) {
    const trace = ensureSocketTrace(client);
    const removed = this.terminalSessions.removeBySocketId(client.id);
    for (const session of removed) {
      this.fleetGateway.dispatchTerminalMessage(session.nodeId, {
        type: 'terminal_stop',
        session_id: session.sessionId,
      });
    }
    this.logger.log(
      `${wsTracePrefix(trace.traceId, trace.spanId)}[Terminal] Client disconnected socketId=${client.id} sessions=${removed.length}`,
    );
  }

  @SubscribeMessage('edge_terminal_start')
  async handleTerminalStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { nodeId?: string; sessionId?: string },
  ) {
    const user = this.resolveUser(client);
    const nodeId = String(data?.nodeId ?? '').trim();
    const sessionId = String(data?.sessionId ?? '').trim();
    if (!user || !nodeId || !sessionId) {
      client.emit('edge_terminal_error', { message: 'nodeId 和 sessionId 为必填项' });
      return;
    }

    const nodeMeta = await this.getNodeMeta(nodeId);
    if (!nodeMeta.exists) {
      client.emit('edge_terminal_error', { message: '边缘节点不存在' });
      return;
    }
    if (nodeMeta.tenantId && nodeMeta.tenantId !== user.tenantId && !user.isAdmin) {
      client.emit('edge_terminal_error', { message: '无权访问该边缘节点' });
      return;
    }
    if (nodeMeta.status === 'OFFLINE') {
      client.emit('edge_terminal_error', { message: '节点当前离线，无法建立调试终端' });
      return;
    }

    this.terminalSessions.register({
      sessionId,
      nodeId,
      tenantId: nodeMeta.tenantId || user.tenantId,
      socket: client,
      createdAt: new Date().toISOString(),
    });

    this.fleetGateway.dispatchTerminalMessage(nodeId, {
      type: 'terminal_start',
      session_id: sessionId,
    });
    this.terminalSessions.emitReady(sessionId, {
      sessionId,
      nodeId,
      status: nodeMeta.status || 'ONLINE',
      availableCommands: Array.from(ALLOWED_COMMANDS),
    });
  }

  @SubscribeMessage('edge_terminal_command')
  async handleTerminalCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId?: string; command?: string },
  ) {
    const user = this.resolveUser(client);
    const sessionId = String(data?.sessionId ?? '').trim();
    const command = String(data?.command ?? '').trim().toLowerCase();
    if (!user || !sessionId || !command) {
      client.emit('edge_terminal_error', { message: 'sessionId 和 command 为必填项' });
      return;
    }
    if (!ALLOWED_COMMANDS.has(command)) {
      client.emit('edge_terminal_error', {
        message: `命令 ${command} 不在白名单中，可用命令: ${Array.from(ALLOWED_COMMANDS).join(', ')}`,
      });
      return;
    }

    const session = this.terminalSessions.get(sessionId);
    if (!session || session.socket.id !== client.id) {
      client.emit('edge_terminal_error', { message: '终端会话不存在或已过期' });
      return;
    }
    if (session.tenantId !== user.tenantId && !user.isAdmin) {
      client.emit('edge_terminal_error', { message: '无权操作该终端会话' });
      return;
    }

    const dispatched = this.fleetGateway.dispatchTerminalMessage(session.nodeId, {
      type: 'terminal_command',
      session_id: sessionId,
      command,
    });
    if (!dispatched) {
      this.terminalSessions.emitError(sessionId, {
        message: '边缘节点不在线，命令未能下发',
      });
    }
  }

  @SubscribeMessage('edge_terminal_stop')
  async handleTerminalStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId?: string },
  ) {
    const user = this.resolveUser(client);
    const sessionId = String(data?.sessionId ?? '').trim();
    if (!user || !sessionId) {
      client.emit('edge_terminal_error', { message: 'sessionId 为必填项' });
      return;
    }
    const session = this.terminalSessions.get(sessionId);
    if (!session || session.socket.id !== client.id) {
      client.emit('edge_terminal_error', { message: '终端会话不存在或已过期' });
      return;
    }
    if (session.tenantId !== user.tenantId && !user.isAdmin) {
      client.emit('edge_terminal_error', { message: '无权关闭该终端会话' });
      return;
    }

    this.fleetGateway.dispatchTerminalMessage(session.nodeId, {
      type: 'terminal_stop',
      session_id: sessionId,
    });
    this.terminalSessions.remove(sessionId);
    client.emit('edge_terminal_closed', { sessionId });
  }

  @SubscribeMessage('edge_scheduler_status')
  async handleSchedulerStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId?: string },
  ) {
    const user = this.resolveUser(client);
    const sessionId = String(data?.sessionId ?? '').trim();
    if (!user || !sessionId) {
      client.emit('edge_terminal_error', { message: 'sessionId 为必填项' });
      return;
    }
    const session = this.terminalSessions.get(sessionId);
    if (!session || session.socket.id !== client.id) {
      client.emit('edge_terminal_error', { message: '终端会话不存在或已过期' });
      return;
    }
    if (session.tenantId !== user.tenantId && !user.isAdmin) {
      client.emit('edge_terminal_error', { message: '无权查看该节点调度状态' });
      return;
    }

    const dispatched = this.fleetGateway.dispatchTerminalMessage(session.nodeId, {
      type: 'scheduler_status_request',
      session_id: sessionId,
    });
    if (!dispatched) {
      this.terminalSessions.emitError(sessionId, {
        message: '边缘节点不在线，无法获取调度状态',
      });
    }
  }

  @SubscribeMessage('edge_scheduler_toggle')
  async handleSchedulerToggle(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId?: string; jobName?: string; enabled?: boolean },
  ) {
    const user = this.resolveUser(client);
    const sessionId = String(data?.sessionId ?? '').trim();
    const jobName = String(data?.jobName ?? '').trim();
    if (!user || !sessionId || !jobName) {
      client.emit('edge_terminal_error', { message: 'sessionId 和 jobName 为必填项' });
      return;
    }
    const session = this.terminalSessions.get(sessionId);
    if (!session || session.socket.id !== client.id) {
      client.emit('edge_terminal_error', { message: '终端会话不存在或已过期' });
      return;
    }
    if (session.tenantId !== user.tenantId && !user.isAdmin) {
      client.emit('edge_terminal_error', { message: '无权修改该节点调度配置' });
      return;
    }

    const dispatched = this.fleetGateway.dispatchTerminalMessage(session.nodeId, {
      type: 'scheduler_toggle_request',
      session_id: sessionId,
      job_name: jobName,
      enabled: data?.enabled !== false,
    });
    if (!dispatched) {
      this.terminalSessions.emitError(sessionId, {
        message: '边缘节点不在线，无法修改调度配置',
      });
    }
  }

  @SubscribeMessage('edge_backup_trigger')
  async handleBackupTrigger(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId?: string; outputDir?: string },
  ) {
    const user = this.resolveUser(client);
    const sessionId = String(data?.sessionId ?? '').trim();
    if (!user || !sessionId) {
      client.emit('edge_terminal_error', { message: 'sessionId 为必填项' });
      return;
    }
    const session = this.terminalSessions.get(sessionId);
    if (!session || session.socket.id !== client.id) {
      client.emit('edge_terminal_error', { message: '终端会话不存在或已过期' });
      return;
    }
    if (session.tenantId !== user.tenantId && !user.isAdmin) {
      client.emit('edge_terminal_error', { message: '无权触发该节点备份' });
      return;
    }

    const dispatched = this.fleetGateway.dispatchTerminalMessage(session.nodeId, {
      type: 'backup_trigger',
      session_id: sessionId,
      output_dir: data?.outputDir,
    });
    if (!dispatched) {
      this.terminalSessions.emitError(sessionId, {
        message: '边缘节点不在线，无法触发备份',
      });
    }
  }

  @SubscribeMessage('edge_backup_list')
  async handleBackupList(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId?: string; dir?: string },
  ) {
    const user = this.resolveUser(client);
    const sessionId = String(data?.sessionId ?? '').trim();
    if (!user || !sessionId) {
      client.emit('edge_terminal_error', { message: 'sessionId 为必填项' });
      return;
    }
    const session = this.terminalSessions.get(sessionId);
    if (!session || session.socket.id !== client.id) {
      client.emit('edge_terminal_error', { message: '终端会话不存在或已过期' });
      return;
    }
    if (session.tenantId !== user.tenantId && !user.isAdmin) {
      client.emit('edge_terminal_error', { message: '无权查看该节点备份列表' });
      return;
    }

    const dispatched = this.fleetGateway.dispatchTerminalMessage(session.nodeId, {
      type: 'backup_list',
      session_id: sessionId,
      dir: data?.dir,
    });
    if (!dispatched) {
      this.terminalSessions.emitError(sessionId, {
        message: '边缘节点不在线，无法获取备份列表',
      });
    }
  }

  @SubscribeMessage('edge_backup_restore')
  async handleBackupRestore(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId?: string; filename?: string; dryRun?: boolean },
  ) {
    const user = this.resolveUser(client);
    const sessionId = String(data?.sessionId ?? '').trim();
    const filename = String(data?.filename ?? '').trim();
    if (!user || !sessionId || !filename) {
      client.emit('edge_terminal_error', { message: 'sessionId 和 filename 为必填项' });
      return;
    }
    const session = this.terminalSessions.get(sessionId);
    if (!session || session.socket.id !== client.id) {
      client.emit('edge_terminal_error', { message: '终端会话不存在或已过期' });
      return;
    }
    if (session.tenantId !== user.tenantId && !user.isAdmin) {
      client.emit('edge_terminal_error', { message: '无权执行该节点还原' });
      return;
    }

    const dispatched = this.fleetGateway.dispatchTerminalMessage(session.nodeId, {
      type: 'backup_restore',
      session_id: sessionId,
      filename,
      dry_run: data?.dryRun !== false,
    });
    if (!dispatched) {
      this.terminalSessions.emitError(sessionId, {
        message: '边缘节点不在线，无法执行还原',
      });
    }
  }

  @SubscribeMessage('edge_security_audit_trigger')
  async handleSecurityAuditTrigger(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId?: string },
  ) {
    const user = this.resolveUser(client);
    const sessionId = String(data?.sessionId ?? '').trim();
    if (!user || !sessionId) {
      client.emit('edge_terminal_error', { message: 'sessionId 为必填项' });
      return;
    }
    const session = this.terminalSessions.get(sessionId);
    if (!session || session.socket.id !== client.id) {
      client.emit('edge_terminal_error', { message: '终端会话不存在或已过期' });
      return;
    }
    if (session.tenantId !== user.tenantId && !user.isAdmin) {
      client.emit('edge_terminal_error', { message: '无权触发该节点安全巡检' });
      return;
    }

    const dispatched = this.fleetGateway.dispatchControlMessage(session.nodeId, {
      type: 'security_audit_trigger',
      session_id: sessionId,
    });
    if (!dispatched) {
      this.terminalSessions.emitError(sessionId, {
        message: '边缘节点不在线，无法触发安全巡检',
      });
    }
  }

  @SubscribeMessage('edge_security_baseline_rebuild')
  async handleSecurityBaselineRebuild(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId?: string; baselineType?: 'credential' | 'sop' | 'all' },
  ) {
    const user = this.resolveUser(client);
    const sessionId = String(data?.sessionId ?? '').trim();
    if (!user || !sessionId) {
      client.emit('edge_terminal_error', { message: 'sessionId 为必填项' });
      return;
    }
    const session = this.terminalSessions.get(sessionId);
    if (!session || session.socket.id !== client.id) {
      client.emit('edge_terminal_error', { message: '终端会话不存在或已过期' });
      return;
    }
    if (session.tenantId !== user.tenantId && !user.isAdmin) {
      client.emit('edge_terminal_error', { message: '无权重建该节点安全基线' });
      return;
    }

    const dispatched = this.fleetGateway.dispatchControlMessage(session.nodeId, {
      type: 'security_baseline_rebuild',
      session_id: sessionId,
      baseline_type: data?.baselineType ?? 'all',
    });
    if (!dispatched) {
      this.terminalSessions.emitError(sessionId, {
        message: '边缘节点不在线，无法重建安全基线',
      });
    }
  }

  private authorizeClient(client: Socket): TerminalUser | null {
    const authToken = client.handshake.auth?.token ?? client.handshake.auth?.accessToken;
    const headerAuth = client.handshake.headers.authorization;
    const rawToken = typeof authToken === 'string'
      ? authToken
      : Array.isArray(headerAuth)
        ? headerAuth[0]
        : headerAuth;
    const token = typeof rawToken === 'string' && rawToken.startsWith('Bearer ')
      ? rawToken.slice(7)
      : typeof rawToken === 'string'
        ? rawToken
        : '';
    if (!token.trim()) {
      return null;
    }

    try {
      const payload = this.jwtService.verify<{
        tenantId?: string;
        sub?: string;
        role?: string;
        roles?: string[] | string;
      }>(token.trim());
      const roles = this.normalizeRoles(payload.role, payload.roles);
      return {
        tenantId: payload.tenantId ?? payload.sub ?? 'tenant-dev',
        roles,
        isAdmin: roles.some((role) => ['admin', 'tenant_admin', 'super_admin', 'ops_admin'].includes(role)),
        userId: payload.sub ?? payload.tenantId ?? 'user-dev',
      };
    } catch {
      return null;
    }
  }

  private resolveUser(client: Socket): TerminalUser | null {
    return (client.data?.user as TerminalUser | undefined) ?? this.authorizeClient(client);
  }

  private normalizeRoles(role?: string, roles?: string[] | string): string[] {
    const collected: string[] = [];
    if (typeof role === 'string' && role.trim()) {
      collected.push(role.trim());
    }
    if (Array.isArray(roles)) {
      for (const item of roles) {
        if (typeof item === 'string' && item.trim()) {
          collected.push(item.trim());
        }
      }
    } else if (typeof roles === 'string' && roles.trim()) {
      for (const item of roles.split(',')) {
        const normalized = item.trim();
        if (normalized) {
          collected.push(normalized);
        }
      }
    }
    return Array.from(new Set(collected.map((item) => item.toLowerCase())));
  }

  private async getNodeMeta(nodeId: string): Promise<{ exists: boolean; tenantId?: string; status?: string }> {
    const hash = await this.redis.hgetall(`${REDIS_NODE_PREFIX}${nodeId}`);
    if (!hash || Object.keys(hash).length === 0) {
      return { exists: false };
    }
    const tenantId = String(hash.tenant_id ?? '').trim() || undefined;
    const status = String(hash.status ?? '').trim() || undefined;
    return { exists: true, tenantId, status };
  }
}
