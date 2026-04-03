import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ShadowComparisonReport,
  ShadowMissionComparison,
  ShadowRoleComparison,
  ShadowRoleScopeEvaluation,
  ShadowRunReport,
  ShadowSignalWeightPolicy,
  ShadowTruthRecord,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPolicyPath = path.join(__dirname, 'config', 'signal-weight.policy.json');

type TruthStatusType = 'positive' | 'neutral' | 'negative';

type EffectiveThresholds = ShadowSignalWeightPolicy['suggestionThresholds'];

function increment(bucket: Record<string, number>, key: string, amount = 1): void {
  bucket[key] = (bucket[key] ?? 0) + amount;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

export function loadShadowSignalWeightPolicy(policyPath?: string): ShadowSignalWeightPolicy {
  const resolvedPath = policyPath ? path.resolve(policyPath) : defaultPolicyPath;

  if (!existsSync(resolvedPath)) {
    throw new Error(`Shadow signal weight policy not found: ${resolvedPath}`);
  }

  return readJson<ShadowSignalWeightPolicy>(resolvedPath);
}

function classifyTruthStatus(record: ShadowTruthRecord): TruthStatusType {
  const status = (record.status ?? '').toLowerCase();

  if (['success', 'approved', 'measured', 'handled'].includes(status)) {
    return 'positive';
  }

  if (['rejected', 'failed', 'degraded', 'blocked', 'timeout'].includes(status)) {
    return 'negative';
  }

  return 'neutral';
}

function getRoleOverride(policy: ShadowSignalWeightPolicy, roleId: string) {
  return policy.roleOverrides?.[roleId];
}

function getEffectiveSignalWeight(
  record: ShadowTruthRecord,
  roleId: string,
  policy: ShadowSignalWeightPolicy,
): number {
  const roleOverride = getRoleOverride(policy, roleId);
  if (roleOverride?.signalWeights?.[record.signal] !== undefined) {
    return roleOverride.signalWeights[record.signal]!;
  }

  if (policy.signalWeights[record.signal] !== undefined) {
    return policy.signalWeights[record.signal]!;
  }

  return roleOverride?.defaultSignalWeight ?? policy.defaultSignalWeight;
}

function getEffectiveStatusMultiplier(
  roleId: string,
  statusType: TruthStatusType,
  policy: ShadowSignalWeightPolicy,
): number {
  const roleOverride = getRoleOverride(policy, roleId);
  return roleOverride?.statusMultipliers?.[statusType] ?? policy.statusMultipliers[statusType];
}

function getEffectiveThresholds(
  roleId: string,
  policy: ShadowSignalWeightPolicy,
): EffectiveThresholds {
  const roleOverride = getRoleOverride(policy, roleId);
  return {
    ...policy.suggestionThresholds,
    ...(roleOverride?.suggestionThresholds ?? {}),
  };
}

function evaluateRoleScopes(
  roleId: string,
  records: ShadowTruthRecord[],
  policy: ShadowSignalWeightPolicy,
): ShadowRoleScopeEvaluation[] {
  const scopes = getRoleOverride(policy, roleId)?.scopes ?? [];

  return scopes.map((scope) => {
    const scopedRecords = records.filter((record) => {
      if (!scope.includeSignals.includes(record.signal)) {
        return false;
      }

      if (!scope.includeScopeIds?.length) {
        return true;
      }

      return Boolean(record.scopeId && scope.includeScopeIds.includes(record.scopeId));
    });
    let positiveTruthWeight = 0;
    let negativeTruthWeight = 0;
    let netTruthWeight = 0;

    for (const record of scopedRecords) {
      const { statusType, weight } = weightedTruthScore(record, roleId, policy);
      if (statusType === 'positive') {
        positiveTruthWeight += weight;
        netTruthWeight += weight;
      } else if (statusType === 'negative') {
        negativeTruthWeight += weight;
        netTruthWeight -= weight;
      }
    }

    const eligible =
      positiveTruthWeight >= scope.thresholds.minPositiveTruthWeight &&
      negativeTruthWeight <= scope.thresholds.maxNegativeTruthWeight &&
      netTruthWeight >= scope.thresholds.minNetTruthWeight;

    return {
      scopeId: scope.scopeId,
      recommendedAction: eligible ? scope.recommendedAction : 'stay_shadow_only',
      truthRecordCount: scopedRecords.length,
      positiveTruthWeight: Number(positiveTruthWeight.toFixed(3)),
      negativeTruthWeight: Number(negativeTruthWeight.toFixed(3)),
      netTruthWeight: Number(netTruthWeight.toFixed(3)),
      includedSignals: scope.includeSignals,
    };
  });
}

function weightedTruthScore(
  record: ShadowTruthRecord,
  roleId: string,
  policy: ShadowSignalWeightPolicy,
): { statusType: TruthStatusType; weight: number } {
  const statusType = classifyTruthStatus(record);
  return {
    statusType,
    weight:
      getEffectiveSignalWeight(record, roleId, policy) *
      getEffectiveStatusMultiplier(roleId, statusType, policy),
  };
}

function compareMission(mission: ShadowRunReport['missions'][number]): ShadowMissionComparison {
  const selectedRoleIds = mission.selectedShadowRoles.map((item) => item.roleId);
  const truthRelevantRoleIds = mission.truthAttachment?.relevantRoleIds ?? [];
  const alignedRoleIds = truthRelevantRoleIds.filter((roleId) =>
    selectedRoleIds.includes(roleId),
  );
  const unattendedTruthRoleIds = truthRelevantRoleIds.filter(
    (roleId) => !selectedRoleIds.includes(roleId),
  );

  const notes: string[] = [];

  if (!mission.truthAttachment) {
    notes.push('no_truth_attached');
  }

  if (mission.truthAttachment && !truthRelevantRoleIds.length) {
    notes.push('truth_attached_but_not_role_specific');
  }

  if (unattendedTruthRoleIds.length) {
    notes.push('truth_roles_not_selected');
  }

  return {
    missionId: mission.missionId,
    missionType: mission.missionType,
    selectedRoleIds,
    truthRelevantRoleIds,
    alignedRoleIds,
    unattendedTruthRoleIds,
    truthSignalCount: mission.truthAttachment?.signals.length ?? 0,
    notes,
  };
}

function compareRoles(
  report: ShadowRunReport,
  policy: ShadowSignalWeightPolicy,
): ShadowRoleComparison[] {
  const roleMap = new Map<string, ShadowRoleComparison>();

  for (const mission of report.missions) {
    const truthRecords = mission.truthAttachment?.records ?? [];

    for (const role of mission.selectedShadowRoles) {
      const current =
        roleMap.get(role.roleId) ?? {
          roleId: role.roleId,
          shadowAssignmentCount: 0,
          truthLinkedAssignmentCount: 0,
          truthRecordCount: 0,
          positiveTruthCount: 0,
          neutralTruthCount: 0,
          negativeTruthCount: 0,
          positiveTruthWeight: 0,
          neutralTruthWeight: 0,
          negativeTruthWeight: 0,
          netTruthWeight: 0,
          sourceCoverage: {},
          signalScoreBreakdown: {},
          driftSignals: [],
          promotionSuggestion: 'continue_shadow_collection' as const,
        };

      current.shadowAssignmentCount += 1;

      const relatedTruth = truthRecords.filter((record) => record.roleId === role.roleId);

      if (relatedTruth.length) {
        current.truthLinkedAssignmentCount += 1;
      }

      for (const record of relatedTruth) {
        current.truthRecordCount += 1;
        increment(current.sourceCoverage, record.sourceType);

        const { statusType, weight } = weightedTruthScore(record, role.roleId, policy);
        increment(current.signalScoreBreakdown, record.signal, weight);

        if (statusType === 'positive') {
          current.positiveTruthCount += 1;
          current.positiveTruthWeight += weight;
          current.netTruthWeight += weight;
        } else if (statusType === 'negative') {
          current.negativeTruthCount += 1;
          current.negativeTruthWeight += weight;
          current.netTruthWeight -= weight;
          current.driftSignals.push(`${record.signal}:${record.status ?? 'negative'}`);
        } else {
          current.neutralTruthCount += 1;
          current.neutralTruthWeight += weight;
        }
      }

      roleMap.set(role.roleId, current);
    }
  }

  return [...roleMap.values()]
    .map((item) => {
      const thresholds = getEffectiveThresholds(item.roleId, policy);
      const negativeToPositiveRatio =
        item.positiveTruthWeight > 0
          ? item.negativeTruthWeight / item.positiveTruthWeight
          : item.negativeTruthWeight > 0
            ? Number.POSITIVE_INFINITY
            : 0;

      let promotionSuggestion: ShadowRoleComparison['promotionSuggestion'];

      if (item.truthRecordCount === 0) {
        promotionSuggestion = 'continue_shadow_collection';
      } else if (
        item.negativeTruthWeight >= thresholds.holdMinNegativeWeight &&
        negativeToPositiveRatio >= thresholds.holdMinNegativeToPositiveRatio
      ) {
        promotionSuggestion = 'hold_and_review';
      } else if (
        item.negativeTruthWeight <= thresholds.promoteCandidateMaxNegativeWeight &&
        item.positiveTruthWeight >= thresholds.promoteCandidateMinPositiveWeight &&
        item.netTruthWeight >= thresholds.promoteCandidateMinNetWeight
      ) {
        promotionSuggestion = 'promote_candidate';
      } else if (item.positiveTruthWeight >= thresholds.cautiousMinPositiveWeight) {
        promotionSuggestion = 'promote_cautiously';
      } else {
        promotionSuggestion = 'continue_shadow_collection';
      }

      return {
        ...item,
        positiveTruthWeight: Number(item.positiveTruthWeight.toFixed(3)),
        neutralTruthWeight: Number(item.neutralTruthWeight.toFixed(3)),
        negativeTruthWeight: Number(item.negativeTruthWeight.toFixed(3)),
        netTruthWeight: Number(item.netTruthWeight.toFixed(3)),
        signalScoreBreakdown: Object.fromEntries(
          Object.entries(item.signalScoreBreakdown)
            .map(([signal, value]) => [signal, Number(value.toFixed(3))])
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
        scopeEvaluations: evaluateRoleScopes(
          item.roleId,
          report.missions
            .flatMap((mission) => mission.truthAttachment?.records ?? [])
            .filter((record) => record.roleId === item.roleId),
          policy,
        ),
        driftSignals: unique(item.driftSignals),
        promotionSuggestion,
      };
    })
    .sort((a, b) => a.roleId.localeCompare(b.roleId));
}

export function compareShadowReport(
  report: ShadowRunReport,
  policy: ShadowSignalWeightPolicy = loadShadowSignalWeightPolicy(),
): ShadowComparisonReport {
  const missionComparisons = report.missions.map(compareMission);
  const roleComparisons = compareRoles(report, policy);

  return {
    compareVersion: 'lobster.shadow-comparator.v0.3',
    generatedAt: new Date().toISOString(),
    sourceShadowVersion: report.shadowVersion,
    signalPolicyVersion: policy.version,
    summary: {
      missionCount: report.missionCount,
      comparedMissionCount: missionComparisons.length,
      truthBearingMissionCount: report.summary.missionsWithTruthCount,
      promoteCandidateRoles: roleComparisons
        .filter((item) => item.promotionSuggestion === 'promote_candidate')
        .map((item) => item.roleId),
      cautiousRoles: roleComparisons
        .filter((item) => item.promotionSuggestion === 'promote_cautiously')
        .map((item) => item.roleId),
      holdRoles: roleComparisons
        .filter((item) => item.promotionSuggestion === 'hold_and_review')
        .map((item) => item.roleId),
      continueRoles: roleComparisons
        .filter((item) => item.promotionSuggestion === 'continue_shadow_collection')
        .map((item) => item.roleId),
    },
    roleComparisons,
    missionComparisons,
  };
}
