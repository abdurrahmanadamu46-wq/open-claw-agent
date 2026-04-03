import type { CommanderDecision, DecisionContext } from '../commander/index.js';

export interface LobsterRegistryEntry {
  packageName: string;
  roleId: string;
  primaryArtifact: string;
  path: string;
  priorityTier: string;
  trainingStage: string;
  nextMilestone: string;
}

export interface LobsterRoleCard {
  roleId: string;
  displayName: string;
  zhName: string;
  mission: string;
  primaryArtifact: string;
  inputContract: string[];
  outputContract: string[];
  memoryReadScope: string[];
  memoryWriteScope: string[];
  evalFocus: string[];
  upstreamRoles: string[];
  downstreamRoles: string[];
}

export interface ShadowRoleAssignment {
  roleId: string;
  packageName: string;
  trainingStage: string;
  priorityTier: string;
  artifactType: string;
  packagePath: string;
  sampleArtifactPreview: Record<string, unknown> | null;
  notes: string[];
}

export type ShadowTruthSourceType =
  | 'crm'
  | 'approval'
  | 'runtime'
  | 'conversation';

export interface ShadowTruthRecord {
  id: string;
  missionId: string;
  sourceType: ShadowTruthSourceType;
  signal: string;
  roleId?: string;
  scopeId?: string;
  status?: string;
  value?: string | number | boolean;
  note?: string;
  sourceRef?: string;
}

export interface ShadowTruthBundle {
  schemaVersion: string;
  generatedAt: string;
  records: ShadowTruthRecord[];
}

export interface ShadowTruthAttachment {
  recordCount: number;
  sourceBreakdown: Record<string, number>;
  relevantRoleIds: string[];
  relevantScopeIds: string[];
  signals: string[];
  records: ShadowTruthRecord[];
}

export interface ShadowMissionResult {
  missionId: string;
  missionType: DecisionContext['missionType'];
  decision: CommanderDecision;
  selectedShadowRoles: ShadowRoleAssignment[];
  blockedRoles: Array<{
    roleId: string;
    reason: string;
  }>;
  truthAttachment: ShadowTruthAttachment | null;
}

export interface ShadowRunReport {
  shadowVersion: string;
  generatedAt: string;
  missionCount: number;
  onlyShadowReady: boolean;
  truthBundleLoaded: boolean;
  summary: {
    missionTypeBreakdown: Record<string, number>;
    roleUsage: Record<string, number>;
    blockedRoleCount: number;
    runnableRoleCount: number;
    truthRecordCount: number;
    missionsWithTruthCount: number;
  };
  missions: ShadowMissionResult[];
}

export interface ShadowMissionComparison {
  missionId: string;
  missionType: DecisionContext['missionType'];
  selectedRoleIds: string[];
  truthRelevantRoleIds: string[];
  alignedRoleIds: string[];
  unattendedTruthRoleIds: string[];
  truthSignalCount: number;
  notes: string[];
}

export interface ShadowRoleComparison {
  roleId: string;
  shadowAssignmentCount: number;
  truthLinkedAssignmentCount: number;
  truthRecordCount: number;
  positiveTruthCount: number;
  neutralTruthCount: number;
  negativeTruthCount: number;
  positiveTruthWeight: number;
  neutralTruthWeight: number;
  negativeTruthWeight: number;
  netTruthWeight: number;
  sourceCoverage: Record<string, number>;
  signalScoreBreakdown: Record<string, number>;
  scopeEvaluations?: ShadowRoleScopeEvaluation[];
  driftSignals: string[];
  promotionSuggestion:
    | 'promote_candidate'
    | 'promote_cautiously'
    | 'continue_shadow_collection'
    | 'hold_and_review';
}

export interface ShadowRoleScopeEvaluation {
  scopeId: string;
  recommendedAction: 'promote_to_limited_live' | 'promote_with_guardrails' | 'stay_shadow_only';
  truthRecordCount: number;
  positiveTruthWeight: number;
  negativeTruthWeight: number;
  netTruthWeight: number;
  includedSignals: string[];
}

export interface ShadowComparisonReport {
  compareVersion: string;
  generatedAt: string;
  sourceShadowVersion: string;
  signalPolicyVersion: string;
  summary: {
    missionCount: number;
    comparedMissionCount: number;
    truthBearingMissionCount: number;
    promoteCandidateRoles: string[];
    cautiousRoles: string[];
    holdRoles: string[];
    continueRoles: string[];
  };
  roleComparisons: ShadowRoleComparison[];
  missionComparisons: ShadowMissionComparison[];
}

export interface ShadowSignalWeightPolicy {
  version: string;
  name: string;
  defaultSignalWeight: number;
  statusMultipliers: {
    positive: number;
    neutral: number;
    negative: number;
  };
  signalWeights: Record<string, number>;
  suggestionThresholds: {
    promoteCandidateMinPositiveWeight: number;
    promoteCandidateMaxNegativeWeight: number;
    promoteCandidateMinNetWeight: number;
    holdMinNegativeWeight: number;
    holdMinNegativeToPositiveRatio: number;
    cautiousMinPositiveWeight: number;
  };
  roleOverrides?: Record<
    string,
    {
      defaultSignalWeight?: number;
      statusMultipliers?: Partial<{
        positive: number;
        neutral: number;
        negative: number;
      }>;
      signalWeights?: Record<string, number>;
      suggestionThresholds?: Partial<{
        promoteCandidateMinPositiveWeight: number;
        promoteCandidateMaxNegativeWeight: number;
        promoteCandidateMinNetWeight: number;
        holdMinNegativeWeight: number;
        holdMinNegativeToPositiveRatio: number;
        cautiousMinPositiveWeight: number;
      }>;
      scopes?: Array<{
        scopeId: string;
        includeSignals: string[];
        includeScopeIds?: string[];
        thresholds: {
          minPositiveTruthWeight: number;
          maxNegativeTruthWeight: number;
          minNetTruthWeight: number;
        };
        recommendedAction: 'promote_to_limited_live' | 'promote_with_guardrails' | 'stay_shadow_only';
      }>;
    }
  >;
}

export interface PromotionGatePolicyBand {
  minTruthLinkedAssignments: number;
  minPositiveTruthCount: number;
  maxNegativeTruthCount: number;
  minPositiveTruthWeight?: number;
  maxNegativeTruthWeight?: number;
  minNetTruthWeight?: number;
  targetShadowWeight: number;
  targetLiveWeight: number;
  action: string;
}

export interface PromotionGatePolicy {
  version: string;
  name: string;
  defaultTierWeights: Record<string, { shadowWeight: number; liveWeight: number }>;
  bands: {
    promote_candidate: PromotionGatePolicyBand;
    promote_cautiously: PromotionGatePolicyBand;
    continue_shadow_collection: PromotionGatePolicyBand;
    hold_and_review: PromotionGatePolicyBand;
  };
}

export interface PromotionGateDecision {
  roleId: string;
  priorityTier: string;
  sourceSuggestion: ShadowRoleComparison['promotionSuggestion'];
  action: string;
  recommendedShadowWeight: number;
  recommendedLiveWeight: number;
  rationale: string[];
  driftSignals: string[];
  scopeHints?: ShadowRoleScopeEvaluation[];
}

export interface PromotionGateReport {
  gateVersion: string;
  generatedAt: string;
  sourceCompareVersion: string;
  policyVersion: string;
  summary: {
    promoteNow: string[];
    promoteWithGuardrails: string[];
    stayShadowOnly: string[];
    holdAndReview: string[];
  };
  decisions: PromotionGateDecision[];
}
