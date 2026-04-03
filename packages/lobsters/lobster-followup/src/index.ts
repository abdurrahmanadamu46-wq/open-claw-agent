export const followupSubproject = {
  roleId: 'followup',
  packageName: '@lobsterpool/lobster-followup',
  primaryArtifact: 'FollowUpActionPlan',
  status: 'baseline-ready',
  baselineAgent: {
    agentId: 'followup-baseline-agent',
    agentMode: 'specialist',
    starterSkills: ['voice-call', 'deterministic-spawn', 'hitl-approval'],
    defaultBridgeTarget: 'orchestrator-control',
    defaultMissionTypes: ['conversion_push'],
    clawhubRequiredNow: false,
  },
} as const;
