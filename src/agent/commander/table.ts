import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DecisionTable } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDecisionTablePath = path.join(__dirname, 'config', 'decision-table.json');
const defaultDecisionTableSchemaPath = path.join(
  __dirname,
  'config',
  'decision-table.schema.json',
);

let decisionTableCache: {
  path: string | null;
  mtimeMs: number;
  table: DecisionTable | null;
} = {
  path: null,
  mtimeMs: 0,
  table: null,
};

function resolveDecisionTablePath(candidate?: string): string {
  if (candidate) return path.resolve(candidate);
  if (process.env.LOBSTERPOOL_COMMANDER_TABLE) {
    return path.resolve(process.env.LOBSTERPOOL_COMMANDER_TABLE);
  }

  return defaultDecisionTablePath;
}

function validateDecisionTable(table: DecisionTable): void {
  const requiredTopLevelKeys = [
    'meta',
    'lineupCatalog',
    'missionProfiles',
    'riskPolicies',
    'stopLossProfiles',
    'arbitrationPriority',
    'overrideRules',
  ] as const;

  for (const key of requiredTopLevelKeys) {
    if (!table[key]) {
      throw new Error(`Decision table is missing required key: ${key}`);
    }
  }

  if (!table.meta.version) {
    throw new Error('Decision table meta.version is required.');
  }

  if (!Array.isArray(table.overrideRules)) {
    throw new Error('Decision table overrideRules must be an array.');
  }

  for (const [missionType, profile] of Object.entries(table.missionProfiles)) {
    for (const lineupId of profile.baseLineups ?? []) {
      if (!table.lineupCatalog[lineupId]) {
        throw new Error(
          `Mission profile ${missionType} references unknown lineup ${lineupId}.`,
        );
      }
    }

    if (!table.stopLossProfiles[profile.stopLossProfile]) {
      throw new Error(
        `Mission profile ${missionType} references unknown stop loss profile ${profile.stopLossProfile}.`,
      );
    }

    for (const stage of profile.stagePlan ?? []) {
      if (!table.lineupCatalog[stage.lineupId]) {
        throw new Error(
          `Mission profile ${missionType} stage ${stage.stageId} references unknown lineup ${stage.lineupId}.`,
        );
      }
    }
  }

  for (const rule of table.overrideRules) {
    if (!rule.id) {
      throw new Error('Every override rule must define an id.');
    }

    if (typeof rule.enabled !== 'boolean') {
      throw new Error(`Override rule ${rule.id} must define enabled as boolean.`);
    }

    if (!Number.isInteger(rule.priority) || rule.priority < 0) {
      throw new Error(
        `Override rule ${rule.id} must define a non-negative integer priority.`,
      );
    }

    if (typeof rule.weight !== 'number' || rule.weight < 0) {
      throw new Error(
        `Override rule ${rule.id} must define a non-negative numeric weight.`,
      );
    }

    if (rule.effects?.replaceStagesFromMission) {
      const missionId = rule.effects.replaceStagesFromMission;

      if (!table.missionProfiles[missionId]) {
        throw new Error(
          `Override rule ${rule.id} references unknown mission profile ${missionId}.`,
        );
      }
    }

    for (const stage of rule.effects?.prependStages ?? []) {
      if (!table.lineupCatalog[stage.lineupId]) {
        throw new Error(
          `Override rule ${rule.id} prepend stage ${stage.stageId} references unknown lineup ${stage.lineupId}.`,
        );
      }
    }

    for (const stage of rule.effects?.appendStages ?? []) {
      if (!table.lineupCatalog[stage.lineupId]) {
        throw new Error(
          `Override rule ${rule.id} append stage ${stage.stageId} references unknown lineup ${stage.lineupId}.`,
        );
      }
    }
  }
}

function readDecisionTable(filePath: string): DecisionTable {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as DecisionTable;
  validateDecisionTable(parsed);
  return parsed;
}

export function loadDecisionTable(options: { tablePath?: string; forceReload?: boolean } = {}): DecisionTable {
  const resolvedPath = resolveDecisionTablePath(options.tablePath);
  const stat = statSync(resolvedPath);
  const shouldReload =
    options.forceReload ||
    !decisionTableCache.table ||
    decisionTableCache.path !== resolvedPath ||
    decisionTableCache.mtimeMs !== stat.mtimeMs;

  if (shouldReload) {
    decisionTableCache = {
      path: resolvedPath,
      mtimeMs: stat.mtimeMs,
      table: readDecisionTable(resolvedPath),
    };
  }

  return decisionTableCache.table as DecisionTable;
}

export function getDecisionTableInfo(): {
  path: string;
  schemaPath: string;
  mtimeMs: number;
  version: string | null;
} {
  const table = loadDecisionTable();

  return {
    path: decisionTableCache.path as string,
    schemaPath: defaultDecisionTableSchemaPath,
    mtimeMs: decisionTableCache.mtimeMs,
    version: table.meta?.version ?? null,
  };
}

export function invalidateDecisionTableCache(): void {
  decisionTableCache = {
    path: null,
    mtimeMs: 0,
    table: null,
  };
}
