import { IntegrationsService } from './integrations.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import type { TenantIntegrations } from './tenant-integrations.types';
export declare class IntegrationsController {
    private readonly integrationsService;
    private readonly webhookDispatcher;
    constructor(integrationsService: IntegrationsService, webhookDispatcher: WebhookDispatcherService);
    getIntegrations(req: {
        user: {
            tenantId: string;
        };
    }): Promise<{
        code: number;
        data: TenantIntegrations;
    }>;
    updateIntegrations(req: {
        user: {
            tenantId: string;
        };
    }, body: Partial<TenantIntegrations>): Promise<{
        code: number;
        data: TenantIntegrations;
    }>;
    sendTestWebhook(req: {
        user: {
            tenantId: string;
        };
    }): Promise<{
        code: number;
        message: string;
        jobId: string | undefined;
    } | {
        code: number;
        message: string;
        jobId?: undefined;
    }>;
}
