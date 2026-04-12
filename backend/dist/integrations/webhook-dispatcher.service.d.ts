import { Queue } from 'bullmq';
import { IntegrationsService } from './integrations.service';
import type { StandardLeadPayload } from '../interfaces/standard-lead-payload.interface';
export interface WebhookJobData {
    payload: StandardLeadPayload;
}
export declare class WebhookDispatcherService {
    private readonly integrationsService;
    private readonly webhookQueue;
    constructor(integrationsService: IntegrationsService, webhookQueue: Queue);
    getWebhookUrl(tenantId: string): Promise<string | null>;
    enqueueLead(payload: StandardLeadPayload): Promise<{
        ok: true;
        jobId: string;
    } | {
        ok: false;
        error: string;
    }>;
    fireWebhook(payload: StandardLeadPayload): Promise<{
        ok: boolean;
        jobId?: string;
        error?: string;
    }>;
    fireTestWebhook(tenantId: string): Promise<{
        ok: boolean;
        jobId?: string;
        error?: string;
    }>;
}
