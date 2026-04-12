import { OnGatewayInit } from '@nestjs/websockets';
import { Server } from 'socket.io';
export declare class AutopilotAlertGateway implements OnGatewayInit {
    private readonly logger;
    server: Server;
    afterInit(): void;
    emitAutopilotAlert(message: string, payload?: Record<string, unknown>): void;
}
