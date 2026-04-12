import { DeviceAuthService } from './device-auth.service';
import { AgentCCGateway } from '../gateway/agent-cc.gateway';
export declare class DeviceAuthController {
    private readonly deviceAuthService;
    private readonly agentGateway;
    constructor(deviceAuthService: DeviceAuthService, agentGateway: AgentCCGateway);
    requestBindTicket(body: {
        machine_code: string;
    }): Promise<{
        ticket_id: string;
        expires_in: number;
        ws_room: string;
    }>;
    confirmDeviceBind(req: {
        user: {
            tenantId: string;
        };
    }, body: {
        ticket_id: string;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
    testDispatch(): Promise<{
        ok: boolean;
        message: string;
        payload: {
            job_id: string;
            campaign_id: string;
            action: string;
            config: {
                test: boolean;
            };
        };
    }>;
}
