import type {
  RuntimeAdapterDispatch,
  RuntimeDispatchTicket,
  RuntimeExecutorBridgeReport,
  RuntimeWorkerAdapterReport,
} from './types.js';

function increment(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function dispatchStrategyForTarget(
  target: RuntimeDispatchTicket['bridgeTarget'],
): RuntimeAdapterDispatch['dispatchStrategy'] {
  switch (target) {
    case 'execute-campaign':
      return 'call_execute_campaign_task';
    case 'campaign-worker':
      return 'enqueue_campaign_worker_job';
    case 'brain-shadow-runner':
      return 'invoke_brain_shadow_runner';
    case 'lead-ops-runner':
      return 'invoke_lead_ops_runner';
    case 'orchestrator-control':
    default:
      return 'skip_structural_stage';
  }
}

function guardrailsForTicket(ticket: RuntimeDispatchTicket): string[] {
  const guardrails = [
    `execution_mode=${ticket.executionMode}`,
    `queue_lane=${ticket.queueLane}`,
  ];

  if (ticket.executionMode === 'guardrailed_live') {
    guardrails.push('require_runtime_approval_check');
    guardrails.push('limit_live_weight_before_apply');
  }

  if (ticket.executionMode === 'limited_live') {
    guardrails.push('sampled_live_rollout_only');
    guardrails.push('truth_feedback_must_be_captured');
  }

  if (ticket.executionMode === 'shadow_only') {
    guardrails.push('no_live_side_effects');
  }

  if (ticket.bridgeTarget === 'execute-campaign') {
    guardrails.push('validate_campaign_payload_contract');
  }

  if (ticket.bridgeTarget === 'orchestrator-control') {
    guardrails.push('structural_stage_no_worker_dispatch');
  }

  return guardrails;
}

function buildAdapterDispatch(ticket: RuntimeDispatchTicket): RuntimeAdapterDispatch {
  const dispatchStrategy = dispatchStrategyForTarget(ticket.bridgeTarget);
  const readyToApply =
    ticket.readyForExecution &&
    dispatchStrategy !== 'skip_structural_stage' &&
    ticket.executionMode !== 'shadow_only';

  return {
    dispatchId: `dispatch:${ticket.ticketId}`,
    missionId: ticket.missionId,
    missionType: ticket.missionType,
    stageId: ticket.stageId,
    ownerRole: ticket.ownerRole,
    scopeId: ticket.scopeId,
    queueLane: ticket.queueLane,
    ticketId: ticket.ticketId,
    executionMode: ticket.executionMode,
    bridgeTarget: ticket.bridgeTarget,
    dispatchStrategy,
    readyToApply,
    dryRunStatus: ticket.executionMode === 'structural'
      ? 'structural_only'
      : readyToApply
        ? 'ready'
        : 'blocked',
    payloadContract: ticket.requiredPayloadFields,
    payloadPreview: ticket.suggestedPayloadTemplate,
    guardrails: [
      ...guardrailsForTicket(ticket),
      `scope_id=${ticket.scopeId ?? 'none'}`,
    ],
  };
}

export function buildRuntimeWorkerAdapterReport(
  bridgeReport: RuntimeExecutorBridgeReport,
): RuntimeWorkerAdapterReport {
  const dispatches = bridgeReport.tickets.map(buildAdapterDispatch);
  const strategyBreakdown: Record<string, number> = {};

  for (const dispatch of dispatches) {
    increment(strategyBreakdown, dispatch.dispatchStrategy);
  }

  return {
    adapterVersion: 'lobster.runtime-worker-adapter.v0.1',
    generatedAt: new Date().toISOString(),
    sourceBridgeVersion: bridgeReport.bridgeVersion,
    summary: {
      dispatchCount: dispatches.length,
      readyCount: dispatches.filter((item) => item.dryRunStatus === 'ready').length,
      blockedCount: dispatches.filter((item) => item.dryRunStatus === 'blocked').length,
      strategyBreakdown,
    },
    dispatches,
  };
}
