import type { CommanderDecision, DecisionContext, SimulationReport } from './types.js';
import { getDecisionTableInfo } from './table.js';
import { resolveCommanderDecision } from './engine.js';
import { getRuleStats, resetRuleStats } from './stats.js';
import { simulationMissionBatch } from './scenarios.js';

function incrementMany(bucket: Record<string, number>, keys: string[]): void {
  for (const key of keys) {
    bucket[key] = (bucket[key] ?? 0) + 1;
  }
}

function summarizeDecisions(decisions: CommanderDecision[]) {
  const lineupUsage: Record<string, number> = {};
  const roleUsage: Record<string, number> = {};
  const missionTypeBreakdown: Record<string, number> = {};
  const riskBreakdown: Record<string, number> = {};
  const approvalActionUsage: Record<string, number> = {};

  let totalTokenBudget = 0;
  let totalToolBudget = 0;
  let totalLatencyBudgetSec = 0;
  let supervisedMissionCount = 0;
  let humanReviewMissionCount = 0;

  for (const decision of decisions) {
    missionTypeBreakdown[decision.missionType] =
      (missionTypeBreakdown[decision.missionType] ?? 0) + 1;
    incrementMany(lineupUsage, decision.selectedLineups);
    incrementMany(roleUsage, decision.activeRoles);
    incrementMany(
      approvalActionUsage,
      decision.approvalPlan.map((item) => item.action),
    );

    const riskKey = decision.requiresHumanReview ? 'human_review' : 'auto_or_supervised';
    riskBreakdown[riskKey] = (riskBreakdown[riskKey] ?? 0) + 1;

    totalTokenBudget += decision.budgetPlan.tokenBudget;
    totalToolBudget += decision.budgetPlan.toolBudget;
    totalLatencyBudgetSec += decision.budgetPlan.latencyBudgetSec;

    if (decision.requiresCommanderSupervision) {
      supervisedMissionCount += 1;
    }

    if (decision.requiresHumanReview) {
      humanReviewMissionCount += 1;
    }
  }

  const missionCount = decisions.length || 1;

  return {
    missionCount: decisions.length,
    missionTypeBreakdown,
    lineupUsage,
    roleUsage,
    approvalActionUsage,
    riskBreakdown,
    supervisionRate: supervisedMissionCount / missionCount,
    humanReviewRate: humanReviewMissionCount / missionCount,
    averageBudgets: {
      tokenBudget: Math.round(totalTokenBudget / missionCount),
      toolBudget: Number((totalToolBudget / missionCount).toFixed(2)),
      latencyBudgetSec: Math.round(totalLatencyBudgetSec / missionCount),
    },
  };
}

export function runMissionBatchSimulation(options: {
  missions?: DecisionContext[];
  tablePath?: string;
  forceReload?: boolean;
} = {}): SimulationReport {
  const missions = options.missions ?? simulationMissionBatch;
  resetRuleStats();

  const decisions = missions.map((mission) =>
    resolveCommanderDecision(mission, {
      tablePath: options.tablePath,
      forceReload: options.forceReload,
    }),
  );

  return {
    simulationVersion: 'commander.simulation.v0.1',
    decisionTable: getDecisionTableInfo(),
    summary: summarizeDecisions(decisions),
    ruleStats: getRuleStats(),
    decisions,
  };
}
