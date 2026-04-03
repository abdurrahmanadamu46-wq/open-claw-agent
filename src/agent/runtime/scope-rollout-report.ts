import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoutingWeightPatch, RoutingScopeWeightHint } from '../commander/types.js';

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

export interface ScopeRolloutScopeEntry {
  roleId: string;
  scopeId: string;
  recommendedAction: string;
  recommendedLiveWeight: number;
  queuedCount: number;
  handledCount: number;
  failedCount: number;
  simulatedCount: number;
  latestProcessedAt: string | null;
  latestNote: string | null;
  bridgeTargets: string[];
  includedSignals: string[];
  positiveTruthWeight: number;
  negativeTruthWeight: number;
  netTruthWeight: number;
}

export interface ScopeRolloutReport {
  rolloutVersion: string;
  generatedAt: string;
  routingPatchVersion: string | null;
  policyVersion: string | null;
  summary: {
    scopedEntryCount: number;
    queuedEntryCount: number;
    activeEntryCount: number;
    handledEntryCount: number;
    failedEntryCount: number;
  };
  scopes: ScopeRolloutScopeEntry[];
}

function loadRoutingPatch(patchPath?: string): RoutingWeightPatch | null {
  const resolved = patchPath ? path.resolve(patchPath) : defaultRoutingPatchPath;
  if (!existsSync(resolved)) {
    return null;
  }

  return readJson<RoutingWeightPatch>(resolved);
}

function buildScopeKey(roleId: string, scopeId: string): string {
  return `${roleId}::${scopeId}`;
}

function seedScopeEntries(patch: RoutingWeightPatch | null): Map<string, ScopeRolloutScopeEntry> {
  const map = new Map<string, ScopeRolloutScopeEntry>();

  for (const entry of patch?.entries ?? []) {
    for (const hint of entry.scopeHints ?? []) {
      map.set(buildScopeKey(entry.roleId, hint.scopeId), {
        roleId: entry.roleId,
        scopeId: hint.scopeId,
        recommendedAction: hint.recommendedAction,
        recommendedLiveWeight: hint.recommendedLiveWeight ?? 0,
        queuedCount: 0,
        handledCount: 0,
        failedCount: 0,
        simulatedCount: 0,
        latestProcessedAt: null,
        latestNote: null,
        bridgeTargets: [],
        includedSignals: hint.includedSignals,
        positiveTruthWeight: hint.positiveTruthWeight,
        negativeTruthWeight: hint.negativeTruthWeight,
        netTruthWeight: hint.netTruthWeight,
      });
    }
  }

  return map;
}

function applyEnvelopeCounts(
  scopeMap: Map<string, ScopeRolloutScopeEntry>,
  processedDir: string,
): void {
  for (const filePath of listJsonFiles(processedDir)) {
    const envelope = readJson<Record<string, unknown>>(filePath);
    const dispatchId = String(envelope.dispatchId ?? '');
    const roleId = typeof envelope.ownerRole === 'string' ? envelope.ownerRole : parseDispatchRole(dispatchId);
    const scopeId = typeof envelope.scopeId === 'string' ? envelope.scopeId : null;
    if (!scopeId) {
      continue;
    }

    const entry = scopeMap.get(buildScopeKey(roleId, scopeId));
    if (!entry) {
      continue;
    }

    entry.queuedCount += 1;
    entry.latestProcessedAt =
      typeof envelope.createdAt === 'string' ? envelope.createdAt : entry.latestProcessedAt;
  }
}

function applyResultCounts(
  scopeMap: Map<string, ScopeRolloutScopeEntry>,
  resultDirs: string[],
): void {
  for (const dirPath of resultDirs) {
    for (const filePath of listJsonFiles(dirPath)) {
      const result = readJson<Record<string, unknown>>(filePath);
      const dispatchId = String(result.dispatchId ?? '');
      const roleId = parseDispatchRole(dispatchId);
      const scopeId = typeof result.scopeId === 'string' ? result.scopeId : null;
      if (!scopeId) {
        continue;
      }

      const entry = scopeMap.get(buildScopeKey(roleId, scopeId));
      if (!entry) {
        continue;
      }

      const status = String(result.status ?? 'simulated');
      if (status === 'handled') {
        entry.handledCount += 1;
      } else if (status === 'failed') {
        entry.failedCount += 1;
      } else {
        entry.simulatedCount += 1;
      }

      entry.latestProcessedAt =
        typeof result.processedAt === 'string' ? result.processedAt : entry.latestProcessedAt;
      entry.latestNote = typeof result.note === 'string' ? result.note : entry.latestNote;
      entry.bridgeTargets = unique([
        ...entry.bridgeTargets,
        typeof result.bridgeTarget === 'string' ? result.bridgeTarget : path.basename(dirPath),
      ]);
    }
  }
}

export function buildScopeRolloutReport(options: {
  routingPatchPath?: string;
  limitedLiveProcessedDir?: string;
  resultDirs?: string[];
} = {}): ScopeRolloutReport {
  const patch = loadRoutingPatch(options.routingPatchPath);
  const scopeMap = seedScopeEntries(patch);

  applyEnvelopeCounts(scopeMap, options.limitedLiveProcessedDir ?? defaultLimitedLiveProcessedDir);
  applyResultCounts(scopeMap, options.resultDirs ?? defaultResultDirs);

  const scopes = [...scopeMap.values()].sort((left, right) =>
    buildScopeKey(left.roleId, left.scopeId).localeCompare(buildScopeKey(right.roleId, right.scopeId)),
  );

  return {
    rolloutVersion: 'lobster.scope-rollout-report.v0.1',
    generatedAt: new Date().toISOString(),
    routingPatchVersion: patch?.schemaVersion ?? null,
    policyVersion: patch?.policyVersion ?? null,
    summary: {
      scopedEntryCount: scopes.length,
      queuedEntryCount: scopes.filter((scope) => scope.queuedCount > 0).length,
      activeEntryCount: scopes.filter((scope) => scope.handledCount + scope.failedCount + scope.simulatedCount > 0).length,
      handledEntryCount: scopes.filter((scope) => scope.handledCount > 0).length,
      failedEntryCount: scopes.filter((scope) => scope.failedCount > 0).length,
    },
    scopes,
  };
}
