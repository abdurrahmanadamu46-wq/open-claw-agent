import operatingModel from '../../../packages/lobsters/lobster-operating-model.json' with { type: 'json' };
import type {
  CommanderExecutableWorkflow,
  CommanderWorkflowStage,
  LineupId,
  MissionType,
  RoleId,
} from './types.js';

type WorkflowId =
  | 'wf_signal_scan'
  | 'wf_strategy_seed'
  | 'wf_topic_scoring'
  | 'wf_copy_compliance'
  | 'wf_visual_production'
  | 'wf_title_cover'
  | 'wf_cloud_archive'
  | 'wf_edge_publish'
  | 'wf_edge_inbox'
  | 'wf_interaction_triage'
  | 'wf_lead_scoring'
  | 'wf_conversion_push'
  | 'wf_high_score_call'
  | 'wf_reactivation'
  | 'wf_recovery_replay'
  | 'wf_weekly_review'
  | 'wf_complaint_guard'
  | 'wf_growth_retrofit';

type WorkflowDefinition = {
  category: CommanderExecutableWorkflow['category'];
  lineups: LineupId[];
  stages: CommanderWorkflowStage[];
};

const model = operatingModel as {
  roles: Array<{
    roleId: Exclude<RoleId, 'commander' | 'feedback'>;
    clawhubSkills: { required: string[]; recommended: string[] };
    localKnowledgeBases: string[];
  }>;
  workflowCatalog: Array<{
    workflowId: WorkflowId;
    label: string;
    roles: RoleId[];
    goal: string;
  }>;
};

const workflowDefinitions: Record<WorkflowId, WorkflowDefinition> = {
  wf_signal_scan: {
    category: 'intelligence',
    lineups: ['reconnaissance'],
    stages: [
      { stageId: 'scan', label: 'Scan signals', ownerRole: 'radar', missionType: 'signal_scan', bridgeTarget: 'brain-shadow-runner', approvalActions: [], outputs: ['signal_brief'] },
      { stageId: 'frame', label: 'Frame strategy seeds', ownerRole: 'strategist', missionType: 'strategy_design', bridgeTarget: 'brain-shadow-runner', approvalActions: [], outputs: ['scan_takeaways'] },
    ],
  },
  wf_strategy_seed: {
    category: 'strategy',
    lineups: ['reconnaissance'],
    stages: [
      { stageId: 'sense', label: 'Read inputs', ownerRole: 'radar', missionType: 'signal_scan', bridgeTarget: 'brain-shadow-runner', approvalActions: [], outputs: ['strategy_inputs'] },
      { stageId: 'route', label: 'Design route', ownerRole: 'strategist', missionType: 'strategy_design', bridgeTarget: 'brain-shadow-runner', approvalActions: [], outputs: ['strategy_route'] },
    ],
  },
  wf_topic_scoring: {
    category: 'strategy',
    lineups: ['reconnaissance', 'content'],
    stages: [
      { stageId: 'plan', label: 'Pick angles', ownerRole: 'strategist', missionType: 'strategy_design', bridgeTarget: 'brain-shadow-runner', approvalActions: [], outputs: ['topic_candidates'] },
      { stageId: 'score', label: 'Draft scoring hooks', ownerRole: 'inkwriter', missionType: 'content_production', bridgeTarget: 'brain-shadow-runner', approvalActions: [], outputs: ['topic_scores'] },
    ],
  },
  wf_copy_compliance: {
    category: 'content',
    lineups: ['content'],
    stages: [
      { stageId: 'draft', label: 'Draft copy', ownerRole: 'inkwriter', missionType: 'content_production', bridgeTarget: 'brain-shadow-runner', approvalActions: ['sensitive_claims'], outputs: ['copy_pack'] },
      { stageId: 'proof', label: 'Proof visuals', ownerRole: 'visualizer', missionType: 'content_production', bridgeTarget: 'execute-campaign', scopeId: 'internal_execute', approvalActions: ['publish_external'], outputs: ['storyboard_pack'] },
    ],
  },
  wf_visual_production: {
    category: 'content',
    lineups: ['content'],
    stages: [
      { stageId: 'storyboard', label: 'Plan storyboard', ownerRole: 'visualizer', missionType: 'content_production', bridgeTarget: 'execute-campaign', scopeId: 'internal_execute', approvalActions: [], outputs: ['scene_pack'] },
      { stageId: 'dispatch', label: 'Prepare execution plan', ownerRole: 'dispatcher', missionType: 'content_production', bridgeTarget: 'execute-campaign', scopeId: 'internal_execute', approvalActions: [], outputs: ['execution_plan'] },
    ],
  },
  wf_title_cover: {
    category: 'content',
    lineups: ['content'],
    stages: [
      { stageId: 'headline', label: 'Write title', ownerRole: 'inkwriter', missionType: 'content_production', bridgeTarget: 'brain-shadow-runner', approvalActions: [], outputs: ['title_pack'] },
      { stageId: 'cover', label: 'Compose cover', ownerRole: 'visualizer', missionType: 'content_production', bridgeTarget: 'execute-campaign', scopeId: 'internal_execute', approvalActions: [], outputs: ['cover_pack'] },
    ],
  },
  wf_cloud_archive: {
    category: 'runtime',
    lineups: ['content'],
    stages: [
      { stageId: 'archive', label: 'Archive cloud bundle', ownerRole: 'dispatcher', missionType: 'content_production', bridgeTarget: 'orchestrator-control', approvalActions: [], outputs: ['cloud_bundle'] },
    ],
  },
  wf_edge_publish: {
    category: 'runtime',
    lineups: ['content'],
    stages: [
      { stageId: 'publish', label: 'Dispatch edge publish', ownerRole: 'dispatcher', missionType: 'content_production', bridgeTarget: 'execute-campaign', scopeId: 'external_publish', approvalActions: ['publish_external'], outputs: ['publish_job'] },
    ],
  },
  wf_edge_inbox: {
    category: 'lead',
    lineups: ['interaction'],
    stages: [
      { stageId: 'reply', label: 'Bridge comment and DM', ownerRole: 'echoer', missionType: 'interaction_handling', bridgeTarget: 'brain-shadow-runner', approvalActions: ['price_commitment'], outputs: ['reply_pack'] },
      { stageId: 'qualify', label: 'Detect intent', ownerRole: 'catcher', missionType: 'lead_qualification', bridgeTarget: 'lead-ops-runner', approvalActions: [], outputs: ['lead_assessment'] },
    ],
  },
  wf_interaction_triage: {
    category: 'lead',
    lineups: ['interaction'],
    stages: [
      { stageId: 'triage', label: 'Triage interaction', ownerRole: 'echoer', missionType: 'interaction_handling', bridgeTarget: 'brain-shadow-runner', approvalActions: ['price_commitment'], outputs: ['engagement_reply_pack'] },
      { stageId: 'qualify', label: 'Classify lead', ownerRole: 'catcher', missionType: 'lead_qualification', bridgeTarget: 'lead-ops-runner', approvalActions: [], outputs: ['lead_assessment'] },
      { stageId: 'score', label: 'Score lead', ownerRole: 'abacus', missionType: 'lead_qualification', bridgeTarget: 'lead-ops-runner', approvalActions: [], outputs: ['value_score_card'] },
    ],
  },
  wf_lead_scoring: {
    category: 'lead',
    lineups: ['interaction'],
    stages: [
      { stageId: 'qualify', label: 'Gate lead', ownerRole: 'catcher', missionType: 'lead_qualification', bridgeTarget: 'lead-ops-runner', approvalActions: [], outputs: ['lead_assessment'] },
      { stageId: 'score', label: 'Assign business value', ownerRole: 'abacus', missionType: 'lead_qualification', bridgeTarget: 'lead-ops-runner', approvalActions: [], outputs: ['value_score_card'] },
    ],
  },
  wf_conversion_push: {
    category: 'conversion',
    lineups: ['conversion'],
    stages: [
      { stageId: 'score', label: 'Re-score lead', ownerRole: 'abacus', missionType: 'conversion_push', bridgeTarget: 'lead-ops-runner', approvalActions: [], outputs: ['conversion_score'] },
      { stageId: 'followup', label: 'Plan follow-up', ownerRole: 'followup', missionType: 'conversion_push', bridgeTarget: 'orchestrator-control', approvalActions: ['outbound_call'], outputs: ['followup_action_plan'] },
    ],
  },
  wf_high_score_call: {
    category: 'conversion',
    lineups: ['conversion'],
    stages: [
      { stageId: 'call', label: 'Request outbound call', ownerRole: 'followup', missionType: 'conversion_push', bridgeTarget: 'orchestrator-control', approvalActions: ['outbound_call', 'high_risk_customer_touchpoint'], outputs: ['voice_call_request'] },
    ],
  },
  wf_reactivation: {
    category: 'conversion',
    lineups: ['conversion'],
    stages: [
      { stageId: 'value', label: 'Review dormant value', ownerRole: 'abacus', missionType: 'review_evolution', bridgeTarget: 'lead-ops-runner', approvalActions: [], outputs: ['reactivation_score'] },
      { stageId: 'reactivate', label: 'Plan reactivation', ownerRole: 'followup', missionType: 'conversion_push', bridgeTarget: 'orchestrator-control', approvalActions: ['outbound_call'], outputs: ['reactivation_plan'] },
    ],
  },
  wf_recovery_replay: {
    category: 'recovery',
    lineups: ['recovery'],
    stages: [
      { stageId: 'diagnose', label: 'Diagnose failure', ownerRole: 'dispatcher', missionType: 'recovery_replay', bridgeTarget: 'execute-campaign', scopeId: 'internal_execute', approvalActions: [], outputs: ['failure_diagnosis'] },
      { stageId: 'repair', label: 'Repair execution', ownerRole: 'dispatcher', missionType: 'recovery_replay', bridgeTarget: 'execute-campaign', scopeId: 'internal_execute', approvalActions: [], outputs: ['repair_plan'] },
      { stageId: 'review', label: 'Write patch', ownerRole: 'feedback', missionType: 'review_evolution', bridgeTarget: 'orchestrator-control', approvalActions: [], outputs: ['playbook_patch'] },
    ],
  },
  wf_weekly_review: {
    category: 'review',
    lineups: ['review'],
    stages: [
      { stageId: 'scan', label: 'Read market delta', ownerRole: 'radar', missionType: 'signal_scan', bridgeTarget: 'brain-shadow-runner', approvalActions: [], outputs: ['weekly_signal_digest'] },
      { stageId: 'score', label: 'Review ROI', ownerRole: 'abacus', missionType: 'review_evolution', bridgeTarget: 'lead-ops-runner', approvalActions: [], outputs: ['weekly_value_review'] },
      { stageId: 'patch', label: 'Compile learning', ownerRole: 'feedback', missionType: 'review_evolution', bridgeTarget: 'orchestrator-control', approvalActions: [], outputs: ['weekly_patch'] },
    ],
  },
  wf_complaint_guard: {
    category: 'risk',
    lineups: ['interaction', 'conversion'],
    stages: [
      { stageId: 'stabilize', label: 'Stabilize emotion', ownerRole: 'echoer', missionType: 'interaction_handling', bridgeTarget: 'brain-shadow-runner', approvalActions: ['price_commitment'], outputs: ['deescalation_reply'] },
      { stageId: 'gate', label: 'Filter risk lead', ownerRole: 'catcher', missionType: 'lead_qualification', bridgeTarget: 'lead-ops-runner', approvalActions: [], outputs: ['risk_gate_result'] },
      { stageId: 'contain', label: 'Apply follow-up guard', ownerRole: 'followup', missionType: 'conversion_push', bridgeTarget: 'orchestrator-control', approvalActions: ['outbound_call'], outputs: ['complaint_containment_plan'] },
    ],
  },
  wf_growth_retrofit: {
    category: 'review',
    lineups: ['reconnaissance', 'review'],
    stages: [
      { stageId: 'route', label: 'Redesign route', ownerRole: 'strategist', missionType: 'strategy_design', bridgeTarget: 'brain-shadow-runner', approvalActions: [], outputs: ['retrofit_route'] },
      { stageId: 'score', label: 'Check business value', ownerRole: 'abacus', missionType: 'review_evolution', bridgeTarget: 'lead-ops-runner', approvalActions: [], outputs: ['retrofit_value_check'] },
      { stageId: 'patch', label: 'Freeze retrofit patch', ownerRole: 'feedback', missionType: 'review_evolution', bridgeTarget: 'orchestrator-control', approvalActions: [], outputs: ['retrofit_patch'] },
    ],
  },
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function roleMap() {
  return new Map(model.roles.map((role) => [role.roleId, role]));
}

export function listExecutableWorkflowCatalog(): CommanderExecutableWorkflow[] {
  const roles = roleMap();

  return model.workflowCatalog.map((workflow) => {
    const definition = workflowDefinitions[workflow.workflowId as WorkflowId];
    if (!definition) {
      throw new Error(`Missing executable definition for workflow ${workflow.workflowId}`);
    }

    const localKnowledgeBases = unique(
      workflow.roles.flatMap((roleId) => {
        if (roleId === 'commander' || roleId === 'feedback') {
          return [];
        }
        return roles.get(roleId)?.localKnowledgeBases ?? [];
      }),
    );

    const clawhubSkillHints = Object.fromEntries(
      workflow.roles
        .filter((roleId) => roleId !== 'commander' && roleId !== 'feedback')
        .map((roleId) => [roleId, roles.get(roleId)?.clawhubSkills.required ?? []]),
    );

    return {
      workflowId: workflow.workflowId,
      label: workflow.label,
      goal: workflow.goal,
      roles: workflow.roles,
      lineups: definition.lineups,
      category: definition.category,
      stages: definition.stages,
      localKnowledgeBases,
      clawhubSkillHints,
    };
  });
}

export function getExecutableWorkflowById(workflowId: string): CommanderExecutableWorkflow {
  const workflow = listExecutableWorkflowCatalog().find((item) => item.workflowId === workflowId);
  if (!workflow) {
    throw new Error(`Unknown workflowId: ${workflowId}`);
  }
  return workflow;
}
