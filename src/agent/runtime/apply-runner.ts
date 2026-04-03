import { simulateBrainShadowDispatch } from './brain-shadow-runner.js';
import { simulateLeadOpsDispatch } from './lead-ops-runner.js';
import type {
  RuntimeAdapterDispatch,
  RuntimeApplyAttempt,
  RuntimeApplyRunnerReport,
  RuntimeWorkerAdapterReport,
} from './types.js';

function increment(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

async function simulateDispatch(
  dispatch: RuntimeAdapterDispatch,
): Promise<RuntimeApplyAttempt> {
  const reason = [...dispatch.guardrails];

  if (dispatch.dryRunStatus === 'structural_only') {
    return {
      applyId: `apply:${dispatch.dispatchId}`,
      dispatchId: dispatch.dispatchId,
      dispatchStrategy: dispatch.dispatchStrategy,
      readyToApply: false,
      applyMode: 'dry_run',
      status: 'skipped',
      target: dispatch.bridgeTarget,
      reason: [...reason, 'structural_stage_not_executed'],
      payloadPreview: dispatch.payloadPreview,
    };
  }

  if (!dispatch.readyToApply) {
    return {
      applyId: `apply:${dispatch.dispatchId}`,
      dispatchId: dispatch.dispatchId,
      dispatchStrategy: dispatch.dispatchStrategy,
      readyToApply: false,
      applyMode: 'dry_run',
      status: 'blocked',
      target: dispatch.bridgeTarget,
      reason: [...reason, 'dispatch_not_ready_to_apply'],
      payloadPreview: dispatch.payloadPreview,
    };
  }

  if (dispatch.dispatchStrategy === 'invoke_lead_ops_runner') {
    await simulateLeadOpsDispatch({
      dispatchId: dispatch.dispatchId,
      payloadPreview: dispatch.payloadPreview,
    });
  } else if (dispatch.dispatchStrategy === 'invoke_brain_shadow_runner') {
    await simulateBrainShadowDispatch({
      dispatchId: dispatch.dispatchId,
      payloadPreview: dispatch.payloadPreview,
    });
  }

  return {
    applyId: `apply:${dispatch.dispatchId}`,
    dispatchId: dispatch.dispatchId,
    dispatchStrategy: dispatch.dispatchStrategy,
    readyToApply: true,
    applyMode: 'dry_run',
    status: 'simulated',
    target: dispatch.bridgeTarget,
    reason: [...reason, 'dry_run_apply_completed'],
    payloadPreview: dispatch.payloadPreview,
  };
}

export async function buildRuntimeApplyRunnerReport(
  adapterReport: RuntimeWorkerAdapterReport,
): Promise<RuntimeApplyRunnerReport> {
  const attempts: RuntimeApplyAttempt[] = [];
  const strategyBreakdown: Record<string, number> = {};

  for (const dispatch of adapterReport.dispatches) {
    const attempt = await simulateDispatch(dispatch);
    attempts.push(attempt);
    increment(strategyBreakdown, dispatch.dispatchStrategy);
  }

  return {
    applyVersion: 'lobster.runtime-apply-runner.v0.1',
    generatedAt: new Date().toISOString(),
    sourceAdapterVersion: adapterReport.adapterVersion,
    summary: {
      attemptCount: attempts.length,
      simulatedCount: attempts.filter((item) => item.status === 'simulated').length,
      skippedCount: attempts.filter((item) => item.status === 'skipped').length,
      blockedCount: attempts.filter((item) => item.status === 'blocked').length,
      strategyBreakdown,
    },
    attempts,
  };
}
