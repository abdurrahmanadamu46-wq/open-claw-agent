import { loadDecisionTable } from './table.js';
import { recordRuleEvaluation } from './stats.js';
import { buildBaselineRoleBindings, loadBaselineAgentManifest } from './baseline.js';
import {
  buildRoleWeightHints,
  buildStagePriorityHints,
  loadRoutingWeightPatch,
  prioritizeActiveRoles,
} from './weights.js';
import type {
  ApprovalGate,
  CommanderDecision,
  DecisionContext,
  DecisionTable,
  LineupId,
  OverrideRule,
  RiskLevel,
  RoleId,
  StagePlan,
} from './types.js';

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function matchesRule(when: Record<string, unknown>, context: Record<string, unknown>): boolean {
  return Object.entries(when).every(([key, expected]) => {
    if (key === 'recentFailureCountAtLeast') {
      return ((context.recentFailureCount as number | undefined) ?? 0) >= Number(expected);
    }

    const actual = context[key];

    if (Array.isArray(expected)) {
      return expected.includes(actual);
    }

    return actual === expected;
  });
}

function sortRules(rules: OverrideRule[]): OverrideRule[] {
  return [...rules].sort((a, b) => {
    const priorityDelta = (b.priority ?? 100) - (a.priority ?? 100);

    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const weightDelta = (b.weight ?? 1) - (a.weight ?? 1);

    if (weightDelta !== 0) {
      return weightDelta;
    }

    return a.id.localeCompare(b.id);
  });
}

function deriveActiveRoles(
  selectedLineups: LineupId[],
  lineupCatalog: DecisionTable['lineupCatalog'],
): RoleId[] {
  return unique(
    selectedLineups.flatMap((lineupId) => lineupCatalog[lineupId]?.roles ?? []),
  );
}

function toApprovalPlan(actions: string[], riskLevel: RiskLevel): ApprovalGate[] {
  return unique(actions).map((action) => ({
    action,
    riskLevel,
    required: true,
    reason: `Action ${action} crosses the ${riskLevel} governance boundary.`,
  }));
}

function scaleBudget(
  base: DecisionTable['missionProfiles'][string]['budgetPlan'],
  multiplier: number,
) {
  return {
    ...base,
    tokenBudget: Math.round(base.tokenBudget * multiplier),
    toolBudget: Math.max(1, Math.round(base.toolBudget * multiplier)),
  };
}

export function resolveCommanderDecision(
  context: DecisionContext,
  options: {
    tablePath?: string;
    forceReload?: boolean;
    decisionTable?: DecisionTable;
    routingWeightPatchPath?: string;
    baselineManifestPath?: string;
  } = {},
): CommanderDecision {
  const decisionTable = options.decisionTable ?? loadDecisionTable(options);
  const routingWeightPatch = loadRoutingWeightPatch({
    patchPath: options.routingWeightPatchPath,
    forceReload: options.forceReload,
  });
  const baselineManifest = loadBaselineAgentManifest({
    manifestPath: options.baselineManifestPath,
    forceReload: options.forceReload,
  });
  const {
    meta,
    arbitrationPriority,
    lineupCatalog,
    missionProfiles,
    overrideRules,
    riskPolicies,
    stopLossProfiles,
  } = decisionTable;

  const profile = missionProfiles[context.missionType];

  if (!profile) {
    throw new Error(`Unknown mission type: ${context.missionType}`);
  }

  const riskPolicy = riskPolicies[context.riskLevel];
  const stopLossRule = structuredClone(stopLossProfiles[profile.stopLossProfile]);

  let selectedLineups: LineupId[] = [...profile.baseLineups];
  let stagePlan: StagePlan[] = structuredClone(profile.stagePlan);
  let budgetPlan = scaleBudget(profile.budgetPlan, riskPolicy.budgetMultiplier);
  let approvalActions = [...profile.approvalActions, ...riskPolicy.approvalActions];
  const reasons = [
    `Base mission profile ${context.missionType} selected.`,
    `Risk policy ${context.riskLevel} applied.`,
  ];
  const appliedRuleIds: string[] = [];
  const matchedRuleIds: string[] = [];
  let requiresCommanderSupervision = riskPolicy.requiresCommanderSupervision;
  let requiresHumanReview = riskPolicy.requiresHumanReview;

  for (const rule of sortRules(overrideRules)) {
    if (rule.enabled === false) {
      recordRuleEvaluation(rule, {
        matched: false,
        applied: false,
        missionType: context.missionType,
      });
      continue;
    }

    const matched = matchesRule(rule.when, context as Record<string, unknown>);
    recordRuleEvaluation(rule, {
      matched,
      applied: matched,
      missionType: context.missionType,
    });

    if (!matched) {
      continue;
    }

    appliedRuleIds.push(rule.id);
    matchedRuleIds.push(rule.id);

    if (rule.effects.replaceLineups) {
      selectedLineups = [...rule.effects.replaceLineups];
    }

    if (rule.effects.prependLineups) {
      selectedLineups = [...rule.effects.prependLineups, ...selectedLineups];
    }

    if (rule.effects.appendLineups) {
      selectedLineups = [...selectedLineups, ...rule.effects.appendLineups];
    }

    if (rule.effects.replaceStagesFromMission) {
      stagePlan = structuredClone(
        missionProfiles[rule.effects.replaceStagesFromMission].stagePlan,
      );
    }

    if (rule.effects.prependStages) {
      stagePlan = [...structuredClone(rule.effects.prependStages), ...stagePlan];
    }

    if (rule.effects.appendStages) {
      stagePlan = [...stagePlan, ...structuredClone(rule.effects.appendStages)];
    }

    if (rule.effects.addApprovalActions) {
      approvalActions = [...approvalActions, ...rule.effects.addApprovalActions];
    }

    if (isPresent(rule.effects.budgetMultiplier)) {
      budgetPlan = scaleBudget(budgetPlan, rule.effects.budgetMultiplier);
    }

    if (isPresent(rule.effects.parallelismCap)) {
      budgetPlan.parallelismBudget = Math.min(
        budgetPlan.parallelismBudget,
        rule.effects.parallelismCap,
      );
    }

    if (rule.effects.forceCommanderSupervision) {
      requiresCommanderSupervision = true;
    }

    if (rule.effects.forceHumanReview) {
      requiresHumanReview = true;
    }

    reasons.push(...(rule.effects.reasons ?? []));
  }

  if (riskPolicy.parallelismCap !== null) {
    budgetPlan.parallelismBudget = Math.min(
      budgetPlan.parallelismBudget,
      riskPolicy.parallelismCap,
    );
  }

  if (isPresent(context.budgetCap)) {
    budgetPlan.toolBudget = Math.min(budgetPlan.toolBudget, context.budgetCap);
    reasons.push(`Tool budget capped by mission input at ${context.budgetCap}.`);
  }

  selectedLineups = unique(selectedLineups);
  const activeRoles = deriveActiveRoles(selectedLineups, lineupCatalog);
  const baselineAgentBindings = buildBaselineRoleBindings(activeRoles, baselineManifest);
  const roleWeightHints = buildRoleWeightHints(
    activeRoles.filter((roleId) => roleId !== 'commander' && roleId !== 'feedback'),
    routingWeightPatch,
  );
  const prioritizedActiveRoles = prioritizeActiveRoles(activeRoles, roleWeightHints);
  const stagePriorityHints = buildStagePriorityHints(stagePlan, roleWeightHints);
  const approvalPlan = toApprovalPlan(approvalActions, context.riskLevel);

  return {
    decisionVersion: meta.version,
    missionId: context.missionId,
    missionType: context.missionType,
    selectedLineups,
    activeRoles,
    baselineAgentBindings,
    roleWeightHints,
    prioritizedActiveRoles,
    stagePriorityHints,
    stagePlan,
    budgetPlan,
    approvalPlan,
    stopLossRule,
    arbitrationPriority,
    requiresCommanderSupervision,
    requiresHumanReview,
    reasons,
    appliedRuleIds,
    matchedRuleIds,
  };
}
