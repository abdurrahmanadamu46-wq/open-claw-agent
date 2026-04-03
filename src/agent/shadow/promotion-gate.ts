import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  PromotionGateDecision,
  PromotionGatePolicy,
  PromotionGateReport,
  ShadowComparisonReport,
  ShadowRoleComparison,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPolicyPath = path.join(__dirname, 'config', 'promotion-gate.policy.json');

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function loadPromotionGatePolicy(policyPath?: string): PromotionGatePolicy {
  const resolvedPath = policyPath ? path.resolve(policyPath) : defaultPolicyPath;

  if (!existsSync(resolvedPath)) {
    throw new Error(`Promotion gate policy not found: ${resolvedPath}`);
  }

  return readJson<PromotionGatePolicy>(resolvedPath);
}

function findPriorityTier(
  compareReport: ShadowComparisonReport,
  roleId: string,
): string {
  const missionWithRole = compareReport.missionComparisons.find((mission) =>
    mission.selectedRoleIds.includes(roleId),
  );

  return missionWithRole ? 'T1' : 'T2';
}

function buildDecision(
  role: ShadowRoleComparison,
  compareReport: ShadowComparisonReport,
  policy: PromotionGatePolicy,
): PromotionGateDecision {
  const band = policy.bands[role.promotionSuggestion];
  const priorityTier = findPriorityTier(compareReport, role.roleId);
  const tierDefault = policy.defaultTierWeights[priorityTier] ?? {
    shadowWeight: 1,
    liveWeight: 0,
  };

  const rationale = [
    `source_suggestion=${role.promotionSuggestion}`,
    `truth_linked_assignments=${role.truthLinkedAssignmentCount}`,
    `positive_truth=${role.positiveTruthCount}`,
    `negative_truth=${role.negativeTruthCount}`,
    `positive_weight=${role.positiveTruthWeight}`,
    `negative_weight=${role.negativeTruthWeight}`,
    `net_weight=${role.netTruthWeight}`,
  ];

  if (role.truthLinkedAssignmentCount < band.minTruthLinkedAssignments) {
    rationale.push('below_min_truth_linked_assignments');
  }

  if (role.positiveTruthCount < band.minPositiveTruthCount) {
    rationale.push('below_min_positive_truth_count');
  }

  if (role.negativeTruthCount > band.maxNegativeTruthCount) {
    rationale.push('above_max_negative_truth_count');
  }

  if (
    band.minPositiveTruthWeight !== undefined &&
    role.positiveTruthWeight < band.minPositiveTruthWeight
  ) {
    rationale.push('below_min_positive_truth_weight');
  }

  if (
    band.maxNegativeTruthWeight !== undefined &&
    role.negativeTruthWeight > band.maxNegativeTruthWeight
  ) {
    rationale.push('above_max_negative_truth_weight');
  }

  if (band.minNetTruthWeight !== undefined && role.netTruthWeight < band.minNetTruthWeight) {
    rationale.push('below_min_net_truth_weight');
  }

  const recommendedShadowWeight = Math.max(
    tierDefault.shadowWeight,
    band.targetShadowWeight,
  );
  const recommendedLiveWeight =
    role.truthLinkedAssignmentCount >= band.minTruthLinkedAssignments &&
    role.positiveTruthCount >= band.minPositiveTruthCount &&
    role.negativeTruthCount <= band.maxNegativeTruthCount &&
    (band.minPositiveTruthWeight === undefined ||
      role.positiveTruthWeight >= band.minPositiveTruthWeight) &&
    (band.maxNegativeTruthWeight === undefined ||
      role.negativeTruthWeight <= band.maxNegativeTruthWeight) &&
    (band.minNetTruthWeight === undefined ||
      role.netTruthWeight >= band.minNetTruthWeight)
      ? band.targetLiveWeight
      : tierDefault.liveWeight;

  const action =
    recommendedLiveWeight > 0 ? band.action : 'stay_shadow_only';

  return {
    roleId: role.roleId,
    priorityTier,
    sourceSuggestion: role.promotionSuggestion,
    action,
    recommendedShadowWeight,
    recommendedLiveWeight,
    rationale,
    driftSignals: role.driftSignals,
    scopeHints: role.scopeEvaluations,
  };
}

export function runPromotionGate(
  compareReport: ShadowComparisonReport,
  policy: PromotionGatePolicy,
): PromotionGateReport {
  const decisions = compareReport.roleComparisons.map((role) =>
    buildDecision(role, compareReport, policy),
  );

  return {
    gateVersion: 'lobster.shadow-promotion-gate.v0.2',
    generatedAt: new Date().toISOString(),
    sourceCompareVersion: compareReport.compareVersion,
    policyVersion: policy.version,
    summary: {
      promoteNow: decisions
        .filter((item) => item.action === 'promote_to_limited_live')
        .map((item) => item.roleId),
      promoteWithGuardrails: decisions
        .filter((item) => item.action === 'promote_with_guardrails')
        .map((item) => item.roleId),
      stayShadowOnly: decisions
        .filter((item) => item.action === 'stay_shadow_only')
        .map((item) => item.roleId),
      holdAndReview: decisions
        .filter((item) => item.action === 'hold_and_review')
        .map((item) => item.roleId),
    },
    decisions,
  };
}
