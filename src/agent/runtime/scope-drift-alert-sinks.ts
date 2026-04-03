import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  RuntimeScopeDriftAlert,
  RuntimeScopeDriftAlertDeliveryReport,
  RuntimeScopeDriftAlertSinkDecision,
  RuntimeScopeDriftAlertSinkReport,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPolicyPath = path.join(__dirname, 'config', 'scope-drift-alert-sinks.policy.json');

interface ScopeDriftAlertSinksPolicy {
  version: string;
  name: string;
  dashboardFeedDirectory: string;
  webhookOutboxDirectory: string;
  publishDashboardFeed: boolean;
  publishWebhookOutbox: boolean;
}

interface ScopeDriftAlertEnvelope {
  schemaVersion: string;
  deliveredAt: string;
  alert: RuntimeScopeDriftAlert;
}

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

export function loadScopeDriftAlertSinksPolicy(policyPath?: string): ScopeDriftAlertSinksPolicy {
  const resolved = policyPath ? path.resolve(policyPath) : defaultPolicyPath;
  if (!existsSync(resolved)) {
    throw new Error(`Scope drift alert sinks policy not found: ${resolved}`);
  }

  return readJson<ScopeDriftAlertSinksPolicy>(resolved);
}

function writeDashboardFeed(
  alert: RuntimeScopeDriftAlert,
  outputDirectory: string,
): string {
  mkdirSync(outputDirectory, { recursive: true });
  const filePath = path.join(
    outputDirectory,
    `${alert.roleId}__${alert.scopeId}__${alert.alertType}.json`,
  );

  writeFileSync(
    filePath,
    JSON.stringify(
      {
        schemaVersion: 'lobster.scope-drift-dashboard-feed.v0.1',
        generatedAt: new Date().toISOString(),
        title: `${alert.roleId}.${alert.scopeId}`,
        severity: alert.severity,
        alertType: alert.alertType,
        recommendedAction: alert.recommendedAction,
        message: alert.message,
        stats: {
          queuedCount: alert.queuedCount,
          handledCount: alert.handledCount,
          failedCount: alert.failedCount,
          simulatedCount: alert.simulatedCount,
        },
        latest: {
          resultStatus: alert.latestResultStatus,
          resultAt: alert.latestResultAt,
        },
      },
      null,
      2,
    ),
  );

  return filePath;
}

function writeWebhookOutbox(
  alert: RuntimeScopeDriftAlert,
  outputDirectory: string,
): string {
  mkdirSync(outputDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(
    outputDirectory,
    `${alert.roleId}__${alert.scopeId}__${alert.alertType}__${timestamp}.json`,
  );

  writeFileSync(
    filePath,
    JSON.stringify(
      {
        schemaVersion: 'lobster.scope-drift-webhook-outbox.v0.1',
        queuedAt: new Date().toISOString(),
        topic: 'scope_drift_alert',
        payload: alert,
      },
      null,
      2,
    ),
  );

  return filePath;
}

function loadDeliveredAlert(decision: RuntimeScopeDriftAlertDeliveryReport['decisions'][number]): RuntimeScopeDriftAlert | null {
  if (!decision.inboxPath || !existsSync(decision.inboxPath)) {
    return null;
  }

  const envelope = readJson<ScopeDriftAlertEnvelope>(decision.inboxPath);
  return envelope.alert;
}

export function publishScopeDriftAlertSinks(
  deliveryReport: RuntimeScopeDriftAlertDeliveryReport,
  policy: ScopeDriftAlertSinksPolicy,
): RuntimeScopeDriftAlertSinkReport {
  const decisions: RuntimeScopeDriftAlertSinkDecision[] = [];

  for (const deliveryDecision of deliveryReport.decisions) {
    if (deliveryDecision.action !== 'delivered') {
      continue;
    }

    const alert = loadDeliveredAlert(deliveryDecision);
    if (!alert) {
      continue;
    }

    if (policy.publishDashboardFeed) {
      const outputPath = writeDashboardFeed(alert, policy.dashboardFeedDirectory);
      decisions.push({
        alertKey: deliveryDecision.alertKey,
        roleId: alert.roleId,
        scopeId: alert.scopeId,
        sinkType: 'dashboard_feed',
        action: 'published',
        outputPath,
      });
    }

    if (policy.publishWebhookOutbox) {
      const outputPath = writeWebhookOutbox(alert, policy.webhookOutboxDirectory);
      decisions.push({
        alertKey: deliveryDecision.alertKey,
        roleId: alert.roleId,
        scopeId: alert.scopeId,
        sinkType: 'webhook_outbox',
        action: 'published',
        outputPath,
      });
    }
  }

  return {
    sinkVersion: 'lobster.scope-drift-alert-sinks.v0.1',
    generatedAt: new Date().toISOString(),
    policyVersion: policy.version,
    sourceDeliveryVersion: deliveryReport.deliveryVersion,
    summary: {
      deliveredAlertCount: deliveryReport.summary.deliveredCount,
      publishedCount: decisions.length,
      dashboardCount: decisions.filter((item) => item.sinkType === 'dashboard_feed').length,
      webhookOutboxCount: decisions.filter((item) => item.sinkType === 'webhook_outbox').length,
    },
    decisions,
  };
}
