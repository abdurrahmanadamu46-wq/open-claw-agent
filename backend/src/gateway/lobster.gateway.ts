import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ActivationCodeService } from './activation-code.service';
import { ensureSocketTrace, wsTracePrefix } from '../common/socket-trace.util';

const ACTIVATION_CODE_REGEX = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/;
const SESSION_VALIDATION_INTERVAL_MS = 10_000;

@WebSocketGateway({
  path: '/lobster',
  cors: { origin: true },
  namespace: '/',
})
export class LobsterGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(LobsterGateway.name);
  private sessionValidationTimer: ReturnType<typeof setInterval> | null = null;

  /** Socket ID -> Activation Code */
  private readonly socketToCode = new Map<string, string>();
  /** Activation Code -> Socket ID */
  private readonly codeToSocket = new Map<string, string>();

  @WebSocketServer()
  server!: Server;

  constructor(private readonly activationCodeService: ActivationCodeService) {}

  afterInit(server: Server) {
    server.use((socket: Socket, next) => {
      void this.authorizeSocket(socket, next);
    });

    this.sessionValidationTimer = setInterval(() => {
      void this.enforceConnectedCodeValidity();
    }, SESSION_VALIDATION_INTERVAL_MS);

    this.logger.log('LobsterGateway initialized at /lobster');
  }

  handleConnection(client: Socket) {
    const trace = ensureSocketTrace(client);
    const code = this.activationCodeService.normalizeCode(client.handshake.auth?.activationCode ?? '');

    const existingSocketId = this.codeToSocket.get(code);
    if (existingSocketId && existingSocketId !== client.id) {
      const oldSocket = this.server.sockets.sockets.get(existingSocketId);
      if (oldSocket?.connected) {
        oldSocket.emit('server.kicked', { reason: 'SAME_CODE_LOGGED_IN_ELSEWHERE' });
        oldSocket.disconnect(true);
        this.logger.log(
          `${wsTracePrefix(trace.traceId, trace.spanId)}[Lobster] Kicked previous socket ${existingSocketId} for code ${code}`,
        );
      }
      this.socketToCode.delete(existingSocketId);
      this.codeToSocket.delete(code);
    }

    this.socketToCode.set(client.id, code);
    this.codeToSocket.set(code, client.id);
    this.logger.log(
      `${wsTracePrefix(trace.traceId, trace.spanId)}[Lobster] Client connected: socketId=${client.id}, activationCode=${code}`,
    );
  }

  handleDisconnect(client: Socket) {
    const trace = ensureSocketTrace(client);
    const code = this.socketToCode.get(client.id);
    if (code && this.codeToSocket.get(code) === client.id) {
      this.codeToSocket.delete(code);
    }
    this.socketToCode.delete(client.id);
    this.logger.log(
      `${wsTracePrefix(trace.traceId, trace.spanId)}[Lobster] Client disconnected: socketId=${client.id}, activationCode=${code ?? 'unknown'}`,
    );
  }

  onModuleDestroy() {
    if (this.sessionValidationTimer) {
      clearInterval(this.sessionValidationTimer);
      this.sessionValidationTimer = null;
    }
  }

  emitToCode(activationCode: string, event: string, payload: unknown) {
    const socketId = this.codeToSocket.get(this.activationCodeService.normalizeCode(activationCode));
    if (socketId) {
      this.server.to(socketId).emit(event, payload);
    }
  }

  getOnlineCodes(): string[] {
    return Array.from(this.codeToSocket.keys());
  }

  private async authorizeSocket(
    socket: Socket,
    next: (err?: Error) => void,
  ): Promise<void> {
    const code = this.activationCodeService.normalizeCode(socket.handshake.auth?.activationCode ?? '');
    const trace = ensureSocketTrace(socket);
    if (!ACTIVATION_CODE_REGEX.test(code)) {
      this.logger.warn(
        `${wsTracePrefix(trace.traceId, trace.spanId)}[Lobster] Reject connection: invalid format (len=${code.length})`,
      );
      next(new Error('INVALID_ACTIVATION_CODE'));
      return;
    }

    const validation = await this.activationCodeService.validateForConnection(code);
    if (!validation.ok) {
      this.logger.warn(
        `${wsTracePrefix(trace.traceId, trace.spanId)}[Lobster] Reject connection: ${validation.reason} code=${code}`,
      );
      next(new Error(validation.reason ?? 'ACTIVATION_CODE_NOT_ALLOWED'));
      return;
    }

    next();
  }

  private async enforceConnectedCodeValidity(): Promise<void> {
    for (const [code, socketId] of this.codeToSocket.entries()) {
      const validation = await this.activationCodeService.validateForConnection(code);
      if (validation.ok) continue;

      const client = this.server.sockets.sockets.get(socketId);
      const trace = client ? ensureSocketTrace(client) : undefined;
      if (!client?.connected) {
        this.codeToSocket.delete(code);
        this.socketToCode.delete(socketId);
        continue;
      }

      client.emit('server.kicked', { reason: validation.reason ?? 'ACTIVATION_CODE_NOT_ALLOWED' });
      client.disconnect(true);
      this.codeToSocket.delete(code);
      this.socketToCode.delete(socketId);
      this.logger.warn(
        `${wsTracePrefix(trace?.traceId, trace?.spanId)}[Lobster] Kicked socket ${socketId} due to activation code status: ${validation.reason ?? 'unknown'}`,
      );
    }
  }
}
