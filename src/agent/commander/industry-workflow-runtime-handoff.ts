import {
  compileIndustryWorkflowBlueprint,
  type IndustryWorkflowBlueprint,
  type IndustryWorkflowRequest,
} from './industry-workflow.js';

export interface RuntimeHandoffFieldRequirement {
  fieldPath: string;
  required: boolean;
  source: 'main_framework_form' | 'main_framework_context' | 'runtime_generated' | 'edge_runtime';
  note: string;
  example?: string;
}

export interface RuntimeHandoffStepContract {
  stepNumber: number;
  stepId: string;
  label: string;
  workflowId: string;
  workflowStageId: string;
  ownerRole: string;
  missionType: string;
  bridgeTarget: string;
  scopeId?: string;
  dispatchStrategy:
    | 'call_execute_campaign_task'
    | 'invoke_brain_shadow_runner'
    | 'invoke_lead_ops_runner'
    | 'skip_structural_stage';
  approvalRequired: boolean;
  approvalActions: string[];
  requiredMainFrameworkFields: RuntimeHandoffFieldRequirement[];
  payloadTemplate: Record<string, unknown>;
  feedbackSignals: string[];
}

export interface IndustryWorkflowRuntimeHandoffBundle {
  handoffVersion: string;
  generatedAt: string;
  workflowId: string;
  industry: IndustryWorkflowBlueprint['industry'];
  runtimeSteps: RuntimeHandoffStepContract[];
}

function dispatchStrategyForTarget(target: string): RuntimeHandoffStepContract['dispatchStrategy'] {
  switch (target) {
    case 'execute-campaign':
      return 'call_execute_campaign_task';
    case 'lead-ops-runner':
      return 'invoke_lead_ops_runner';
    case 'brain-shadow-runner':
      return 'invoke_brain_shadow_runner';
    default:
      return 'skip_structural_stage';
  }
}

function requirementsForStep(stepId: string): RuntimeHandoffFieldRequirement[] {
  switch (stepId) {
    case 'edge_publish_dispatch':
      return [
        {
          fieldPath: 'merchantProfile.tenantId',
          required: true,
          source: 'main_framework_form',
          note: 'Used to build the execute-campaign payload and content bundle path.',
          example: 'tenant_demo',
        },
        {
          fieldPath: 'merchantProfile.bindAccounts[]',
          required: true,
          source: 'main_framework_form',
          note: 'Edge account binding is required for actual publish dispatch.',
          example: 'edge-account-01',
        },
        {
          fieldPath: 'channels[]',
          required: false,
          source: 'main_framework_form',
          note: 'If omitted, runtime falls back to industry defaults.',
          example: 'douyin',
        },
        {
          fieldPath: 'runtime.edgeAccountId',
          required: true,
          source: 'main_framework_context',
          note: 'Replace the placeholder edge account id before submit.',
          example: 'edge-account-prod-01',
        },
        {
          fieldPath: 'runtime.leadOpsWebhook',
          required: true,
          source: 'main_framework_context',
          note: 'Webhook used by edge publish jobs to feed comment/DM events back to cloud.',
          example: 'https://backend.example.com/internal/lead-ops/webhook',
        },
      ];
    case 'edge_inbox_monitor':
      return [
        {
          fieldPath: 'merchantProfile.bindAccounts[]',
          required: true,
          source: 'main_framework_form',
          note: 'Edge inbox monitoring requires at least one active account binding.',
          example: 'edge-account-01',
        },
        {
          fieldPath: 'runtime.edgeAccountConsoleUrl',
          required: true,
          source: 'main_framework_context',
          note: 'Used to replace the placeholder console navigation URL.',
          example: 'https://edge-node.local/console',
        },
      ];
    case 'lead_scoring':
      return [
        {
          fieldPath: 'runtime.edgeInteractionEvent.contact',
          required: true,
          source: 'edge_runtime',
          note: 'Contact payload from DM/comment monitoring is required to create lead_submission.',
          example: 'wechat:demo-contact',
        },
        {
          fieldPath: 'runtime.edgeInteractionEvent.score',
          required: true,
          source: 'edge_runtime',
          note: 'Main framework should pass through the computed lead score or let runtime fill it after evaluation.',
          example: '88',
        },
        {
          fieldPath: 'runtime.edgeInteractionEvent.rawContext',
          required: true,
          source: 'edge_runtime',
          note: 'Raw event snapshot should be preserved for scoring traceability.',
          example: '{\"channel\":\"dm\",\"message\":\"想预约\"}',
        },
      ];
    case 'high_score_call':
      return [
        {
          fieldPath: 'callScoreThreshold',
          required: false,
          source: 'main_framework_form',
          note: 'If omitted, compiler uses default threshold 85.',
          example: '88',
        },
        {
          fieldPath: 'runtime.followupQueueRef',
          required: true,
          source: 'main_framework_context',
          note: 'Reference to the scored lead queue that feeds outbound call orchestration.',
          example: 'lead-score-queue:tenant_demo',
        },
      ];
    default:
      return [];
  }
}

export function buildIndustryWorkflowRuntimeHandoffBundle(
  request: IndustryWorkflowRequest,
): IndustryWorkflowRuntimeHandoffBundle {
  const blueprint = compileIndustryWorkflowBlueprint(request);
  const runtimeSteps = blueprint.businessSteps
    .filter((step) => step.stepNumber >= 8)
    .map((step) => ({
      stepNumber: step.stepNumber,
      stepId: step.stepId,
      label: step.label,
      workflowId: step.workflowRef.workflowId,
      workflowStageId: step.workflowRef.workflowStageId,
      ownerRole: step.ownerRole,
      missionType: step.missionType,
      bridgeTarget: step.runtimeAction.bridgeTarget,
      scopeId: step.runtimeAction.scopeId,
      dispatchStrategy: dispatchStrategyForTarget(step.runtimeAction.bridgeTarget),
      approvalRequired: step.approval.required,
      approvalActions: step.approval.actions,
      requiredMainFrameworkFields: requirementsForStep(step.stepId),
      payloadTemplate: step.runtimeAction.payloadTemplate,
      feedbackSignals: step.runtimeAction.feedbackSignals,
    }));

  return {
    handoffVersion: 'lobster.industry-runtime-handoff.v0.1',
    generatedAt: new Date().toISOString(),
    workflowId: blueprint.workflowId,
    industry: blueprint.industry,
    runtimeSteps,
  };
}
