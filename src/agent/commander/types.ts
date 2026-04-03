export type MissionType =
  | 'signal_scan'
  | 'strategy_design'
  | 'content_production'
  | 'interaction_handling'
  | 'lead_qualification'
  | 'conversion_push'
  | 'recovery_replay'
  | 'review_evolution';

export type RiskLevel = 'L0' | 'L1' | 'L2' | 'L3';
export type LatencyPriority = 'low' | 'normal' | 'high' | 'urgent';
export type RevenueImpact = 'low' | 'medium' | 'high' | 'strategic';
export type EvidenceSufficiency = 'low' | 'medium' | 'high';

export type RoleId =
  | 'commander'
  | 'radar'
  | 'strategist'
  | 'inkwriter'
  | 'visualizer'
  | 'dispatcher'
  | 'echoer'
  | 'catcher'
  | 'abacus'
  | 'followup'
  | 'feedback';

export type LineupId =
  | 'reconnaissance'
  | 'content'
  | 'interaction'
  | 'conversion'
  | 'recovery'
  | 'review';

export interface DecisionContext {
  missionId: string;
  missionType: MissionType;
  riskLevel: RiskLevel;
  latencyPriority: LatencyPriority;
  revenueImpact: RevenueImpact;
  evidenceSufficiency: EvidenceSufficiency;
  requiresExternalAction?: boolean;
  requiresHumanTouchpoint?: boolean;
  hasWarmLead?: boolean;
  externalDependencyUnstable?: boolean;
  recentFailureCount?: number;
  budgetCap?: number;
  tags?: string[];
}

export interface BudgetPlan {
  tokenBudget: number;
  toolBudget: number;
  latencyBudgetSec: number;
  parallelismBudget: number;
}

export interface StagePlan {
  stageId: string;
  label: string;
  ownerRole: RoleId;
  lineupId: LineupId;
  parallelAllowed: boolean;
}

export interface CommanderStagePriorityHint {
  stageId: string;
  ownerRole: RoleId;
  executionPriority: number;
  recommendedShadowWeight: number;
  recommendedLiveWeight: number;
  action: string;
}

export type BaselineAgentMode = 'specialist' | 'orchestrator-specialist';

export interface BaselineRoleAgentBinding {
  roleId: RoleId;
  packageName: string | null;
  primaryArtifact: string | null;
  baselineAgentId: string;
  agentMode: BaselineAgentMode;
  starterSkills: string[];
  defaultBridgeTarget: string | null;
  defaultScopeId?: string | null;
  defaultMissionTypes: MissionType[];
  shadowStage: string;
  clawhubRequiredNow: boolean;
}

export interface BaselineAgentManifest {
  schemaVersion: string;
  generatedAt: string;
  clawhub: {
    requiredNow: boolean;
    recommendedLater: boolean;
    laterUseCases: string[];
    currentDecision: string;
  };
  roles: Array<{
    roleId: Exclude<RoleId, 'commander' | 'feedback'>;
    packageName: string;
    primaryArtifact: string;
    baselineAgentId: string;
    agentMode: BaselineAgentMode;
    starterSkills: string[];
    defaultBridgeTarget: string;
    defaultScopeId?: string;
    defaultMissionTypes: MissionType[];
    shadowStage: string;
  }>;
}

export interface ApprovalGate {
  action: string;
  riskLevel: RiskLevel;
  required: boolean;
  reason: string;
}

export interface StopLossRule {
  maxRetry: number;
  maxBudgetOverrunRatio: number;
  killOnRepeatedFailure: boolean;
  freezeOnApprovalReject: boolean;
}

export interface CommanderDecision {
  decisionVersion: string;
  missionId: string;
  missionType: MissionType;
  selectedLineups: LineupId[];
  activeRoles: RoleId[];
  baselineAgentBindings: BaselineRoleAgentBinding[];
  roleWeightHints: CommanderRoleWeightHint[];
  prioritizedActiveRoles: RoleId[];
  stagePriorityHints: CommanderStagePriorityHint[];
  stagePlan: StagePlan[];
  budgetPlan: BudgetPlan;
  approvalPlan: ApprovalGate[];
  stopLossRule: StopLossRule;
  arbitrationPriority: string[];
  requiresCommanderSupervision: boolean;
  requiresHumanReview: boolean;
  reasons: string[];
  appliedRuleIds: string[];
  matchedRuleIds: string[];
}

export interface RoutingWeightEntry {
  roleId: RoleId;
  priorityTier: string;
  action: string;
  recommendedShadowWeight: number;
  recommendedLiveWeight: number;
  rationale: string[];
  driftSignals: string[];
  scopeHints?: RoutingScopeWeightHint[];
}

export interface RoutingScopeWeightHint {
  scopeId: string;
  recommendedAction: string;
  recommendedShadowWeight?: number;
  recommendedLiveWeight?: number;
  truthRecordCount: number;
  positiveTruthWeight: number;
  negativeTruthWeight: number;
  netTruthWeight: number;
  includedSignals: string[];
}

export interface RoutingWeightPatch {
  schemaVersion: string;
  generatedAt: string;
  sourceGateVersion: string;
  policyVersion: string;
  entries: RoutingWeightEntry[];
}

export interface CommanderRoleWeightHint {
  roleId: RoleId;
  recommendedShadowWeight: number;
  recommendedLiveWeight: number;
  action: string;
  priorityTier: string;
  scopeHints?: RoutingScopeWeightHint[];
}

export interface DecisionLineup {
  id: LineupId;
  label: string;
  roles: RoleId[];
}

export interface MissionProfile {
  baseLineups: LineupId[];
  stagePlan: StagePlan[];
  budgetPlan: BudgetPlan;
  approvalActions: string[];
  stopLossProfile: string;
}

export interface RiskPolicy {
  requiresCommanderSupervision: boolean;
  requiresHumanReview: boolean;
  approvalActions: string[];
  budgetMultiplier: number;
  parallelismCap: number | null;
}

export interface OverrideRuleEffects {
  prependLineups?: LineupId[];
  appendLineups?: LineupId[];
  replaceLineups?: LineupId[];
  prependStages?: StagePlan[];
  appendStages?: StagePlan[];
  replaceStagesFromMission?: MissionType;
  addApprovalActions?: string[];
  budgetMultiplier?: number;
  parallelismCap?: number;
  forceCommanderSupervision?: boolean;
  forceHumanReview?: boolean;
  reasons?: string[];
}

export interface OverrideRule {
  id: string;
  enabled: boolean;
  priority: number;
  weight: number;
  tags?: string[];
  notes?: string;
  when: Record<string, unknown>;
  effects: OverrideRuleEffects;
}

export interface DecisionTable {
  meta: {
    version: string;
    name: string;
    description: string;
    lastUpdated: string;
  };
  lineupCatalog: Record<string, DecisionLineup>;
  missionProfiles: Record<string, MissionProfile>;
  riskPolicies: Record<RiskLevel, RiskPolicy>;
  stopLossProfiles: Record<string, StopLossRule>;
  arbitrationPriority: string[];
  overrideRules: OverrideRule[];
}

export interface RuleStat {
  ruleId: string;
  priority: number;
  weight: number;
  enabled: boolean;
  tags: string[];
  evaluatedCount: number;
  matchedCount: number;
  appliedCount: number;
  lastMissionType: string | null;
  lastEvaluatedAt: string | null;
  lastMatchedAt: string | null;
  lastAppliedAt: string | null;
}

export interface SimulationReport {
  simulationVersion: string;
  decisionTable: {
    path: string;
    schemaPath: string;
    mtimeMs: number;
    version: string | null;
  };
  summary: {
    missionCount: number;
    missionTypeBreakdown: Record<string, number>;
    lineupUsage: Record<string, number>;
    roleUsage: Record<string, number>;
    approvalActionUsage: Record<string, number>;
    riskBreakdown: Record<string, number>;
    supervisionRate: number;
    humanReviewRate: number;
    averageBudgets: {
      tokenBudget: number;
      toolBudget: number;
      latencyBudgetSec: number;
    };
  };
  ruleStats: RuleStat[];
  decisions: CommanderDecision[];
}

export interface CommanderWorkflowStage {
  stageId: string;
  label: string;
  ownerRole: RoleId;
  missionType: MissionType;
  bridgeTarget: string | null;
  scopeId?: string | null;
  approvalActions: string[];
  outputs: string[];
}

export interface CommanderExecutableWorkflow {
  workflowId: string;
  label: string;
  goal: string;
  roles: RoleId[];
  lineups: LineupId[];
  category:
    | 'intelligence'
    | 'strategy'
    | 'content'
    | 'runtime'
    | 'lead'
    | 'conversion'
    | 'recovery'
    | 'review'
    | 'risk';
  stages: CommanderWorkflowStage[];
  localKnowledgeBases: string[];
  clawhubSkillHints: Record<string, string[]>;
}
