import { OnGatewayInit } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
export declare class AgentCCGateway implements OnGatewayInit {
    private readonly logger;
    server: Server;
    afterInit(): void;
    handleAuthListen(client: Socket, payload: {
        ticket_id?: string;
    }): void;
    emitAuthSuccess(roomName: string, data: Record<string, unknown>): void;
}
