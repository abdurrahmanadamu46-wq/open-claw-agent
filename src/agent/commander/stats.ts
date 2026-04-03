import type { OverrideRule, RuleStat } from './types.js';

const ruleStats = new Map<string, RuleStat>();

export function recordRuleEvaluation(
  rule: OverrideRule,
  event: { matched: boolean; applied: boolean; missionType: string },
): void {
  const now = new Date().toISOString();
  const current: RuleStat = ruleStats.get(rule.id) ?? {
    ruleId: rule.id,
    priority: rule.priority ?? 100,
    weight: rule.weight ?? 1,
    enabled: rule.enabled !== false,
    tags: rule.tags ?? [],
    evaluatedCount: 0,
    matchedCount: 0,
    appliedCount: 0,
    lastMissionType: null,
    lastEvaluatedAt: null,
    lastMatchedAt: null,
    lastAppliedAt: null,
  };

  current.priority = rule.priority ?? current.priority;
  current.weight = rule.weight ?? current.weight;
  current.enabled = rule.enabled !== false;
  current.tags = rule.tags ?? current.tags;
  current.evaluatedCount += 1;
  current.lastMissionType = event.missionType;
  current.lastEvaluatedAt = now;

  if (event.matched) {
    current.matchedCount += 1;
    current.lastMatchedAt = now;
  }

  if (event.applied) {
    current.appliedCount += 1;
    current.lastAppliedAt = now;
  }

  ruleStats.set(rule.id, current);
}

export function getRuleStats(): RuleStat[] {
  return [...ruleStats.values()].sort((a, b) => {
    if (b.appliedCount !== a.appliedCount) {
      return b.appliedCount - a.appliedCount;
    }

    if (b.matchedCount !== a.matchedCount) {
      return b.matchedCount - a.matchedCount;
    }

    return b.priority - a.priority;
  });
}

export function resetRuleStats(): void {
  ruleStats.clear();
}
