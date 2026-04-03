import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  RuntimeScopeDriftAlert,
  RuntimeScopeDriftAlertReport,
} from './types.js';
import type { ScopeRolloutTrendReport } from './scope-rollout-trend.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPolicyPath = path.join(__dirname, 'config', 'scope-drift-alert.policy.json');

interface ScopeDriftPolicyThresholds {
  staleAfterHours: number;
  alertOnFailedCountAtLeast: number;
  alertOnSimulatedCountAtLeast: number;
  requireHandledWithinQueuedScopes: boolean;
}

interface ScopeDriftAlertPolicy {
  version: string;
  name: string;
  defaultThresholds: ScopeDriftPolicyThresholds;
  severityRules: Record<string, RuntimeScopeDriftAlert['severity']>;
  scopeOverrides?: Record<string, Partial<ScopeDriftPolicyThresholds>>;
}

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

export function loadScopeDriftAlertPolicy(policyPath?: string): ScopeDriftAlertPolicy {
  const resolvedPath = policyPath ? path.resolve(policyPath) : defaultPolicyPath;
  if (!existsSync(resolvedPath)) {
    throw new Error(`Scope drift alert policy not found: ${resolvedPath}`);
  }

  return readJson<ScopeDriftAlertPolicy>(resolvedPath);
}

function buildScopeKey(roleId: string, scopeId: string): string {
  return `${roleId}::${scopeId}`;
}

function getThresholds(
  roleId: string,
  scopeId: string,
  policy: ScopeDriftAlertPolicy,
): ScopeDriftPolicyThresholds {
  return {
    ...policy.defaultThresholds,
    ...(policy.scopeOverrides?.[buildScopeKey(roleId, scopeId)] ?? {}),
  };
}

function hoursSince(isoTimestamp: string, now = new Date()): number {
  return (now.getTime() - new Date(isoTimestamp).getTime()) / (1000 * 60 * 60);
}

function createAlert(
  scope: ScopeRolloutTrendReport['scopes'][number],
  alertType: RuntimeScopeDriftAlert['alertType'],
  policy: ScopeDriftAlertPolicy,
  message: string,
): RuntimeScopeDriftAlert {
  return {
    roleId: scope.roleId,
    scopeId: scope.scopeId,
    severity: policy.severityRules[alertType] ?? 'medium',
    alertType,
    recommendedAction: scope.recommendedAction,
    message,
    latestResultStatus: scope.latestResultStatus,
    latestResultAt: scope.latestResultAt,
    queuedCount: scope.totalQueuedCount,
    handledCount: scope.totalHandledCount,
    failedCount: scope.totalFailedCount,
    simulatedCount: scope.totalSimulatedCount,
  };
}

export function buildScopeDriftAlertReport(
  trendReport: ScopeRolloutTrendReport,
  policy: ScopeDriftAlertPolicy,
  options: { now?: Date } = {},
): RuntimeScopeDriftAlertReport {
  const now = options.now ?? new Date();
  const alerts: RuntimeScopeDriftAlert[] = [];

  for (const scope of trendReport.scopes) {
    const thresholds = getThresholds(scope.roleId, scope.scopeId, policy);

    if (scope.recommendedAction === 'stay_shadow_only' && scope.totalQueuedCount > 0) {
      alerts.push(
        createAlert(
          scope,
          'policy_violation',
          policy,
          `Scope ${scope.roleId}.${scope.scopeId} queued ${scope.totalQueuedCount} time(s) despite stay_shadow_only recommendation.`,
        ),
      );
    }

    if (
      scope.totalQueuedCount > 0 &&
      thresholds.requireHandledWithinQueuedScopes &&
      scope.totalHandledCount === 0
    ) {
      alerts.push(
        createAlert(
          scope,
          'no_handled_yet',
          policy,
          `Scope ${scope.roleId}.${scope.scopeId} has queued activity but no handled results yet.`,
        ),
      );
    }

    if (scope.totalFailedCount >= thresholds.alertOnFailedCountAtLeast) {
      alerts.push(
        createAlert(
          scope,
          'failure_detected',
          policy,
          `Scope ${scope.roleId}.${scope.scopeId} has ${scope.totalFailedCount} failed result(s).`,
        ),
      );
    }

    if (
      scope.totalHandledCount === 0 &&
      scope.totalSimulatedCount >= thresholds.alertOnSimulatedCountAtLeast &&
      scope.totalQueuedCount > 0
    ) {
      alerts.push(
        createAlert(
          scope,
          'simulated_only_scope',
          policy,
          `Scope ${scope.roleId}.${scope.scopeId} is still producing simulated-only results.`,
        ),
      );
    }

    if (scope.latestResultAt) {
      const ageHours = hoursSince(scope.latestResultAt, now);
      if (ageHours >= thresholds.staleAfterHours) {
        alerts.push(
          createAlert(
            scope,
            'stale_scope',
            policy,
            `Scope ${scope.roleId}.${scope.scopeId} has no fresh result within ${thresholds.staleAfterHours} hour(s).`,
          ),
        );
      }
    }
  }

  return {
    alertVersion: 'lobster.scope-drift-alerts.v0.1',
    generatedAt: now.toISOString(),
    policyVersion: policy.version,
    sourceTrendVersion: trendReport.trendVersion,
    summary: {
      scopeCount: trendReport.scopes.length,
      alertCount: alerts.length,
      highCount: alerts.filter((alert) => alert.severity === 'high').length,
      mediumCount: alerts.filter((alert) => alert.severity === 'medium').length,
      lowCount: alerts.filter((alert) => alert.severity === 'low').length,
    },
    alerts,
  };
}
