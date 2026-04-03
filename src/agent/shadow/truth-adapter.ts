import { existsSync, readFileSync } from 'node:fs';

import type {
  ShadowTruthAttachment,
  ShadowTruthBundle,
  ShadowTruthRecord,
} from './types.js';

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function increment(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

export function loadShadowTruthBundle(filePath?: string): ShadowTruthBundle | null {
  if (!filePath) {
    return null;
  }

  if (!existsSync(filePath)) {
    throw new Error(`Shadow truth bundle not found: ${filePath}`);
  }

  const bundle = readJson<ShadowTruthBundle>(filePath);

  if (!Array.isArray(bundle.records)) {
    throw new Error('Shadow truth bundle must contain a records array.');
  }

  return bundle;
}

export function attachTruthToMission(
  missionId: string,
  activeRoleIds: string[],
  bundle: ShadowTruthBundle | null,
): ShadowTruthAttachment | null {
  if (!bundle) {
    return null;
  }

  const missionRecords = bundle.records.filter((record) => record.missionId === missionId);

  if (!missionRecords.length) {
    return null;
  }

  const sourceBreakdown: Record<string, number> = {};
  const relevantRoleIds = new Set<string>();
  const relevantScopeIds = new Set<string>();
  const signals = new Set<string>();

  for (const record of missionRecords) {
    increment(sourceBreakdown, record.sourceType);
    signals.add(record.signal);

    if (record.roleId && activeRoleIds.includes(record.roleId)) {
      relevantRoleIds.add(record.roleId);
      if (record.scopeId) {
        relevantScopeIds.add(record.scopeId);
      }
    }
  }

  return {
    recordCount: missionRecords.length,
    sourceBreakdown,
    relevantRoleIds: [...relevantRoleIds],
    relevantScopeIds: [...relevantScopeIds],
    signals: [...signals],
    records: missionRecords,
  };
}

export function summarizeTruthBundle(
  bundle: ShadowTruthBundle | null,
): { loaded: boolean; recordCount: number } {
  if (!bundle) {
    return {
      loaded: false,
      recordCount: 0,
    };
  }

  return {
    loaded: true,
    recordCount: bundle.records.length,
  };
}
