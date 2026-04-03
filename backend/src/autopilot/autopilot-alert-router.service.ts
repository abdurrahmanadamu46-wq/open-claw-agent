import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service';
import { emitStructuredLog } from '../common/structured-log';
import type { AutopilotAlertSeverity, AutopilotAlertSignal } from './autopilot-alert.service';

type AlertChannel = 'webhook' | 'feishu' | 'wecom';

@Injectable()
export class AutopilotAlertRouterService {
  private readonly logger = new Logger(AutopilotAlertRouterService.name);

  constructor(private readonly integrationsService: IntegrationsService) {}

  private parseRouteConfig(severity: AutopilotAlertSeverity): AlertChannel[] {
    const raw =
      process.env[`AUTOPILOT_ALERT_ROUTE_${severity}`] ??
      process.env.AUTOPILOT_ALERT_ROUTE_DEFAULT ??
      'webhook';
    const channels = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .filter((s): s is AlertChannel => s === 'webhook' || s === 'feishu' || s === 'wecom');
    return channels.length > 0 ? channels : ['webhook'];
  }

  private async resolveChannelUrl(tenantId: string, channel: AlertChannel): Promise<string | null> {
    const integrations = await this.integrationsService.getIntegrations(tenantId);
    const webhookUrl = integrations.webhook?.enabled ? integrations.webhook.leadCaptureUrl?.trim() : null;
    if (channel === 'webhook') {
      return webhookUrl || process.env.AUTOPILOT_ALERT_WEBHOOK_URL?.trim() || null;
    }
    if (channel === 'feishu') {
      return process.env.AUTOPILOT_ALERT_FEISHU_WEBHOOK_URL?.trim() || webhookUrl || null;
    }
    return process.env.AUTOPILOT_ALERT_WECOM_WEBHOOK_URL?.trim() || webhookUrl || null;
  }

  private async postJson(url: string, payload: unknown): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async routeSignal(input: {
    tenantId: string;
    signal: AutopilotAlertSignal;
    message: string;
  }): Promise<{ routed: string[]; failed: string[] }> {
    const channels = this.parseRouteConfig(input.signal.severity);
    const routed: string[] = [];
    const failed: string[] = [];

    for (const channel of channels) {
      try {
        const url = await this.resolveChannelUrl(input.tenantId, channel);
        if (!url) {
          failed.push(`${channel}:missing_url`);
          continue;
        }
        await this.postJson(url, {
          channel,
          tenantId: input.tenantId,
          severity: input.signal.severity,
          ruleKey: input.signal.ruleKey,
          state: input.signal.state,
          message: input.message,
          value: input.signal.value,
          threshold: input.signal.threshold,
          windowMinutes: input.signal.windowMinutes,
          sourceQueue: input.signal.sourceQueue,
          timestamp: new Date().toISOString(),
        });
        routed.push(channel);
      } catch (err) {
        failed.push(`${channel}:${err instanceof Error ? err.message : String(err)}`);
      }
    }

    emitStructuredLog(this.logger, failed.length > 0 ? 'warn' : 'log', {
      service: AutopilotAlertRouterService.name,
      eventType: 'alert.route.result',
      message: `alert routed severity=${input.signal.severity} rule=${input.signal.ruleKey}`,
      tenantId: input.tenantId,
      campaignId: input.signal.ruleKey,
      nodeId: 'cloud',
      taskId: `alert:${input.signal.ruleKey}`,
      severity: input.signal.severity,
      state: input.signal.state,
      routed,
      failed,
      sourceQueue: input.signal.sourceQueue,
    });

    return { routed, failed };
  }
}

