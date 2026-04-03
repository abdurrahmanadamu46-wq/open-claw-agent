export const inkwriterSubproject = {
  roleId: 'inkwriter',
  packageName: '@lobsterpool/lobster-inkwriter',
  primaryArtifact: 'CopyPack',
  status: 'baseline-ready',
  baselineAgent: {
    agentId: 'inkwriter-baseline-agent',
    agentMode: 'specialist',
    starterSkills: ['humanizer', 'summarize', 'template-map'],
    defaultBridgeTarget: 'brain-shadow-runner',
    defaultMissionTypes: ['content_production'],
    clawhubRequiredNow: false,
  },
} as const;
