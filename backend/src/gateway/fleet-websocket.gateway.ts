import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import type {
  NodePingPayload,
  TaskProgressPayload,
  TaskCompletedPayload,
  LobsterTaskPayload,
} from './lobster-sop.types';

const REDIS_NODE_PREFIX = 'fleet:node:';
const REDIS_TASK_PREFIX = 'fleet:task:';
const NODE_TTL_SEC = 60;
const TASK_TTL_SEC = 86400 * 7;

/**
 * 舰队通讯网关 — 云边协同对讲机
 * - 心跳 (node_ping)：龙虾 → 云端，更新 Redis last_seen / status
 * - 任务下发 (execute_task)：云端 → 龙虾，携带 LobsterTaskPayload
 * - 战报回传 (task_progress / task_completed)：龙虾 → 云端，点亮总控进度条
 */
@WebSocketGateway({
  path: '/fleet',
  cors: { origin: true },
  namespace: '/',
})
export class FleetWebSocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(FleetWebSocketGateway.name);

  /** nodeId -> socketId（用于定向下发） */
  private readonly nodeToSocket = new Map<string, string>();
  /** socketId -> nodeId */
  private readonly socketToNode = new Map<string, string>();

  @WebSocketServer()
  server!: Server;

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  afterInit() {
    this.logger.log('FleetWebSocketGateway initialized at /fleet');
  }

  handleConnection(client: Socket) {
    const nodeId = (client.handshake.auth?.nodeId ?? client.handshake.query?.nodeId ?? '').trim();
    if (!nodeId) {
      this.logger.warn('[Fleet] Reject: missing nodeId');
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
    this.logger.log(`[Fleet] Node connected: nodeId=${nodeId}, socketId=${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const nodeId = this.socketToNode.get(client.id);
    if (nodeId) {
      this.nodeToSocket.delete(nodeId);
      this.socketToNode.delete(client.id);
      await this.setNodeStatus(nodeId, 'OFFLINE');
    }
    this.logger.log(`[Fleet] Node disconnected: socketId=${client.id}, nodeId=${nodeId ?? '—'}`);
  }

  private async setNodeStatus(nodeId: string, status: string) {
    const key = `${REDIS_NODE_PREFIX}${nodeId}`;
    const lastSeen = Date.now();
    await this.redis
    .multi()
    .hset(key, 'last_seen', String(lastSeen))
    .hset(key, 'status', status)
    .expire(key, NODE_TTL_SEC)
    .exec();
  }

  /** 心跳：龙虾每 10 秒上报，连续 3 次未收到则视为离线 */
  @SubscribeMessage('node_ping')
  async handleNodePing(
    @MessageBody() payload: NodePingPayload,
    @ConnectedSocket() client: Socket,
  ) {
    const nodeId = payload?.nodeId ?? this.socketToNode.get(client.id);
    if (!nodeId) return;

    const key = `${REDIS_NODE_PREFIX}${nodeId}`;
    const lastSeen = Date.now();
    await this.redis
      .multi()
      .hset(key, 'last_seen', String(lastSeen))
      .hset(key, 'status', payload.status ?? 'IDLE')
      .hset(key, 'current_task_id', payload.currentTaskId ?? '')
      .expire(key, NODE_TTL_SEC)
      .exec();

    this.server.to('fleet:report').emit('node_heartbeat', { nodeId, status: payload.status, lastSeen });
  }

  /** 任务进度：龙虾上报，写入 Redis 并广播给总控前端 */
  @SubscribeMessage('task_progress')
  async handleTaskProgress(
    @MessageBody() payload: TaskProgressPayload,
  ) {
    if (!payload?.taskId) return;
    const key = `${REDIS_TASK_PREFIX}${payload.taskId}`;
    const multi = this.redis.multi();
    multi.hset(key, 'progress', String(payload.progress));
    multi.hset(key, 'message', payload.message ?? '');
    multi.hset(key, 'step', payload.step ?? '');
    multi.hset(key, 'nodeId', payload.nodeId);
    multi.expire(key, TASK_TTL_SEC);
    await multi.exec();
    this.server.to('fleet:report').emit('task_progress', payload);
  }

  /** 任务完成：龙虾上报，写入 Redis 并广播 */
  @SubscribeMessage('task_completed')
  async handleTaskCompleted(
    @MessageBody() payload: TaskCompletedPayload,
  ) {
    if (!payload?.taskId) return;
    const key = `${REDIS_TASK_PREFIX}${payload.taskId}`;
    const multi = this.redis.multi();
    multi.hset(key, 'completed', '1');
    multi.hset(key, 'success', payload.success ? '1' : '0');
    multi.hset(key, 'error', payload.error ?? '');
    multi.hset(key, 'completedAt', payload.completedAt);
    multi.expire(key, TASK_TTL_SEC);
    await multi.exec();
    this.server.to('fleet:report').emit('task_completed', payload);
  }

  /**
   * 云端主业务调用：向指定 nodeId 下发 SOP 任务
   */
  dispatchTask(nodeId: string, payload: LobsterTaskPayload): boolean {
    const socketId = this.nodeToSocket.get(nodeId);
    if (!socketId) {
      this.logger.warn(`[Fleet] Dispatch failed: node not connected nodeId=${nodeId}`);
      return false;
    }
    this.server.to(socketId).emit('execute_task', payload);
    this.logger.log(`[Fleet] Dispatched taskId=${payload.taskId} to nodeId=${nodeId}`);
    return true;
  }

  /** 总控前端连接后加入 fleet:report，即可收到心跳/进度/完成事件 */
  joinReportRoom(client: Socket) {
    client.join('fleet:report');
  }
}
