import {
  buildRoleWeightHints,
  getRoutingScopeWeightHint,
  loadRoutingWeightPatch,
} from '../commander/weights.js';
import type { RoleId } from '../commander/types.js';
import type { ShadowRunReport } from '../shadow/types.js';
import type { RuntimeQueuePlan, RuntimeQueuedStage } from './types.js';

function scoreRoleHint(hint: {
  recommendedShadowWeight: number;
  recommendedLiveWeight: number;
  action: string;
  priorityTier: string;
}): number {
  const actionScore =
    hint.action === 'promote_to_limited_live'
      ? 400
      : hint.action === 'promote_with_guardrails'
        ? 300
        : hint.action === 'stay_shadow_only' || hint.action === 'no_weight_patch'
          ? 200
          : 0;

  const tierBonus = hint.priorityTier === 'T1' ? 10 : 0;

  return (
    actionScore +
    hint.recommendedLiveWeight * 100 +
    hint.recommendedShadowWeight * 10 +
    tierBonus
  );
}

function increment(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function laneForAction(action: string): RuntimeQueuedStage['queueLane'] {
  switch (action) {
    case 'promote_to_limited_live':
      return 'live_priority';
    case 'promote_with_guardrails':
      return 'guardrailed_live';
    case 'stay_shadow_only':
    case 'no_weight_patch':
      return 'shadow_only';
    default:
      return 'structural';
  }
}

function deriveStageScopeId(
  mission: ShadowRunReport['missions'][number],
  stage: ShadowRunReport['missions'][number]['decision']['stagePlan'][number],
): string | undefined {
  if (stage.ownerRole !== 'dispatcher') {
    return undefined;
  }

  if (
    mission.missionType === 'content_production' &&
    ['execute'].includes(stage.stageId)
  ) {
    return 'internal_execute';
  }

  if (
    mission.missionType === 'recovery_replay' &&
    ['diagnose', 'repair', 'execute'].includes(stage.stageId)
  ) {
    return 'internal_execute';
  }

  if (stage.stageId === 'close' && mission.missionType === 'content_production') {
    return 'external_publish';
  }

  return undefined;
}

function laneScore(lane: RuntimeQueuedStage['queueLane']): number {
  switch (lane) {
    case 'live_priority':
      return 400;
    case 'guardrailed_live':
      return 300;
    case 'shadow_only':
      return 200;
    case 'structural':
    default:
      return 0;
  }
}

function buildMissionStages(
  mission: ShadowRunReport['missions'][number],
): RuntimeQueuedStage[] {
  const routingWeightPatch = loadRoutingWeightPatch();
  const derivedRoleHints = buildRoleWeightHints(
    mission.decision.activeRoles.filter(
      (roleId) => roleId !== 'commander' && roleId !== 'feedback',
    ) as RoleId[],
    routingWeightPatch,
  );
  const stagePriorityHints = routingWeightPatch ? [] : mission.decision.stagePriorityHints ?? [];
  const roleWeightHints = routingWeightPatch
    ? derivedRoleHints
    : mission.decision.roleWeightHints && mission.decision.roleWeightHints.length
      ? mission.decision.roleWeightHints
      : derivedRoleHints;
  const stageHintMap = new Map(stagePriorityHints.map((item) => [item.stageId, item]));
  const roleHintMap = new Map(roleWeightHints.map((item) => [item.roleId, item]));

  return mission.decision.stagePlan.map((stage, index) => {
    const explicitHint = stageHintMap.get(stage.stageId);
    const fallbackRoleHint = roleHintMap.get(stage.ownerRole);
    const scopeId = deriveStageScopeId(mission, stage);
    const scopeHint = getRoutingScopeWeightHint(stage.ownerRole, scopeId, routingWeightPatch);
    const effectiveAction =
      scopeHint?.recommendedAction ?? explicitHint?.action ?? fallbackRoleHint?.action ?? 'structural_stage';
    const effectiveShadowWeight =
      scopeHint?.recommendedShadowWeight ??
      explicitHint?.recommendedShadowWeight ??
      fallbackRoleHint?.recommendedShadowWeight ??
      1;
    const effectiveLiveWeight =
      scopeHint?.recommendedLiveWeight ??
      explicitHint?.recommendedLiveWeight ??
      fallbackRoleHint?.recommendedLiveWeight ??
      0;
    const executionPriority = scopeHint
      ? scoreRoleHint({
          roleId: stage.ownerRole,
          recommendedShadowWeight: effectiveShadowWeight,
          recommendedLiveWeight: effectiveLiveWeight,
          action: effectiveAction,
          priorityTier: fallbackRoleHint?.priorityTier ?? 'unknown',
          scopeHints: fallbackRoleHint?.scopeHints,
        })
      : explicitHint
        ? explicitHint.executionPriority
        : fallbackRoleHint
          ? scoreRoleHint(fallbackRoleHint)
          : 0;
    const action = effectiveAction;
    const lane = laneForAction(action);

    return {
      missionId: mission.missionId,
      missionType: mission.missionType,
      stageId: stage.stageId,
      ownerRole: stage.ownerRole,
      scopeId,
      stageIndex: index,
      queueLane: lane,
      dispatchPriority: executionPriority + laneScore(lane),
      recommendedShadowWeight: effectiveShadowWeight,
      recommendedLiveWeight: effectiveLiveWeight,
      action,
      dependencyState: index === 0 ? 'ready_now' : 'waiting_on_previous_stage',
    };
  });
}

function sortQueue(left: RuntimeQueuedStage, right: RuntimeQueuedStage): number {
  const scoreDelta = right.dispatchPriority - left.dispatchPriority;

  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const stageDelta = left.stageIndex - right.stageIndex;

  if (stageDelta !== 0) {
    return stageDelta;
  }

  return left.missionId.localeCompare(right.missionId);
}

export function buildRuntimeQueuePlan(report: ShadowRunReport): RuntimeQueuePlan {
  const fullStagePlan = report.missions.flatMap(buildMissionStages);
  const readyQueue = fullStagePlan
    .filter((stage) => stage.dependencyState === 'ready_now')
    .sort(sortQueue);
  const queueLaneBreakdown: Record<string, number> = {};

  for (const stage of readyQueue) {
    increment(queueLaneBreakdown, stage.queueLane);
  }

  return {
    planVersion: 'lobster.runtime-queue-weight-scheduler.v0.1',
    generatedAt: new Date().toISOString(),
    sourceShadowVersion: report.shadowVersion,
    summary: {
      missionCount: report.missionCount,
      readyStageCount: readyQueue.length,
      totalStageCount: fullStagePlan.length,
      queueLaneBreakdown,
    },
    readyQueue,
    fullStagePlan,
  };
}
