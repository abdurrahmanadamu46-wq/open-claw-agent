export const dispatcherSubproject = {
  roleId: 'dispatcher',
  packageName: '@lobsterpool/lobster-dispatcher',
  primaryArtifact: 'ExecutionPlan',
  status: 'baseline-ready',
  baselineAgent: {
    agentId: 'dispatcher-baseline-agent',
    agentMode: 'orchestrator-specialist',
    starterSkills: ['clawteam', 'wss-hub', 'task-replay'],
    defaultBridgeTarget: 'execute-campaign',
    defaultScopeId: 'internal_execute',
    defaultMissionTypes: ['content_production', 'recovery_replay'],
    clawhubRequiredNow: false,
  },
} as const;
