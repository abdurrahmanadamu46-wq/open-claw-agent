import type {
  IndustryWorkflowFrontendPreview,
  IndustryWorkflowFrontendPreviewStepCard,
  WorkflowLaneId,
} from '@/data/workflow-board-mock';
import {
  buildIndustryWorkflowRequest,
  getIndustryCategoryOption,
  type IndustryWorkflowBlueprint,
  type IndustryWorkflowRequest,
} from '@/lib/industry-workflow';

type WorkflowOwnerBinding = {
  roleId: string;
  baselineAgentId: string;
  starterSkills?: string[];
  defaultBridgeTarget?: string | null;
  defaultScopeId?: string | null;
  primaryArtifact?: string | null;
};

type WorkflowBusinessStep = {
  stepNumber: number;
  stepId: string;
  label: string;
  goal: string;
  workflowRef?: {
    workflowId?: string;
    workflowCategory?: string;
    workflowStageId?: string;
  };
  ownerRole: string;
  ownerBaselineAgent?: WorkflowOwnerBinding | null;
  supportRoles?: string[];
  supportBaselineAgents?: WorkflowOwnerBinding[];
  missionType?: string;
  outputs?: string[];
  approval?: {
    required?: boolean;
    actions?: string[];
    note?: string;
  };
  runtimeAction?: {
    bridgeTarget?: string;
    scopeId?: string | null;
    operation?: string;
    feedbackSignals?: string[];
  };
};

type WorkflowBlueprintRuntimeShape = IndustryWorkflowBlueprint & {
  baselineAgentBindings?: WorkflowOwnerBinding[];
  businessSteps?: WorkflowBusinessStep[];
};

const LANE_ORDER: WorkflowLaneId[] = [
  'strategy',
  'content',
  'runtime',
  'lead',
  'conversion',
  'review',
  'risk',
];

const LANE_LABELS: Record<WorkflowLaneId, string> = {
  strategy: 'Strategy',
  content: 'Content',
  runtime: 'Runtime',
  lead: 'Lead',
  conversion: 'Conversion',
  review: 'Review',
  risk: 'Risk',
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((item) => String(item ?? '').trim()).filter(Boolean)));
}

function toRuntimeBlueprint(blueprint: IndustryWorkflowBlueprint): WorkflowBlueprintRuntimeShape {
  return blueprint as WorkflowBlueprintRuntimeShape;
}

function toLaneId(step: WorkflowBusinessStep): WorkflowLaneId {
  const category = String(step.workflowRef?.workflowCategory ?? '').trim().toLowerCase();
  if (category === 'strategy') return 'strategy';
  if (category === 'content') return 'content';
  if (category === 'runtime') return 'runtime';
  if (category === 'lead') return 'lead';
  if (category === 'conversion') return 'conversion';
  if (category === 'review') return 'review';
  if (category === 'risk') return 'risk';

  const bridgeTarget = String(step.runtimeAction?.bridgeTarget ?? '').trim().toLowerCase();
  if (bridgeTarget === 'execute-campaign') return 'runtime';
  if (bridgeTarget === 'lead-ops-runner') return 'lead';
  if (bridgeTarget === 'orchestrator-control') return 'conversion';
  return 'review';
}

function toSurface(
  laneId: WorkflowLaneId,
  approvalRequired: boolean,
  bridgeTarget: string,
  scopeId: string | null,
): IndustryWorkflowFrontendPreviewStepCard['surface'] {
  if (laneId === 'runtime' || bridgeTarget === 'execute-campaign' || scopeId === 'internal_execute') return 'edge';
  if (laneId === 'lead') return 'lead';
  if (laneId === 'conversion') return 'followup';
  if (approvalRequired || laneId === 'review' || laneId === 'risk') return 'approval';
  return 'cloud';
}

function toReadinessState(
  laneId: WorkflowLaneId,
  approvalRequired: boolean,
  surface: IndustryWorkflowFrontendPreviewStepCard['surface'],
): IndustryWorkflowFrontendPreviewStepCard['readinessState'] {
  if (laneId === 'risk') return 'blocked';
  if (approvalRequired) return 'approval_pending';
  if (surface === 'edge' || laneId === 'review') return 'watch';
  return 'ready';
}

function buildBadges(
  laneId: WorkflowLaneId,
  surface: IndustryWorkflowFrontendPreviewStepCard['surface'],
  approvalRequired: boolean,
): string[] {
  return uniqueStrings([
    LANE_LABELS[laneId],
    surface === 'edge' ? 'Edge execution' : null,
    surface === 'followup' ? 'Customer touchpoint' : null,
    approvalRequired ? 'Approval required' : null,
  ]);
}

function buildPayloadGaps(step: WorkflowBusinessStep): IndustryWorkflowFrontendPreviewStepCard['payloadGaps'] {
  const approvalActions = step.approval?.actions ?? [];
  if (!step.approval?.required || approvalActions.length === 0) return [];

  return approvalActions.slice(0, 3).map((action) => ({
    fieldPath: `approval.${action}`,
    source: 'governance_gate',
    required: true,
    note: step.approval?.note || `This step includes ${action} and must pass governance approval first.`,
  }));
}

function buildOperatorChecklist(step: WorkflowBusinessStep, bridgeTarget: string, primaryOutput: string | null): string[] {
  const outputs = Array.isArray(step.outputs) ? step.outputs : [];
  const feedbackSignals = Array.isArray(step.runtimeAction?.feedbackSignals)
    ? step.runtimeAction.feedbackSignals
    : [];
  return uniqueStrings([
    primaryOutput ? `Confirm primary output: ${primaryOutput}` : null,
    outputs[1] ? `Check supporting output: ${outputs[1]}` : null,
    `Verify bridge target: ${bridgeTarget}`,
    feedbackSignals[0] ? `Watch feedback signal: ${feedbackSignals[0]}` : null,
  ]).slice(0, 4);
}

function buildSuggestedCommands(step: WorkflowBusinessStep, bridgeTarget: string): string[] {
  return uniqueStrings([
    `Open step ${step.stepId}`,
    step.runtimeAction?.operation ? `Inspect ${step.runtimeAction.operation} payload` : null,
    bridgeTarget === 'execute-campaign' ? 'Open execution monitor' : `Inspect ${bridgeTarget} route`,
    step.approval?.required ? 'Open approvals center' : null,
  ]).slice(0, 4);
}

function buildBaselineAgentSummary(blueprint: WorkflowBlueprintRuntimeShape): IndustryWorkflowFrontendPreview['baselineAgentSummary'] {
  const explicitBindings = Array.isArray(blueprint.baselineAgentBindings) ? blueprint.baselineAgentBindings : [];
  if (explicitBindings.length > 0) {
    return explicitBindings.map((binding) => ({
      roleId: binding.roleId,
      baselineAgentId: binding.baselineAgentId,
      defaultBridgeTarget: binding.defaultBridgeTarget ?? null,
      defaultScopeId: binding.defaultScopeId ?? null,
      starterSkills: binding.starterSkills ?? [],
    }));
  }

  const byRole = new Map<string, WorkflowOwnerBinding>();
  const steps = (Array.isArray(blueprint.businessSteps) ? blueprint.businessSteps : []) as WorkflowBusinessStep[];
  for (const step of steps) {
    if (step.ownerBaselineAgent?.roleId) {
      byRole.set(step.ownerBaselineAgent.roleId, step.ownerBaselineAgent);
    }
    for (const support of step.supportBaselineAgents ?? []) {
      if (support?.roleId) byRole.set(support.roleId, support);
    }
  }

  return Array.from(byRole.values()).map((binding) => ({
    roleId: binding.roleId,
    baselineAgentId: binding.baselineAgentId,
    defaultBridgeTarget: binding.defaultBridgeTarget ?? null,
    defaultScopeId: binding.defaultScopeId ?? null,
    starterSkills: binding.starterSkills ?? [],
  }));
}

function buildLaneSummary(stepCards: IndustryWorkflowFrontendPreviewStepCard[]) {
  const ownerCounter = new Map<string, number>();
  for (const card of stepCards) {
    ownerCounter.set(card.ownerRole, (ownerCounter.get(card.ownerRole) || 0) + 1);
  }

  return {
    approvalCount: stepCards.filter((card) => card.approvalRequired).length,
    runtimeCount: stepCards.filter((card) => card.surface === 'edge').length,
    liveFacingCount: stepCards.filter((card) => ['edge', 'lead', 'followup'].includes(card.surface)).length,
    topOwners: Array.from(ownerCounter.entries()).map(([roleId, count]) => ({ roleId, count })),
    primaryActions: uniqueStrings(stepCards.flatMap((card) => card.approvalActions)).slice(0, 4),
    nextAttention: stepCards.filter((card) => card.readinessState !== 'ready').map((card) => card.title).slice(0, 3),
  };
}

export function buildWorkflowBoardPreviewFromBlueprint(
  blueprint: IndustryWorkflowBlueprint,
): IndustryWorkflowFrontendPreview {
  const runtimeBlueprint = toRuntimeBlueprint(blueprint);
  const baselineAgentSummary = buildBaselineAgentSummary(runtimeBlueprint);
  const businessSteps = (Array.isArray(runtimeBlueprint.businessSteps) ? runtimeBlueprint.businessSteps : []) as WorkflowBusinessStep[];

  const stepCards = businessSteps.map((step, index, allSteps) => {
    const laneId = toLaneId(step);
    const ownerBaselineAgent = step.ownerBaselineAgent ?? null;
    const bridgeTarget = String(
      step.runtimeAction?.bridgeTarget ?? ownerBaselineAgent?.defaultBridgeTarget ?? 'brain-shadow-runner',
    );
    const scopeId = step.runtimeAction?.scopeId ?? ownerBaselineAgent?.defaultScopeId ?? null;
    const primaryOutput = step.outputs?.[0] ?? ownerBaselineAgent?.primaryArtifact ?? null;
    const approvalRequired = Boolean(step.approval?.required);
    const surface = toSurface(laneId, approvalRequired, bridgeTarget, scopeId);
    const readinessState = toReadinessState(laneId, approvalRequired, surface);
    const nextStep = allSteps[index + 1] as WorkflowBusinessStep | undefined;

    return {
      stepNumber: step.stepNumber,
      stepId: step.stepId,
      workflowId: blueprint.workflowId,
      workflowStageId: step.workflowRef?.workflowStageId ?? step.stepId,
      workflowCategory: laneId,
      title: step.label,
      goal: step.goal,
      ownerRole: step.ownerRole,
      ownerAgentId: ownerBaselineAgent?.baselineAgentId ?? null,
      ownerStarterSkills: ownerBaselineAgent?.starterSkills ?? [],
      supportAgents: (step.supportBaselineAgents ?? []).map((item: WorkflowOwnerBinding) => ({
        roleId: item.roleId,
        baselineAgentId: item.baselineAgentId,
      })),
      missionType: step.missionType ?? step.runtimeAction?.operation ?? laneId,
      bridgeTarget,
      scopeId,
      surface,
      badges: buildBadges(laneId, surface, approvalRequired),
      readinessState,
      blockedReason:
        readinessState === 'blocked'
          ? step.approval?.note ?? 'This step is still blocked by a launch gate.'
          : null,
      operatorChecklist: buildOperatorChecklist(step, bridgeTarget, primaryOutput),
      payloadGaps: buildPayloadGaps(step),
      suggestedCommands: buildSuggestedCommands(step, bridgeTarget),
      handoffTargets: nextStep ? [nextStep.stepId] : [],
      rollbackHint: approvalRequired
        ? 'If approval is rejected, roll back to the previous stage and narrow the risky action.'
        : surface === 'edge'
          ? 'If edge execution fails, roll back to execution monitoring and inspect node health.'
          : 'If results drift, roll back to the previous stage and re-route the plan.',
      approvalRequired,
      approvalActions: step.approval?.actions ?? [],
      primaryOutput,
    };
  });

  return {
    version: `${blueprint.blueprintVersion}.board.v1`,
    generatedAt: blueprint.generatedAt,
    header: {
      workflowId: blueprint.workflowId,
      industryLabel: `${blueprint.industry.categoryLabel} / ${blueprint.industry.subIndustryLabel}`,
      brandName: blueprint.merchantDigest.brandName,
      channels: blueprint.channels,
      totalSteps: stepCards.length,
      runtimeStepCount: stepCards.filter((card) => card.surface === 'edge').length,
      approvalStepCount: stepCards.filter((card) => card.approvalRequired).length,
      gatedStepCount: stepCards.filter((card) => card.readinessState === 'blocked' || card.readinessState === 'approval_pending').length,
    },
    highlights: {
      topicRubricCount: blueprint.topicScoringRubric.length,
      cloudOutputCount: blueprint.cloudOutputs.length,
      edgeOutputCount: blueprint.edgeOutputs.length,
      baselineAgentCount: baselineAgentSummary.length,
    },
    stepCards,
    runtimeCards: stepCards.filter((card) => card.surface === 'edge'),
    approvalCards: stepCards.filter((card) => card.approvalRequired),
    workflowLanes: LANE_ORDER.map((laneId) => {
      const laneStepCards = stepCards.filter((card) => card.workflowCategory === laneId);
      return {
        laneId,
        label: LANE_LABELS[laneId],
        stepCount: laneStepCards.length,
        summary: buildLaneSummary(laneStepCards),
        laneBadges: uniqueStrings(laneStepCards.flatMap((card) => card.badges)).slice(0, 4),
        stepCards: laneStepCards,
      };
    }),
    baselineAgentSummary,
  };
}

export function buildDefaultWorkflowBoardRequest(workflowId = 'industry-workflow-demo'): IndustryWorkflowRequest {
  const category = getIndustryCategoryOption('food_service');
  return buildIndustryWorkflowRequest({
    workflowId,
    categoryId: 'food_service',
    subIndustryId: 'chinese_restaurant',
    channels: category?.defaultChannels ?? ['douyin', 'xiaohongshu'],
    callScoreThreshold: 85,
    merchantProfile: {
      brandName: 'OpenClaw Industry Demo',
      tenantId: 'tenant_demo',
      bindAccounts: ['demo_food_growth'],
      customerPainPoints: [
        'Published content does not convert into qualified DMs',
        'Operators cannot quickly separate warm leads from noise',
      ],
      solvedProblems: [
        'Connect content production, publishing, capture, and conversion in one loop',
        'Route warm leads into booking and phone follow-up faster',
      ],
      personaBackground: 'A growth advisor helping local merchants improve acquisition and conversion.',
      competitiveAdvantages: [
        'Cloud-edge coordinated marketing workflow instead of a single AI widget',
        'High-risk actions stay auditable and approval-aware by default',
      ],
    },
  });
}
