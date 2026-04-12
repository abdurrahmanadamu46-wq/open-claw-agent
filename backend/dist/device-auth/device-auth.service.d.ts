import { RedisService } from '@liaoliaots/nestjs-redis';
import { JwtService } from '@nestjs/jwt';
import { DeviceService } from '../device/device.service';
import { AgentCCGateway } from '../gateway/agent-cc.gateway';
export declare class DeviceAuthService {
    private readonly redisService;
    private readonly jwtService;
    private readonly deviceService;
    private readonly agentGateway;
    private readonly logger;
    constructor(redisService: RedisService, jwtService: JwtService, deviceService: DeviceService, agentGateway: AgentCCGateway);
    private get redis();
    createBindTicket(machineCode: string): Promise<{
        ticket_id: string;
        expires_in: number;
        ws_room: string;
    }>;
    confirmTicketAndBind(tenantId: string, ticketId: string): Promise<{
        success: boolean;
        message: string;
    }>;
}
