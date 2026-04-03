import type { ShadowRunReport } from '../shadow/types.js';
import { buildRuntimeQueuePlan } from './queue-weight-scheduler.js';
import type {
  RuntimeDispatchTicket,
  RuntimeExecutorBridgeReport,
  RuntimeQueuedStage,
} from './types.js';

function increment(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function executionModeForLane(
  lane: RuntimeQueuedStage['queueLane'],
): RuntimeDispatchTicket['executionMode'] {
  switch (lane) {
    case 'live_priority':
      return 'limited_live';
    case 'guardrailed_live':
      return 'guardrailed_live';
    case 'shadow_only':
      return 'shadow_only';
    case 'structural':
    default:
      return 'structural';
  }
}

function bridgeTargetForStage(
  stage: RuntimeQueuedStage,
): RuntimeDispatchTicket['bridgeTarget'] {
  if (stage.ownerRole === 'dispatcher') {
    return stage.missionType === 'content_production' ||
      stage.missionType === 'recovery_replay'
      ? 'execute-campaign'
      : 'campaign-worker';
  }

  if (['echoer', 'catcher', 'abacus', 'followup'].includes(stage.ownerRole)) {
    return 'lead-ops-runner';
  }

  if (stage.ownerRole === 'commander' || stage.ownerRole === 'feedback') {
    return 'orchestrator-control';
  }

  return 'brain-shadow-runner';
}

function payloadFieldsForTarget(
  target: RuntimeDispatchTicket['bridgeTarget'],
): string[] {
  switch (target) {
    case 'execute-campaign':
    case 'campaign-worker':
      return [
        'campaign_id',
        'tenant_id',
        'industry_template_id',
        'target_urls',
        'bind_accounts',
      ];
    case 'lead-ops-runner':
      return ['mission_id', 'tenant_id', 'lead_context', 'lead_submission'];
    case 'brain-shadow-runner':
      return ['mission_id', 'tenant_id', 'artifact_context'];
    case 'orchestrator-control':
    default:
      return ['mission_id'];
  }
}

function payloadTemplateForStage(
  stage: RuntimeQueuedStage,
  target: RuntimeDispatchTicket['bridgeTarget'],
): Record<string, unknown> {
  if (target === 'execute-campaign' || target === 'campaign-worker') {
    return {
      campaign_id: stage.missionId,
      tenant_id: `shadow-tenant-${stage.missionId}`,
      industry_template_id: `${stage.missionType}-template`,
      target_urls: ['https://example.com/placeholder'],
      bind_accounts: ['placeholder-account'],
    };
  }

  if (target === 'lead-ops-runner') {
    return {
      mission_id: stage.missionId,
      tenant_id: `shadow-tenant-${stage.missionId}`,
      lead_context: {
        role: stage.ownerRole,
        stage_id: stage.stageId,
      },
      lead_submission: {
        tenant_id: `shadow-tenant-${stage.missionId}`,
        campaign_id: stage.missionId,
        contact_info: 'placeholder-contact',
        intention_score: 80,
        source_platform: 'shadow',
      },
    };
  }

  if (target === 'brain-shadow-runner') {
    return {
      mission_id: stage.missionId,
      tenant_id: `shadow-tenant-${stage.missionId}`,
      artifact_context: {
        role: stage.ownerRole,
        mission_type: stage.missionType,
      },
    };
  }

  return {
    mission_id: stage.missionId,
  };
}

function buildDispatchTicket(stage: RuntimeQueuedStage): RuntimeDispatchTicket {
  const executionMode = executionModeForLane(stage.queueLane);
  const bridgeTarget = bridgeTargetForStage(stage);
  const requiredPayloadFields = payloadFieldsForTarget(bridgeTarget);
  const suggestedPayloadTemplate = payloadTemplateForStage(stage, bridgeTarget);
  const readyForExecution =
    executionMode !== 'structural' && stage.dependencyState === 'ready_now';

  return {
    ticketId: `${stage.missionId}:${stage.stageId}:${stage.ownerRole}`,
    missionId: stage.missionId,
    missionType: stage.missionType,
    stageId: stage.stageId,
    ownerRole: stage.ownerRole,
    scopeId: stage.scopeId,
    queueLane: stage.queueLane,
    dispatchPriority: stage.dispatchPriority,
    executionMode,
    bridgeTarget,
    readyForExecution,
    rationale: [
      `action=${stage.action}`,
      `scope_id=${stage.scopeId ?? 'none'}`,
      `shadow_weight=${stage.recommendedShadowWeight}`,
      `live_weight=${stage.recommendedLiveWeight}`,
      `dependency_state=${stage.dependencyState}`,
    ],
    requiredPayloadFields,
    suggestedPayloadTemplate,
  };
}

export function buildRuntimeExecutorBridgeReport(
  shadowReport: ShadowRunReport,
): RuntimeExecutorBridgeReport {
  const queuePlan = buildRuntimeQueuePlan(shadowReport);
  const tickets = queuePlan.readyQueue.map(buildDispatchTicket);
  const executionModeBreakdown: Record<string, number> = {};
  const bridgeTargetBreakdown: Record<string, number> = {};

  for (const ticket of tickets) {
    increment(executionModeBreakdown, ticket.executionMode);
    increment(bridgeTargetBreakdown, ticket.bridgeTarget);
  }

  return {
    bridgeVersion: 'lobster.runtime-executor-bridge.v0.1',
    generatedAt: new Date().toISOString(),
    sourceShadowVersion: shadowReport.shadowVersion,
    sourceQueuePlanVersion: queuePlan.planVersion,
    summary: {
      ticketCount: tickets.length,
      readyForExecutionCount: tickets.filter((ticket) => ticket.readyForExecution).length,
      executionModeBreakdown,
      bridgeTargetBreakdown,
    },
    tickets,
  };
}
