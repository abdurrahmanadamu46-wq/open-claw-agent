export const catcherSubproject = {
  roleId: 'catcher',
  packageName: '@lobsterpool/lobster-catcher',
  primaryArtifact: 'LeadAssessment',
  status: 'baseline-ready',
  baselineAgent: {
    agentId: 'catcher-baseline-agent',
    agentMode: 'specialist',
    starterSkills: ['ontology', 'regex-router', 'lead-gate'],
    defaultBridgeTarget: 'lead-ops-runner',
    defaultMissionTypes: ['interaction_handling', 'lead_qualification', 'conversion_push'],
    clawhubRequiredNow: false,
  },
} as const;
