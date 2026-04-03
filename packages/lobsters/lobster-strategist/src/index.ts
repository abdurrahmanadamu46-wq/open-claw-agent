export const strategistSubproject = {
  roleId: 'strategist',
  packageName: '@lobsterpool/lobster-strategist',
  primaryArtifact: 'StrategyRoute',
  status: 'baseline-ready',
  baselineAgent: {
    agentId: 'strategist-baseline-agent',
    agentMode: 'specialist',
    starterSkills: ['self-improving-agent', 'ontology', 'proactive-agent'],
    defaultBridgeTarget: 'brain-shadow-runner',
    defaultMissionTypes: ['strategy_design'],
    clawhubRequiredNow: false,
  },
} as const;
