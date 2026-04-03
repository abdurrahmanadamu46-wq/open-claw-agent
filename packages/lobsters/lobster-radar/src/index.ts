export const radarSubproject = {
  roleId: 'radar',
  packageName: '@lobsterpool/lobster-radar',
  primaryArtifact: 'SignalBrief',
  status: 'baseline-ready',
  baselineAgent: {
    agentId: 'radar-baseline-agent',
    agentMode: 'specialist',
    starterSkills: ['agent-browser', 'summarize', 'ontology'],
    defaultBridgeTarget: 'brain-shadow-runner',
    defaultMissionTypes: ['signal_scan'],
    clawhubRequiredNow: false,
  },
} as const;
