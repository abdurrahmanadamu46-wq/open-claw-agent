import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { IntegrationsService } from './integrations.service';
import { WEBHOOK_DISPATCH_QUEUE } from './webhook-queue.const';
import type { StandardLeadPayload } from '../interfaces/standard-lead-payload.interface';

/** 闃熷垪 Job 鏁版嵁缁撴瀯 */
export interface WebhookJobData {
  payload: StandardLeadPayload;
}

@Injectable()
export class WebhookDispatcherService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    @InjectQueue(WEBHOOK_DISPATCH_QUEUE) private readonly webhookQueue: Queue,
  ) {}

  /**
   * 鑾峰彇绉熸埛閰嶇疆鐨?Webhook URL锛坙eadCaptureUrl锛?
   * 鏈厤缃垨鏈惎鐢ㄦ椂杩斿洖 null
   */
  async getWebhookUrl(tenantId: string): Promise<string | null> {
    const integrations = await this.integrationsService.getIntegrations(tenantId);
    const webhook = integrations.webhook;
    if (!webhook?.enabled || !webhook.leadCaptureUrl?.trim()) return null;
    return webhook.leadCaptureUrl.trim();
  }

  /**
   * 灏嗙嚎绱㈡姇鍏ユ寔涔呭寲闃熷垪锛岀敱 WebhookWorker 寮傛鍙戦€?
   * - 鏈厤缃?URL 鏃剁洿鎺ヨ繑鍥炲け璐ワ紝涓嶅叆闃?
   * - BullMQ 鍘熺敓鎸囨暟閫€閬块噸璇曪紝鏈€澶?3 娆?
   */
  async enqueueLead(payload: StandardLeadPayload): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
    const url = await this.getWebhookUrl(payload.tenantId);
    if (!url) {
      return { ok: false, error: 'Webhook 鏈厤缃垨鏈惎鐢?(leadCaptureUrl)' };
    }

    const job = await this.webhookQueue.add(
      'dispatch',
      { payload } as WebhookJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
      },
    );
    return { ok: true, jobId: job.id ?? '' };
  }

  /**
   * 鍏煎鏃ц皟鐢細fireWebhook 鏀逛负鍏ラ槦锛岃繑鍥炶涔変笌鍘熷厛涓€鑷达紙ok + error锛?
   */
  async fireWebhook(payload: StandardLeadPayload): Promise<{ ok: boolean; jobId?: string; error?: string }> {
    const result = await this.enqueueLead(payload);
    if (result.ok) return { ok: true, jobId: result.jobId };
    return { ok: false, error: result.error };
  }

  /**
   * 鍙戦€佹祴璇曠嚎绱?鈥?鍚屾牱鍏ラ槦锛岀敱 Worker 鍙戦€?   */
  async fireTestWebhook(tenantId: string): Promise<{ ok: boolean; jobId?: string; error?: string }> {
    const payload: StandardLeadPayload = {
      eventId: uuidv4(),
      timestamp: new Date().toISOString(),
      tenantId,
      source: 'douyin',
      leadDetails: {
        username: '[娴嬭瘯] 灏忔槑',
        profileUrl: 'https://www.douyin.com/user/test-account',
        content: '杩欎釜鎬庝箞鍗栵紵',
        sourceVideoUrl: 'https://www.douyin.com/video/test-content',
      },
    };
    return this.fireWebhook(payload);
  }
}

