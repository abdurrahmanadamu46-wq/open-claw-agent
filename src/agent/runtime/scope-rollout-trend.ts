import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoutingWeightPatch } from '../commander/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRoutingPatchPath = path.join(
  __dirname,
  '..',
  'commander',
  'config',
  'routing-weight.patch.json',
);
const defaultLimitedLiveProcessedDir = 'F:\\openclaw-agent\\run\\limited-live-dispatch-processed';
const defaultResultDirs = [
  'F:\\openclaw-agent\\run\\execute-campaign-results',
  'F:\\openclaw-agent\\run\\lead-ops-results',
];

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function listJsonFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  return readdirSync(dirPath)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dirPath, name));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function parseDispatchRole(dispatchId: string): string {
  const parts = dispatchId.split(':');
  return parts[3] ?? 'unknown-role';
}

function bucketHour(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  date.setMinutes(0, 0, 0);
  return date.toISOString();
}

function buildScopeKey(roleId: string, scopeId: string): string {
  return `${roleId}::${scopeId}`;
}

type ScopeSeed = {
  roleId: string;
  scopeId: string;
  recommendedAction: string;
  recommendedLiveWeight: number;
};

function loadRoutingPatch(patchPath?: string): RoutingWeightPatch | null {
  const resolved = patchPath ? path.resolve(patchPath) : defaultRoutingPatchPath;
  if (!existsSync(resolved)) {
    return null;
  }

  return readJson<RoutingWeightPatch>(resolved);
}

function seedScopes(patch: RoutingWeightPatch | null): Map<string, ScopeSeed> {
  const map = new Map<string, ScopeSeed>();

  for (const entry of patch?.entries ?? []) {
    for (const scope of entry.scopeHints ?? []) {
      map.set(buildScopeKey(entry.roleId, scope.scopeId), {
        roleId: entry.roleId,
        scopeId: scope.scopeId,
        recommendedAction: scope.recommendedAction,
        recommendedLiveWeight: scope.recommendedLiveWeight ?? 0,
      });
    }
  }

  return map;
}

export interface ScopeRolloutTrendBucket {
  bucketStart: string;
  queuedCount: number;
  handledCount: number;
  failedCount: number;
  simulatedCount: number;
}

export interface ScopeRolloutTrendScope {
  roleId: string;
  scopeId: string;
  recommendedAction: string;
  recommendedLiveWeight: number;
  totalQueuedCount: number;
  totalHandledCount: number;
  totalFailedCount: number;
  totalSimulatedCount: number;
  latestQueueAt: string | null;
  latestResultAt: string | null;
  latestResultStatus: string | null;
  latestResultNote: string | null;
  bridgeTargets: string[];
  buckets: ScopeRolloutTrendBucket[];
}

export interface ScopeRolloutTrendReport {
  trendVersion: string;
  generatedAt: string;
  routingPatchVersion: string | null;
  policyVersion: string | null;
  summary: {
    scopedEntryCount: number;
    queuedScopeCount: number;
    handledScopeCount: number;
    failedScopeCount: number;
    simulatedScopeCount: number;
  };
  scopes: ScopeRolloutTrendScope[];
}

type MutableScopeTrend = Omit<ScopeRolloutTrendScope, 'buckets'> & {
  bucketMap: Map<string, ScopeRolloutTrendBucket>;
};

function ensureScope(
  scopeMap: Map<string, MutableScopeTrend>,
  seed: ScopeSeed,
): MutableScopeTrend {
  const key = buildScopeKey(seed.roleId, seed.scopeId);
  const existing = scopeMap.get(key);
  if (existing) {
    return existing;
  }

  const created: MutableScopeTrend = {
    roleId: seed.roleId,
    scopeId: seed.scopeId,
    recommendedAction: seed.recommendedAction,
    recommendedLiveWeight: seed.recommendedLiveWeight,
    totalQueuedCount: 0,
    totalHandledCount: 0,
    totalFailedCount: 0,
    totalSimulatedCount: 0,
    latestQueueAt: null,
    latestResultAt: null,
    latestResultStatus: null,
    latestResultNote: null,
    bridgeTargets: [],
    bucketMap: new Map<string, ScopeRolloutTrendBucket>(),
  };
  scopeMap.set(key, created);
  return created;
}

function ensureBucket(
  scope: MutableScopeTrend,
  timestamp: string,
): ScopeRolloutTrendBucket {
  const bucketKey = bucketHour(timestamp);
  const existing = scope.bucketMap.get(bucketKey);
  if (existing) {
    return existing;
  }

  const bucket: ScopeRolloutTrendBucket = {
    bucketStart: bucketKey,
    queuedCount: 0,
    handledCount: 0,
    failedCount: 0,
    simulatedCount: 0,
  };
  scope.bucketMap.set(bucketKey, bucket);
  return bucket;
}

function applyQueuedEvents(
  scopeMap: Map<string, MutableScopeTrend>,
  seeds: Map<string, ScopeSeed>,
  processedDir: string,
): void {
  for (const filePath of listJsonFiles(processedDir)) {
    const envelope = readJson<Record<string, unknown>>(filePath);
    const dispatchId = String(envelope.dispatchId ?? '');
    const roleId = typeof envelope.ownerRole === 'string' ? envelope.ownerRole : parseDispatchRole(dispatchId);
    const scopeId = typeof envelope.scopeId === 'string' ? envelope.scopeId : null;
    const createdAt = typeof envelope.createdAt === 'string' ? envelope.createdAt : null;
    if (!scopeId || !createdAt) {
      continue;
    }

    const seed =
      seeds.get(buildScopeKey(roleId, scopeId)) ??
      ({
        roleId,
        scopeId,
        recommendedAction: 'stay_shadow_only',
        recommendedLiveWeight: 0,
      } satisfies ScopeSeed);
    const scope = ensureScope(scopeMap, seed);
    const bucket = ensureBucket(scope, createdAt);

    scope.totalQueuedCount += 1;
    scope.latestQueueAt =
      !scope.latestQueueAt || createdAt > scope.latestQueueAt ? createdAt : scope.latestQueueAt;
    bucket.queuedCount += 1;
  }
}

function applyResultSnapshots(
  scopeMap: Map<string, MutableScopeTrend>,
  seeds: Map<string, ScopeSeed>,
  resultDirs: string[],
): void {
  for (const dirPath of resultDirs) {
    for (const filePath of listJsonFiles(dirPath)) {
      const result = readJson<Record<string, unknown>>(filePath);
      const dispatchId = String(result.dispatchId ?? '');
      const roleId = parseDispatchRole(dispatchId);
      const scopeId = typeof result.scopeId === 'string' ? result.scopeId : null;
      const processedAt = typeof result.processedAt === 'string' ? result.processedAt : null;
      const status = String(result.status ?? 'simulated');
      if (!scopeId || !processedAt) {
        continue;
      }

      const seed =
        seeds.get(buildScopeKey(roleId, scopeId)) ??
        ({
          roleId,
          scopeId,
          recommendedAction: 'stay_shadow_only',
          recommendedLiveWeight: 0,
        } satisfies ScopeSeed);
      const scope = ensureScope(scopeMap, seed);
      const bucket = ensureBucket(scope, processedAt);

      if (status === 'handled') {
        scope.totalHandledCount += 1;
        bucket.handledCount += 1;
      } else if (status === 'failed') {
        scope.totalFailedCount += 1;
        bucket.failedCount += 1;
      } else {
        scope.totalSimulatedCount += 1;
        bucket.simulatedCount += 1;
      }

      scope.latestResultAt =
        !scope.latestResultAt || processedAt > scope.latestResultAt ? processedAt : scope.latestResultAt;
      scope.latestResultStatus =
        !scope.latestResultAt || processedAt >= scope.latestResultAt ? status : scope.latestResultStatus;
      scope.latestResultNote =
        !scope.latestResultAt || processedAt >= scope.latestResultAt
          ? typeof result.note === 'string'
            ? result.note
            : scope.latestResultNote
          : scope.latestResultNote;
      scope.bridgeTargets = unique([
        ...scope.bridgeTargets,
        typeof result.bridgeTarget === 'string' ? result.bridgeTarget : path.basename(dirPath),
      ]);
    }
  }
}

export function buildScopeRolloutTrendReport(options: {
  routingPatchPath?: string;
  limitedLiveProcessedDir?: string;
  resultDirs?: string[];
} = {}): ScopeRolloutTrendReport {
  const patch = loadRoutingPatch(options.routingPatchPath);
  const seeds = seedScopes(patch);
  const scopeMap = new Map<string, MutableScopeTrend>();

  for (const seed of seeds.values()) {
    ensureScope(scopeMap, seed);
  }

  applyQueuedEvents(scopeMap, seeds, options.limitedLiveProcessedDir ?? defaultLimitedLiveProcessedDir);
  applyResultSnapshots(scopeMap, seeds, options.resultDirs ?? defaultResultDirs);

  const scopes: ScopeRolloutTrendScope[] = [...scopeMap.values()]
    .map((scope) => ({
      roleId: scope.roleId,
      scopeId: scope.scopeId,
      recommendedAction: scope.recommendedAction,
      recommendedLiveWeight: scope.recommendedLiveWeight,
      totalQueuedCount: scope.totalQueuedCount,
      totalHandledCount: scope.totalHandledCount,
      totalFailedCount: scope.totalFailedCount,
      totalSimulatedCount: scope.totalSimulatedCount,
      latestQueueAt: scope.latestQueueAt,
      latestResultAt: scope.latestResultAt,
      latestResultStatus: scope.latestResultStatus,
      latestResultNote: scope.latestResultNote,
      bridgeTargets: scope.bridgeTargets,
      buckets: [...scope.bucketMap.values()].sort((left, right) =>
        left.bucketStart.localeCompare(right.bucketStart),
      ),
    }))
    .sort((left, right) =>
      buildScopeKey(left.roleId, left.scopeId).localeCompare(buildScopeKey(right.roleId, right.scopeId)),
    );

  return {
    trendVersion: 'lobster.scope-rollout-trend.v0.1',
    generatedAt: new Date().toISOString(),
    routingPatchVersion: patch?.schemaVersion ?? null,
    policyVersion: patch?.policyVersion ?? null,
    summary: {
      scopedEntryCount: scopes.length,
      queuedScopeCount: scopes.filter((scope) => scope.totalQueuedCount > 0).length,
      handledScopeCount: scopes.filter((scope) => scope.totalHandledCount > 0).length,
      failedScopeCount: scopes.filter((scope) => scope.totalFailedCount > 0).length,
      simulatedScopeCount: scopes.filter((scope) => scope.totalSimulatedCount > 0).length,
    },
    scopes,
  };
}
