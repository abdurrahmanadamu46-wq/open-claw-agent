import {
  resolveCommanderDecision,
  simulationMissionBatch,
  type DecisionContext,
} from '../commander/index.js';
import {
  loadLobsterRegistry,
  loadLobsterRoleCard,
  loadLobsterSampleArtifact,
  resolvePackageAbsolutePath,
} from './registry.js';
import {
  attachTruthToMission,
  summarizeTruthBundle,
} from './truth-adapter.js';
import type {
  LobsterRegistryEntry,
  ShadowMissionResult,
  ShadowRoleAssignment,
  ShadowRunReport,
  ShadowTruthBundle,
} from './types.js';

function increment(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function buildRoleAssignment(entry: LobsterRegistryEntry): ShadowRoleAssignment {
  const roleCard = loadLobsterRoleCard(entry);
  const sampleArtifactPreview = loadLobsterSampleArtifact(entry);

  return {
    roleId: entry.roleId,
    packageName: entry.packageName,
    trainingStage: entry.trainingStage,
    priorityTier: entry.priorityTier,
    artifactType: entry.primaryArtifact,
    packagePath: resolvePackageAbsolutePath(entry),
    sampleArtifactPreview,
    notes: [
      `Mission: ${roleCard.mission}`,
      `Next milestone: ${entry.nextMilestone}`,
    ],
  };
}

export function runShadowMissions(options: {
  missions?: DecisionContext[];
  onlyShadowReady?: boolean;
  truthBundle?: ShadowTruthBundle | null;
} = {}): ShadowRunReport {
  const missions = options.missions ?? simulationMissionBatch;
  const onlyShadowReady = options.onlyShadowReady ?? true;
  const truthBundle = options.truthBundle ?? null;
  const registry = loadLobsterRegistry();
  const registryByRole = new Map<string, LobsterRegistryEntry>(
    registry.map((entry) => [entry.roleId, entry]),
  );

  const missionTypeBreakdown: Record<string, number> = {};
  const roleUsage: Record<string, number> = {};
  let blockedRoleCount = 0;
  let runnableRoleCount = 0;
  let missionsWithTruthCount = 0;

  const missionResults: ShadowMissionResult[] = missions.map((mission) => {
    increment(missionTypeBreakdown, mission.missionType);

    const decision = resolveCommanderDecision(mission);
    const selectedShadowRoles: ShadowRoleAssignment[] = [];
    const blockedRoles: Array<{ roleId: string; reason: string }> = [];

    for (const roleId of decision.activeRoles) {
      if (roleId === 'commander' || roleId === 'feedback') {
        continue;
      }

      const entry = registryByRole.get(roleId);

      if (!entry) {
        blockedRoles.push({ roleId, reason: 'missing_lobster_subproject' });
        blockedRoleCount += 1;
        continue;
      }

      if (onlyShadowReady && entry.trainingStage !== 'shadow-ready') {
        blockedRoles.push({
          roleId,
          reason: `training_stage_${entry.trainingStage}`,
        });
        blockedRoleCount += 1;
        continue;
      }

      selectedShadowRoles.push(buildRoleAssignment(entry));
      increment(roleUsage, roleId);
      runnableRoleCount += 1;
    }

    const truthAttachment = attachTruthToMission(
      mission.missionId,
      selectedShadowRoles.map((item) => item.roleId),
      truthBundle,
    );

    if (truthAttachment) {
      missionsWithTruthCount += 1;
    }

    return {
      missionId: mission.missionId,
      missionType: mission.missionType,
      decision,
      selectedShadowRoles,
      blockedRoles,
      truthAttachment,
    };
  });

  const truthSummary = summarizeTruthBundle(truthBundle);

  return {
    shadowVersion: 'lobster.shadow-runner.v0.1',
    generatedAt: new Date().toISOString(),
    missionCount: missionResults.length,
    onlyShadowReady,
    truthBundleLoaded: truthSummary.loaded,
    summary: {
      missionTypeBreakdown,
      roleUsage,
      blockedRoleCount,
      runnableRoleCount,
      truthRecordCount: truthSummary.recordCount,
      missionsWithTruthCount,
    },
    missions: missionResults,
  };
}
