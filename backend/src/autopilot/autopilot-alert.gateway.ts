import { Logger } from '@nestjs/common';
import {
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

/**
 * Autopilot 紧急告警 — 熔断时向前端推送
 * 前端连接 path: /autopilot-alert，监听事件 autopilot.alert
 */
@WebSocketGateway({
  path: '/autopilot-alert',
  cors: { origin: true },
})
export class AutopilotAlertGateway implements OnGatewayInit {
  private readonly logger = new Logger(AutopilotAlertGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('AutopilotAlertGateway initialized at /autopilot-alert');
  }

  /**
   * 供 AutopilotCoordinatorService 调用：熔断时广播告警
   */
  emitAutopilotAlert(message: string, payload?: Record<string, unknown>) {
    try {
      this.server.emit('autopilot.alert', { message, ...payload });
      this.logger.warn(`[Autopilot] Alert emitted: ${message}`);
    } catch (e) {
      this.logger.error('[Autopilot] Failed to emit alert', e);
    }
  }
}
