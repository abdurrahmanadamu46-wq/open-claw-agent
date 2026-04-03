import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  BaselineAgentManifest,
  BaselineRoleAgentBinding,
  RoleId,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultBaselineManifestPath = path.join(
  __dirname,
  '../../../packages/lobsters/baseline-agent-manifest.json',
);

let baselineManifestCache: {
  path: string | null;
  mtimeMs: number;
  manifest: BaselineAgentManifest | null;
} = {
  path: null,
  mtimeMs: 0,
  manifest: null,
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function resolveBaselineManifestPath(candidate?: string): string {
  if (candidate) {
    return path.resolve(candidate);
  }

  if (process.env.LOBSTERPOOL_BASELINE_AGENT_MANIFEST) {
    return path.resolve(process.env.LOBSTERPOOL_BASELINE_AGENT_MANIFEST);
  }

  return defaultBaselineManifestPath;
}

export function loadBaselineAgentManifest(options: {
  manifestPath?: string;
  forceReload?: boolean;
} = {}): BaselineAgentManifest | null {
  const resolvedPath = resolveBaselineManifestPath(options.manifestPath);

  if (!existsSync(resolvedPath)) {
    return null;
  }

  const stat = statSync(resolvedPath);
  const shouldReload =
    options.forceReload ||
    !baselineManifestCache.manifest ||
    baselineManifestCache.path !== resolvedPath ||
    baselineManifestCache.mtimeMs !== stat.mtimeMs;

  if (shouldReload) {
    baselineManifestCache = {
      path: resolvedPath,
      mtimeMs: stat.mtimeMs,
      manifest: readJson<BaselineAgentManifest>(resolvedPath),
    };
  }

  return baselineManifestCache.manifest;
}

export function getBaselineAgentManifestInfo(options: {
  manifestPath?: string;
  forceReload?: boolean;
} = {}): {
  path: string | null;
  mtimeMs: number;
  version: string | null;
  loaded: boolean;
} {
  const manifest = loadBaselineAgentManifest(options);

  return {
    path: baselineManifestCache.path,
    mtimeMs: baselineManifestCache.mtimeMs,
    version: manifest?.schemaVersion ?? null,
    loaded: Boolean(manifest),
  };
}

export function buildBaselineRoleBindings(
  roleIds: RoleId[],
  manifest: BaselineAgentManifest | null,
): BaselineRoleAgentBinding[] {
  if (!manifest) {
    return roleIds
      .filter((roleId) => roleId !== 'commander' && roleId !== 'feedback')
      .map((roleId) => ({
        roleId,
        packageName: null,
        primaryArtifact: null,
        baselineAgentId: `${roleId}-baseline-agent`,
        agentMode: 'specialist',
        starterSkills: [],
        defaultBridgeTarget: null,
        defaultScopeId: null,
        defaultMissionTypes: [],
        shadowStage: 'unknown',
        clawhubRequiredNow: false,
      }));
  }

  const roleMap = new Map(manifest.roles.map((role) => [role.roleId, role]));

  return roleIds
    .filter((roleId) => roleId !== 'commander' && roleId !== 'feedback')
    .map((roleId) => {
      const role = roleMap.get(roleId);

      return {
        roleId,
        packageName: role?.packageName ?? null,
        primaryArtifact: role?.primaryArtifact ?? null,
        baselineAgentId: role?.baselineAgentId ?? `${roleId}-baseline-agent`,
        agentMode: role?.agentMode ?? 'specialist',
        starterSkills: role?.starterSkills ?? [],
        defaultBridgeTarget: role?.defaultBridgeTarget ?? null,
        defaultScopeId: role?.defaultScopeId ?? null,
        defaultMissionTypes: role?.defaultMissionTypes ?? [],
        shadowStage: role?.shadowStage ?? 'unknown',
        clawhubRequiredNow: manifest.clawhub?.requiredNow ?? false,
      };
    });
}
