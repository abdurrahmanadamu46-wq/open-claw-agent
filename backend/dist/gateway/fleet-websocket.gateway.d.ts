import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { NodePingPayload, TaskProgressPayload, TaskCompletedPayload, LobsterTaskPayload } from './lobster-sop.types';
export declare class FleetWebSocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    private readonly redisService;
    private readonly logger;
    private readonly nodeToSocket;
    private readonly socketToNode;
    server: Server;
    constructor(redisService: RedisService);
    private get redis();
    afterInit(): void;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): Promise<void>;
    private setNodeStatus;
    handleNodePing(payload: NodePingPayload, client: Socket): Promise<void>;
    handleTaskProgress(payload: TaskProgressPayload): Promise<void>;
    handleTaskCompleted(payload: TaskCompletedPayload): Promise<void>;
    dispatchTask(nodeId: string, payload: LobsterTaskPayload): boolean;
    joinReportRoom(client: Socket): void;
}
