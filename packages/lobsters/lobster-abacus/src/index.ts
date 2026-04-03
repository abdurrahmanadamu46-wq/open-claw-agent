export const abacusSubproject = {
  roleId: 'abacus',
  packageName: '@lobsterpool/lobster-abacus',
  primaryArtifact: 'ValueScoreCard',
  status: 'baseline-ready',
  baselineAgent: {
    agentId: 'abacus-baseline-agent',
    agentMode: 'specialist',
    starterSkills: ['lead-scoring', 'webhook', 'multi-objective-bandit'],
    defaultBridgeTarget: 'lead-ops-runner',
    defaultMissionTypes: ['interaction_handling', 'lead_qualification', 'review_evolution'],
    clawhubRequiredNow: false,
  },
} as const;
