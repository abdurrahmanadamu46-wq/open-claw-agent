export const echoerSubproject = {
  roleId: 'echoer',
  packageName: '@lobsterpool/lobster-echoer',
  primaryArtifact: 'EngagementReplyPack',
  status: 'baseline-ready',
  baselineAgent: {
    agentId: 'echoer-baseline-agent',
    agentMode: 'specialist',
    starterSkills: ['humanizer', 'policy-lexicon', 'ab-test'],
    defaultBridgeTarget: 'brain-shadow-runner',
    defaultMissionTypes: ['interaction_handling'],
    clawhubRequiredNow: false,
  },
} as const;
