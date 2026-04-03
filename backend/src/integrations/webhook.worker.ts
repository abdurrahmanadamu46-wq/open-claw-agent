import { Processor, WorkerHost } from '@nestjs/bullmq';
import axios from 'axios';
import type { Job } from 'bullmq';
import { IntegrationsService } from './integrations.service';
import { WEBHOOK_DISPATCH_QUEUE } from './webhook-queue.const';
import type { WebhookJobData } from './webhook-dispatcher.service';

const REQUEST_TIMEOUT_MS = 15_000;

@Processor(WEBHOOK_DISPATCH_QUEUE)
export class WebhookWorker extends WorkerHost {
  constructor(private readonly integrationsService: IntegrationsService) {
    super();
  }

  async process(job: Job<WebhookJobData, void, string>): Promise<void> {
    const { payload } = job.data;
    const integrations = await this.integrationsService.getIntegrations(payload.tenantId);
    const webhook = integrations.webhook;
    const url = webhook?.enabled && webhook?.leadCaptureUrl?.trim() ? webhook.leadCaptureUrl.trim() : null;
    if (!url) {
      throw new Error('Webhook 未配置或未启用 (leadCaptureUrl)');
    }

    const res = await axios.post(url, payload, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Webhook HTTP ${res.status}: ${res.statusText}`);
    }
  }
}
