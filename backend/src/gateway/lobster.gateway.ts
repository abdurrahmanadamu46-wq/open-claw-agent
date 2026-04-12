import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/** 16 位激活码格式：CLAW-XXXX-XXXX-XXXX（4-4-4-4 字母数字），用于测试的合法码 */
const ACTIVATION_CODE_REGEX = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/;
const ALLOWED_CODES = new Set([
  'CLAW-1234-ABCD-5678',
  'CLAW-8A9B-XYZ1-9922',
  'CLAW-0000-0000-0001',
]);

@WebSocketGateway({
  path: '/lobster',
  cors: { origin: true },
  namespace: '/',
})
export class LobsterGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LobsterGateway.name);

  /** Socket ID -> Activation Code */
  private readonly socketToCode = new Map<string, string>();
  /** Activation Code -> Socket ID（同一激活码同一时刻只允许一个连接，顶号用） */
  private readonly codeToSocket = new Map<string, string>();

  @WebSocketServer()
  server!: Server;

  afterInit(server: Server) {
    server.use((socket: Socket, next) => {
      const code = (socket.handshake.auth?.activationCode ?? '').trim();
      if (!ACTIVATION_CODE_REGEX.test(code)) {
        this.logger.warn(`[Lobster] Reject connection: invalid format (len=${code.length})`);
        return next(new Error('INVALID_ACTIVATION_CODE'));
      }
      if (!ALLOWED_CODES.has(code.toUpperCase())) {
        this.logger.warn(`[Lobster] Reject connection: code not allowed`);
        return next(new Error('ACTIVATION_CODE_NOT_ALLOWED'));
      }
      next();
    });
    this.logger.log('LobsterGateway initialized at /lobster');
  }

  handleConnection(client: Socket) {
    const code = (client.handshake.auth?.activationCode ?? '').trim().toUpperCase();

    const existingSocketId = this.codeToSocket.get(code);
    if (existingSocketId && existingSocketId !== client.id) {
      const oldSocket = this.server.sockets.sockets.get(existingSocketId);
      if (oldSocket?.connected) {
        oldSocket.emit('server.kicked', { reason: 'SAME_CODE_LOGGED_IN_ELSEWHERE' });
        oldSocket.disconnect(true);
        this.logger.log(`[Lobster] Kicked previous socket ${existingSocketId} (顶号) for code ${code}`);
      }
      this.socketToCode.delete(existingSocketId);
      this.codeToSocket.delete(code);
    }

    this.socketToCode.set(client.id, code);
    this.codeToSocket.set(code, client.id);
    this.logger.log(`[Lobster] Client connected: socketId=${client.id}, activationCode=${code}`);
  }

  handleDisconnect(client: Socket) {
    const code = this.socketToCode.get(client.id);
    if (code && this.codeToSocket.get(code) === client.id) {
      this.codeToSocket.delete(code);
    }
    this.socketToCode.delete(client.id);
    this.logger.log(`[Lobster] Client disconnected: socketId=${client.id}, activationCode=${code ?? '—'}`);
  }

  /** 供其他 Service 使用：按激活码发消息 */
  emitToCode(activationCode: string, event: string, payload: unknown) {
    const socketId = this.codeToSocket.get(activationCode.toUpperCase());
    if (socketId) {
      this.server.to(socketId).emit(event, payload);
    }
  }

  getOnlineCodes(): string[] {
    return Array.from(this.codeToSocket.keys());
  }
}
