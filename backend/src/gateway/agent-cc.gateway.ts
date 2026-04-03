import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ensureSocketTrace, wsTracePrefix } from '../common/socket-trace.util';

/**
 * Agent C&C Gateway — 路径与 v1.24 蓝图一致：/agent-cc
 * 未鉴权连接允许接入，仅通过 client.auth.listen 进入 auth_room_* 等待 server.auth.success
 */
@WebSocketGateway({
  path: '/agent-cc',
  cors: { origin: true },
})
export class AgentCCGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AgentCCGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('AgentCCGateway initialized at /agent-cc');
  }

  handleConnection(client: Socket) {
    const trace = ensureSocketTrace(client);
    this.logger.log(`${wsTracePrefix(trace.traceId, trace.spanId)}[WS] AgentCC connected socketId=${client.id}`);
  }

  handleDisconnect(client: Socket) {
    const trace = ensureSocketTrace(client);
    this.logger.log(`${wsTracePrefix(trace.traceId, trace.spanId)}[WS] AgentCC disconnected socketId=${client.id}`);
  }

  /**
   * Tauri 拿到 ticket 后先发此事件，后端将其加入专属房间，confirm-bind 后向该房间 emit server.auth.success
   */
  @SubscribeMessage('client.auth.listen')
  handleAuthListen(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { ticket_id?: string; traceId?: string },
  ) {
    if (!payload?.ticket_id) return;
    const trace = ensureSocketTrace(client, payload.traceId);
    const roomName = `auth_room_${payload.ticket_id}`;
    client.join(roomName);
    this.logger.log(
      `${wsTracePrefix(trace.traceId, trace.spanId)}[WS] Client ${client.id} joined ${roomName} (waiting for scan)`,
    );
  }

  /** 供 DeviceAuthService 调用：定向推送 JWT，避免 Service 直接依赖 server 实例 */
  emitAuthSuccess(roomName: string, data: Record<string, unknown>) {
    const traceId = typeof data.traceId === 'string' ? data.traceId : undefined;
    this.logger.log(`${wsTracePrefix(traceId)}[WS] Emit server.auth.success room=${roomName}`);
    this.server.to(roomName).emit('server.auth.success', data);
  }
}
