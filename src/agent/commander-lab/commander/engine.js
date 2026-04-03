import { loadDecisionTable } from "./table.js";
import { recordRuleEvaluation } from "./stats.js";

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPresent(value) {
  return value !== undefined && value !== null;
}

/**
 * @param {any[]} values
 * @returns {any[]}
 */
function unique(values) {
  return [...new Set(values)];
}

/**
 * @param {Record<string, any>} when
 * @param {Record<string, any>} context
 * @returns {boolean}
 */
function matchesRule(when, context) {
  return Object.entries(when).every(([key, expected]) => {
    if (key === "recentFailureCountAtLeast") {
      return (context.recentFailureCount ?? 0) >= expected;
    }

    const actual = context[key];

    if (Array.isArray(expected)) {
      return expected.includes(actual);
    }

    return actual === expected;
  });
}

/**
 * @param {Record<string, any>[]} rules
 * @returns {Record<string, any>[]}
 */
function sortRules(rules) {
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

/**
 * @param {string[]} selectedLineups
 * @param {Record<string, any>} lineupCatalog
 * @returns {string[]}
 */
function deriveActiveRoles(selectedLineups, lineupCatalog) {
  return unique(
    selectedLineups.flatMap((lineupId) => lineupCatalog[lineupId]?.roles ?? [])
  );
}

/**
 * @param {string[]} actions
 * @param {string} riskLevel
 * @returns {import("./types.js").ApprovalGate[]}
 */
function toApprovalPlan(actions, riskLevel) {
  return unique(actions).map((action) => ({
    action,
    riskLevel,
    required: true,
    reason: `Action ${action} crosses the ${riskLevel} governance boundary.`
  }));
}

/**
 * @param {Record<string, any>} base
 * @param {number} multiplier
 * @returns {Record<string, any>}
 */
function scaleBudget(base, multiplier) {
  return {
    ...base,
    tokenBudget: Math.round(base.tokenBudget * multiplier),
    toolBudget: Math.max(1, Math.round(base.toolBudget * multiplier))
  };
}

/**
 * @param {import("./types.js").DecisionContext} context
 * @param {{ tablePath?: string, forceReload?: boolean, decisionTable?: Record<string, any> }} [options]
 * @returns {import("./types.js").CommanderDecision}
 */
export function resolveCommanderDecision(context, options = {}) {
  const decisionTable = options.decisionTable ?? loadDecisionTable(options);
  const {
    meta,
    arbitrationPriority,
    lineupCatalog,
    missionProfiles,
    overrideRules,
    riskPolicies,
    stopLossProfiles
  } = decisionTable;
  const profile = missionProfiles[context.missionType];

  if (!profile) {
    throw new Error(`Unknown mission type: ${context.missionType}`);
  }

  const riskPolicy = riskPolicies[context.riskLevel];
  const stopLossRule = structuredClone(stopLossProfiles[profile.stopLossProfile]);

  let selectedLineups = [...profile.baseLineups];
  let stagePlan = structuredClone(profile.stagePlan);
  let budgetPlan = scaleBudget(profile.budgetPlan, riskPolicy.budgetMultiplier);
  let approvalActions = [...profile.approvalActions, ...riskPolicy.approvalActions];
  let reasons = [
    `Base mission profile ${context.missionType} selected.`,
    `Risk policy ${context.riskLevel} applied.`
  ];
  let appliedRuleIds = [];
  let matchedRuleIds = [];
  let requiresCommanderSupervision = riskPolicy.requiresCommanderSupervision;
  let requiresHumanReview = riskPolicy.requiresHumanReview;

  for (const rule of sortRules(overrideRules)) {
    if (rule.enabled === false) {
      recordRuleEvaluation(rule, {
        matched: false,
        applied: false,
        missionType: context.missionType
      });
      continue;
    }

    const matched = matchesRule(rule.when, context);

    recordRuleEvaluation(rule, {
      matched,
      applied: matched,
      missionType: context.missionType
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
        missionProfiles[rule.effects.replaceStagesFromMission].stagePlan
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
        rule.effects.parallelismCap
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
      riskPolicy.parallelismCap
    );
  }

  if (isPresent(context.budgetCap)) {
    budgetPlan.toolBudget = Math.min(budgetPlan.toolBudget, context.budgetCap);
    reasons.push(`Tool budget capped by mission input at ${context.budgetCap}.`);
  }

  selectedLineups = unique(selectedLineups);
  const activeRoles = deriveActiveRoles(selectedLineups, lineupCatalog);
  const approvalPlan = toApprovalPlan(approvalActions, context.riskLevel);

  return {
    decisionVersion: meta.version,
    missionId: context.missionId,
    missionType: context.missionType,
    selectedLineups,
    activeRoles,
    stagePlan,
    budgetPlan,
    approvalPlan,
    stopLossRule,
    arbitrationPriority,
    requiresCommanderSupervision,
    requiresHumanReview,
    reasons,
    appliedRuleIds,
    matchedRuleIds
  };
}
