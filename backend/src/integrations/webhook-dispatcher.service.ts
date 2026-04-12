import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { IntegrationsService } from './integrations.service';
import { WEBHOOK_DISPATCH_QUEUE } from './webhook-queue.const';
import type { StandardLeadPayload } from '../interfaces/standard-lead-payload.interface';

/** 队列 Job 数据结构 */
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
   * 获取租户配置的 Webhook URL（leadCaptureUrl）
   * 未配置或未启用时返回 null
   */
  async getWebhookUrl(tenantId: string): Promise<string | null> {
    const integrations = await this.integrationsService.getIntegrations(tenantId);
    const webhook = integrations.webhook;
    if (!webhook?.enabled || !webhook.leadCaptureUrl?.trim()) return null;
    return webhook.leadCaptureUrl.trim();
  }

  /**
   * 将线索投入持久化队列，由 WebhookWorker 异步发送
   * - 未配置 URL 时直接返回失败，不入队
   * - BullMQ 原生指数退避重试，最多 3 次
   */
  async enqueueLead(payload: StandardLeadPayload): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
    const url = await this.getWebhookUrl(payload.tenantId);
    if (!url) {
      return { ok: false, error: 'Webhook 未配置或未启用 (leadCaptureUrl)' };
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
   * 兼容旧调用：fireWebhook 改为入队，返回语义与原先一致（ok + error）
   */
  async fireWebhook(payload: StandardLeadPayload): Promise<{ ok: boolean; jobId?: string; error?: string }> {
    const result = await this.enqueueLead(payload);
    if (result.ok) return { ok: true, jobId: result.jobId };
    return { ok: false, error: result.error };
  }

  /**
   * 发送测试用 Mock 线索 — 同样入队，由 Worker 发送
   */
  async fireTestWebhook(tenantId: string): Promise<{ ok: boolean; jobId?: string; error?: string }> {
    const payload: StandardLeadPayload = {
      eventId: uuidv4(),
      timestamp: new Date().toISOString(),
      tenantId,
      source: 'douyin',
      leadDetails: {
        username: '[测试] 小明',
        profileUrl: 'https://example.com/profile/test',
        content: '这个怎么卖？',
        sourceVideoUrl: 'https://example.com/video/123',
      },
    };
    return this.fireWebhook(payload);
  }
}
