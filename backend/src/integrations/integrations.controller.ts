import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IntegrationsService } from './integrations.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import type { TenantIntegrations } from './tenant-integrations.types';

@Controller('api/v1/tenant/integrations')
@UseGuards(JwtAuthGuard)
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly webhookDispatcher: WebhookDispatcherService,
  ) {}

  @Get()
  async getIntegrations(@Req() req: { user: { tenantId: string } }) {
    const data = await this.integrationsService.getIntegrations(req.user.tenantId);
    return { code: 0, data };
  }

  @Patch()
  async updateIntegrations(
    @Req() req: { user: { tenantId: string } },
    @Body() body: Partial<TenantIntegrations>,
  ) {
    const data = await this.integrationsService.updateIntegrations(req.user.tenantId, body);
    return { code: 0, data };
  }

  /**
   * 发送测试线索 — 将 Mock StandardLeadPayload 投入 webhook_dispatch_queue
   * Worker 异步推送，BullMQ 自动重试最多 3 次（指数退避）
   */
  @Post('webhook/test')
  async sendTestWebhook(@Req() req: { user: { tenantId: string } }) {
    const result = await this.webhookDispatcher.fireTestWebhook(req.user.tenantId);
    if (result.ok) {
      return { code: 0, message: '测试线索已加入推送队列', jobId: result.jobId };
    }
    return { code: 1, message: result.error ?? 'Webhook 未配置或入队失败' };
  }
}
