import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { IntegrationsService } from './integrations.service';
import type { WebhookJobData } from './webhook-dispatcher.service';
export declare class WebhookWorker extends WorkerHost {
    private readonly integrationsService;
    constructor(integrationsService: IntegrationsService);
    process(job: Job<WebhookJobData, void, string>): Promise<void>;
}
