import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  RuntimeAdapterDispatch,
  RuntimeLimitedLiveDecision,
  RuntimeLimitedLiveEnvelope,
  RuntimeLimitedLivePolicy,
  RuntimeLimitedLiveReport,
  RuntimeWorkerAdapterReport,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPolicyPath = path.join(__dirname, 'config', 'limited-live.policy.json');

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

export function loadLimitedLivePolicy(policyPath?: string): RuntimeLimitedLivePolicy {
  const resolvedPath = policyPath ? path.resolve(policyPath) : defaultPolicyPath;

  if (!existsSync(resolvedPath)) {
    throw new Error(`Limited live policy not found: ${resolvedPath}`);
  }

  return readJson<RuntimeLimitedLivePolicy>(resolvedPath);
}

function parseDispatchIdentity(dispatchId: string): {
  missionId: string;
  stageId: string;
  ownerRole: string;
} {
  const parts = dispatchId.split(':');

  return {
    missionId: parts[1] ?? 'unknown-mission',
    stageId: parts[2] ?? 'unknown-stage',
    ownerRole: parts[3] ?? 'unknown-role',
  };
}

function normalizeDispatch(dispatch: RuntimeAdapterDispatch): RuntimeAdapterDispatch {
  const identity = parseDispatchIdentity(dispatch.dispatchId);

  return {
    ...dispatch,
    missionId: dispatch.missionId ?? identity.missionId,
    stageId: dispatch.stageId ?? identity.stageId,
    ownerRole: dispatch.ownerRole ?? identity.ownerRole,
    scopeId: dispatch.scopeId,
    missionType: dispatch.missionType ?? 'unknown',
    queueLane: dispatch.queueLane ?? 'shadow_only',
  };
}

function buildEnvelope(dispatch: RuntimeAdapterDispatch): RuntimeLimitedLiveEnvelope {
  const normalized = normalizeDispatch(dispatch);

  return {
    envelopeId: `envelope:${normalized.dispatchId}`,
    dispatchId: normalized.dispatchId,
    missionId: normalized.missionId,
    missionType: normalized.missionType,
    stageId: normalized.stageId,
    ownerRole: normalized.ownerRole,
    scopeId: normalized.scopeId,
    bridgeTarget: normalized.bridgeTarget,
    dispatchStrategy: normalized.dispatchStrategy,
    payload: normalized.payloadPreview,
    guardrails: normalized.guardrails,
    createdAt: new Date().toISOString(),
  };
}

function isAllowed(dispatch: RuntimeAdapterDispatch, policy: RuntimeLimitedLivePolicy): {
  allowed: boolean;
  rationale: string[];
} {
  const normalized = normalizeDispatch(dispatch);
  const rationale: string[] = [];

  if (!normalized.readyToApply) {
    rationale.push('dispatch_not_ready_to_apply');
  }

  if (!policy.allowRoles.includes(normalized.ownerRole)) {
    rationale.push('role_not_in_allowlist');
  }

  const scopedAllowlist = policy.allowRoleScopes?.[normalized.ownerRole];
  if (scopedAllowlist?.length) {
    if (!normalized.scopeId) {
      rationale.push('missing_required_scope_id');
    } else if (!scopedAllowlist.includes(normalized.scopeId)) {
      rationale.push('scope_not_in_allowlist');
    }
  }

  if (!policy.allowStrategies.includes(normalized.dispatchStrategy)) {
    rationale.push('strategy_not_in_allowlist');
  }

  if (!policy.allowExecutionModes.includes(normalized.executionMode)) {
    rationale.push('execution_mode_not_allowed');
  }

  if (
    normalized.executionMode === 'guardrailed_live' &&
    policy.allowGuardrailedLive !== true
  ) {
    rationale.push('guardrailed_live_disabled');
  }

  const liveWeightGuardrail = normalized.guardrails.find((item) => item.includes('live_weight='));
  const liveWeight = liveWeightGuardrail
    ? Number(liveWeightGuardrail.split('=')[1])
    : normalized.executionMode === 'limited_live'
      ? 0.15
      : normalized.executionMode === 'guardrailed_live'
        ? 0.05
        : 0;

  if (liveWeight > policy.maxLiveWeight) {
    rationale.push('live_weight_above_policy_cap');
  }

  return {
    allowed: rationale.length === 0,
    rationale,
  };
}

export function buildLimitedLiveReport(
  adapterReport: RuntimeWorkerAdapterReport,
  policy: RuntimeLimitedLivePolicy,
): RuntimeLimitedLiveReport {
  mkdirSync(policy.outputDirectory, { recursive: true });
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');

  const decisions: RuntimeLimitedLiveDecision[] = adapterReport.dispatches.map((dispatch) => {
    const normalized = normalizeDispatch(dispatch);

    if (normalized.dryRunStatus === 'structural_only') {
      return {
        dispatchId: normalized.dispatchId,
        ownerRole: normalized.ownerRole,
        executionMode: normalized.executionMode,
        action: 'skipped',
        rationale: ['structural_stage'],
      };
    }

    const verdict = isAllowed(normalized, policy);

    if (!verdict.allowed) {
      return {
        dispatchId: normalized.dispatchId,
        ownerRole: normalized.ownerRole,
        executionMode: normalized.executionMode,
        action: 'denied',
        rationale: verdict.rationale,
      };
    }

    const envelope = buildEnvelope(normalized);
    const envelopePath = path.join(
      policy.outputDirectory,
      `${normalized.dispatchId.replace(/[:]/g, '__')}__${runStamp}.json`,
    );
    writeFileSync(envelopePath, JSON.stringify(envelope, null, 2));

    return {
      dispatchId: normalized.dispatchId,
      ownerRole: normalized.ownerRole,
      executionMode: normalized.executionMode,
      action: 'queued_live',
      rationale: ['allowed_by_policy'],
      envelopePath,
    };
  });

  return {
    liveVersion: 'lobster.runtime-limited-live-executor.v0.1',
    generatedAt: new Date().toISOString(),
    policyVersion: policy.version,
    sourceAdapterVersion: adapterReport.adapterVersion,
    outputDirectory: policy.outputDirectory,
    summary: {
      consideredCount: decisions.length,
      queuedCount: decisions.filter((item) => item.action === 'queued_live').length,
      deniedCount: decisions.filter((item) => item.action === 'denied').length,
      skippedCount: decisions.filter((item) => item.action === 'skipped').length,
    },
    decisions,
  };
}
