export const visualizerSubproject = {
  roleId: 'visualizer',
  packageName: '@lobsterpool/lobster-visualizer',
  primaryArtifact: 'StoryboardPack',
  status: 'baseline-ready',
  baselineAgent: {
    agentId: 'visualizer-baseline-agent',
    agentMode: 'specialist',
    starterSkills: ['comfyui', 'controlnet', 'vibevoice'],
    defaultBridgeTarget: 'execute-campaign',
    defaultScopeId: 'internal_execute',
    defaultMissionTypes: ['content_production'],
    clawhubRequiredNow: false,
  },
} as const;
