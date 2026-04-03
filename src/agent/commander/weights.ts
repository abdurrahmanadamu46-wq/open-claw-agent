import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  CommanderStagePriorityHint,
  CommanderRoleWeightHint,
  RoleId,
  RoutingScopeWeightHint,
  StagePlan,
  RoutingWeightPatch,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRoutingWeightPatchPath = path.join(
  __dirname,
  'config',
  'routing-weight.patch.json',
);

let routingWeightCache: {
  path: string | null;
  mtimeMs: number;
  patch: RoutingWeightPatch | null;
} = {
  path: null,
  mtimeMs: 0,
  patch: null,
};

function resolveRoutingWeightPatchPath(candidate?: string): string {
  if (candidate) {
    return path.resolve(candidate);
  }

  if (process.env.LOBSTERPOOL_ROUTING_WEIGHT_PATCH) {
    return path.resolve(process.env.LOBSTERPOOL_ROUTING_WEIGHT_PATCH);
  }

  return defaultRoutingWeightPatchPath;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function loadRoutingWeightPatch(options: {
  patchPath?: string;
  forceReload?: boolean;
} = {}): RoutingWeightPatch | null {
  const resolvedPath = resolveRoutingWeightPatchPath(options.patchPath);

  if (!existsSync(resolvedPath)) {
    return null;
  }

  const stat = statSync(resolvedPath);
  const shouldReload =
    options.forceReload ||
    !routingWeightCache.patch ||
    routingWeightCache.path !== resolvedPath ||
    routingWeightCache.mtimeMs !== stat.mtimeMs;

  if (shouldReload) {
    routingWeightCache = {
      path: resolvedPath,
      mtimeMs: stat.mtimeMs,
      patch: readJson<RoutingWeightPatch>(resolvedPath),
    };
  }

  return routingWeightCache.patch;
}

export function getRoutingWeightPatchInfo(options: {
  patchPath?: string;
  forceReload?: boolean;
} = {}): {
  path: string | null;
  mtimeMs: number;
  version: string | null;
  loaded: boolean;
} {
  const patch = loadRoutingWeightPatch(options);

  return {
    path: routingWeightCache.path,
    mtimeMs: routingWeightCache.mtimeMs,
    version: patch?.schemaVersion ?? null,
    loaded: Boolean(patch),
  };
}

export function buildRoleWeightHints(
  roleIds: RoleId[],
  patch: RoutingWeightPatch | null,
): CommanderRoleWeightHint[] {
  if (!patch) {
    return roleIds.map((roleId) => ({
      roleId,
      recommendedShadowWeight: 1,
      recommendedLiveWeight: 0,
      action: 'no_weight_patch',
      priorityTier: 'unknown',
    }));
  }

  const entryMap = new Map(patch.entries.map((entry) => [entry.roleId, entry]));

  return roleIds.map((roleId) => {
    const entry = entryMap.get(roleId);

    return {
      roleId,
      recommendedShadowWeight: entry?.recommendedShadowWeight ?? 1,
      recommendedLiveWeight: entry?.recommendedLiveWeight ?? 0,
      action: entry?.action ?? 'stay_shadow_only',
      priorityTier: entry?.priorityTier ?? 'unknown',
      scopeHints: entry?.scopeHints ?? [],
    };
  });
}

export function getRoutingScopeWeightHint(
  roleId: RoleId,
  scopeId: string | undefined,
  patch: RoutingWeightPatch | null,
): RoutingScopeWeightHint | null {
  if (!patch || !scopeId) {
    return null;
  }

  const entry = patch.entries.find((item) => item.roleId === roleId);
  if (!entry?.scopeHints?.length) {
    return null;
  }

  return entry.scopeHints.find((hint) => hint.scopeId === scopeId) ?? null;
}

function actionPriority(action: string): number {
  switch (action) {
    case 'promote_to_limited_live':
      return 400;
    case 'promote_with_guardrails':
      return 300;
    case 'stay_shadow_only':
      return 200;
    case 'no_weight_patch':
      return 150;
    case 'hold_and_review':
      return 50;
    default:
      return 100;
  }
}

export function scoreRoleWeightHint(hint: CommanderRoleWeightHint): number {
  const tierBonus = hint.priorityTier === 'T1' ? 10 : 0;

  return (
    actionPriority(hint.action) +
    hint.recommendedLiveWeight * 100 +
    hint.recommendedShadowWeight * 10 +
    tierBonus
  );
}

export function prioritizeActiveRoles(
  activeRoles: RoleId[],
  hints: CommanderRoleWeightHint[],
): RoleId[] {
  const hintMap = new Map(hints.map((hint) => [hint.roleId, hint]));
  const commanderRoles = activeRoles.filter((roleId) => roleId === 'commander');
  const feedbackRoles = activeRoles.filter((roleId) => roleId === 'feedback');
  const weightedRoles = activeRoles
    .filter((roleId) => roleId !== 'commander' && roleId !== 'feedback')
    .sort((left, right) => {
      const leftHint = hintMap.get(left);
      const rightHint = hintMap.get(right);
      const scoreDelta =
        (rightHint ? scoreRoleWeightHint(rightHint) : 0) -
        (leftHint ? scoreRoleWeightHint(leftHint) : 0);

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.localeCompare(right);
    });

  return [...commanderRoles, ...weightedRoles, ...feedbackRoles];
}

export function buildStagePriorityHints(
  stagePlan: StagePlan[],
  hints: CommanderRoleWeightHint[],
): CommanderStagePriorityHint[] {
  const hintMap = new Map(hints.map((hint) => [hint.roleId, hint]));

  return stagePlan.map((stage) => {
    const hint = hintMap.get(stage.ownerRole);

    return {
      stageId: stage.stageId,
      ownerRole: stage.ownerRole,
      executionPriority: hint ? scoreRoleWeightHint(hint) : 0,
      recommendedShadowWeight: hint?.recommendedShadowWeight ?? 1,
      recommendedLiveWeight: hint?.recommendedLiveWeight ?? 0,
      action: hint?.action ?? 'structural_stage',
    };
  });
}
