import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  RuntimeScopeDriftAlert,
  RuntimeScopeDriftAlertDeliveryDecision,
  RuntimeScopeDriftAlertDeliveryReport,
  RuntimeScopeDriftAlertReport,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPolicyPath = path.join(__dirname, 'config', 'scope-drift-alert-delivery.policy.json');

interface ScopeDriftAlertDeliveryPolicy {
  version: string;
  name: string;
  inboxDirectory: string;
  statePath: string;
  deliverSeverities: RuntimeScopeDriftAlert['severity'][];
}

interface ScopeDriftAlertDeliveryState {
  entries: Record<string, string>;
}

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

export function loadScopeDriftAlertDeliveryPolicy(policyPath?: string): ScopeDriftAlertDeliveryPolicy {
  const resolved = policyPath ? path.resolve(policyPath) : defaultPolicyPath;
  if (!existsSync(resolved)) {
    throw new Error(`Scope drift alert delivery policy not found: ${resolved}`);
  }

  return readJson<ScopeDriftAlertDeliveryPolicy>(resolved);
}

function loadDeliveryState(statePath: string): ScopeDriftAlertDeliveryState {
  if (!existsSync(statePath)) {
    return { entries: {} };
  }

  return readJson<ScopeDriftAlertDeliveryState>(statePath);
}

function saveDeliveryState(statePath: string, state: ScopeDriftAlertDeliveryState): void {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function buildAlertKey(alert: RuntimeScopeDriftAlert): string {
  return `${alert.roleId}::${alert.scopeId}::${alert.alertType}`;
}

function buildFingerprint(alert: RuntimeScopeDriftAlert): string {
  return JSON.stringify({
    severity: alert.severity,
    message: alert.message,
    latestResultStatus: alert.latestResultStatus,
    latestResultAt: alert.latestResultAt,
    queuedCount: alert.queuedCount,
    handledCount: alert.handledCount,
    failedCount: alert.failedCount,
    simulatedCount: alert.simulatedCount,
  });
}

function writeInboxAlert(
  alert: RuntimeScopeDriftAlert,
  inboxDirectory: string,
): string {
  mkdirSync(inboxDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${alert.roleId}__${alert.scopeId}__${alert.alertType}__${timestamp}.json`;
  const inboxPath = path.join(inboxDirectory, fileName);

  writeFileSync(
    inboxPath,
    JSON.stringify(
      {
        schemaVersion: 'lobster.scope-drift-alert-envelope.v0.1',
        deliveredAt: new Date().toISOString(),
        alert,
      },
      null,
      2,
    ),
  );

  return inboxPath;
}

export function deliverScopeDriftAlerts(
  alertReport: RuntimeScopeDriftAlertReport,
  policy: ScopeDriftAlertDeliveryPolicy,
  options: { force?: boolean } = {},
): RuntimeScopeDriftAlertDeliveryReport {
  const state = loadDeliveryState(policy.statePath);
  const decisions: RuntimeScopeDriftAlertDeliveryDecision[] = [];

  for (const alert of alertReport.alerts) {
    if (!policy.deliverSeverities.includes(alert.severity)) {
      continue;
    }

    const alertKey = buildAlertKey(alert);
    const fingerprint = buildFingerprint(alert);
    const previousFingerprint = state.entries[alertKey];

    if (!options.force && previousFingerprint === fingerprint) {
      decisions.push({
        alertKey,
        roleId: alert.roleId,
        scopeId: alert.scopeId,
        alertType: alert.alertType,
        severity: alert.severity,
        action: 'skipped_duplicate',
        fingerprint,
      });
      continue;
    }

    const inboxPath = writeInboxAlert(alert, policy.inboxDirectory);
    state.entries[alertKey] = fingerprint;

    decisions.push({
      alertKey,
      roleId: alert.roleId,
      scopeId: alert.scopeId,
      alertType: alert.alertType,
      severity: alert.severity,
      action: 'delivered',
      inboxPath,
      fingerprint,
    });
  }

  saveDeliveryState(policy.statePath, state);

  return {
    deliveryVersion: 'lobster.scope-drift-alert-delivery.v0.1',
    generatedAt: new Date().toISOString(),
    policyVersion: policy.version,
    sourceAlertVersion: alertReport.alertVersion,
    summary: {
      alertCount: alertReport.alerts.length,
      deliveredCount: decisions.filter((item) => item.action === 'delivered').length,
      duplicateCount: decisions.filter((item) => item.action === 'skipped_duplicate').length,
    },
    decisions,
  };
}
