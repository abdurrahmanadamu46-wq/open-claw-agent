export const realisticScenarios = [
  {
    name: "Dental clinic content acquisition sprint",
    input: {
      missionId: "mis_dental_001",
      missionType: "content_production",
      riskLevel: "L2",
      latencyPriority: "normal",
      revenueImpact: "high",
      evidenceSufficiency: "medium",
      requiresExternalAction: true,
      recentFailureCount: 0,
      tags: ["douyin", "healthcare", "campaign"]
    }
  },
  {
    name: "Hot comment surge with warm high-value leads",
    input: {
      missionId: "mis_hot_002",
      missionType: "interaction_handling",
      riskLevel: "L2",
      latencyPriority: "urgent",
      revenueImpact: "strategic",
      evidenceSufficiency: "high",
      hasWarmLead: true,
      requiresHumanTouchpoint: false,
      recentFailureCount: 0,
      tags: ["comment-burst", "warm-leads"]
    }
  },
  {
    name: "Follow-up pipeline under external instability",
    input: {
      missionId: "mis_followup_003",
      missionType: "conversion_push",
      riskLevel: "L3",
      latencyPriority: "high",
      revenueImpact: "high",
      evidenceSufficiency: "low",
      requiresHumanTouchpoint: true,
      externalDependencyUnstable: true,
      recentFailureCount: 2,
      budgetCap: 5,
      tags: ["voice-call", "critical-lead"]
    }
  }
];
