import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IntegrationsService } from './integrations.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import type { PluginAdapterConfig, TenantIntegrations } from './tenant-integrations.types';

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

  @Post('webhook/test')
  async sendTestWebhook(@Req() req: { user: { tenantId: string } }) {
    const result = await this.webhookDispatcher.fireTestWebhook(req.user.tenantId);
    if (result.ok) {
      return { code: 0, message: 'test payload enqueued', jobId: result.jobId };
    }
    return { code: 1, message: result.error ?? 'webhook not configured or enqueue failed' };
  }

  @Post('adapter/test')
  async testPluginAdapter(
    @Req() req: { user: { tenantId: string } },
    @Body() body: { adapter?: Partial<PluginAdapterConfig> },
  ) {
    const adapter = body?.adapter ?? {};
    const result = await this.integrationsService.testPluginAdapter(req.user.tenantId, adapter);
    if (result.ok) return { code: 0, data: result };
    return { code: 1, data: result, message: result.reason ?? 'adapter test failed' };
  }
}

