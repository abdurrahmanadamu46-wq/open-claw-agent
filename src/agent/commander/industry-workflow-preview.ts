import type { BaselineRoleAgentBinding } from './types.js';
import type { IndustryWorkflowBlueprint } from './industry-workflow.js';
import type {
  IndustryWorkflowRuntimeHandoffBundle,
  RuntimeHandoffStepContract,
} from './industry-workflow-runtime-handoff.js';

export interface IndustryWorkflowFrontendPreviewStepCard {
  stepNumber: number;
  stepId: string;
  workflowId: string;
  workflowStageId: string;
  workflowCategory: string;
  title: string;
  goal: string;
  ownerRole: string;
  ownerAgentId: string | null;
  ownerStarterSkills: string[];
  supportAgents: Array<{
    roleId: string;
    baselineAgentId: string;
  }>;
  missionType: string;
  bridgeTarget: string;
  scopeId: string | null;
  surface: 'cloud' | 'edge' | 'approval' | 'lead' | 'followup';
  badges: string[];
  workflowBadges: string[];
  lineups: string[];
  lineupBadges: string[];
  readinessState: 'ready' | 'approval_pending' | 'blocked' | 'watch';
  blockedReason: string | null;
  operatorChecklist: string[];
  evidenceRefs: Array<{
    type: 'workflow' | 'approval' | 'runtime' | 'agent' | 'artifact';
    label: string;
    ref: string;
  }>;
  payloadGaps: Array<{
    fieldPath: string;
    source: string;
    required: boolean;
    note: string;
  }>;
  dependencyChecks: string[];
  suggestedCommands: string[];
  handoffTargets: string[];
  rollbackHint: string | null;
  approvalRequired: boolean;
  approvalActions: string[];
  primaryOutput: string | null;
}

export interface IndustryWorkflowFrontendPreviewLane {
  laneId: 'strategy' | 'content' | 'runtime' | 'lead' | 'conversion' | 'review' | 'risk';
  label: string;
  stepCount: number;
  summary: {
    approvalCount: number;
    runtimeCount: number;
    liveFacingCount: number;
    topOwners: Array<{
      roleId: string;
      count: number;
    }>;
    primaryActions: string[];
    nextAttention: string[];
  };
  laneBadges: string[];
  stepCards: IndustryWorkflowFrontendPreviewStepCard[];
}

export interface IndustryWorkflowFrontendPreview {
  version: string;
  generatedAt: string;
  header: {
    workflowId: string;
    industryLabel: string;
    brandName: string;
    channels: string[];
    totalSteps: number;
    runtimeStepCount: number;
    approvalStepCount: number;
    gatedStepCount: number;
  };
  highlights: {
    topicRubricCount: number;
    cloudOutputCount: number;
    edgeOutputCount: number;
    baselineAgentCount: number;
  };
  stepCards: IndustryWorkflowFrontendPreviewStepCard[];
  runtimeCards: IndustryWorkflowFrontendPreviewStepCard[];
  approvalCards: IndustryWorkflowFrontendPreviewStepCard[];
  workflowLanes: IndustryWorkflowFrontendPreviewLane[];
  baselineAgentSummary: Array<{
    roleId: string;
    baselineAgentId: string;
    defaultBridgeTarget: string | null;
    defaultScopeId: string | null;
    starterSkills: string[];
  }>;
}

function toAgentSummary(binding: BaselineRoleAgentBinding) {
  return {
    roleId: binding.roleId,
    baselineAgentId: binding.baselineAgentId,
    defaultBridgeTarget: binding.defaultBridgeTarget,
    defaultScopeId: binding.defaultScopeId ?? null,
    starterSkills: binding.starterSkills,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function inferSurface(step: IndustryWorkflowBlueprint['businessSteps'][number]): IndustryWorkflowFrontendPreviewStepCard['surface'] {
  if (step.runtimeAction.bridgeTarget === 'approval-gate') {
    return 'approval';
  }
  if (step.runtimeAction.bridgeTarget === 'lead-ops-runner') {
    return 'lead';
  }
  if (step.runtimeAction.bridgeTarget === 'orchestrator-control') {
    return 'followup';
  }
  if (step.runtimeAction.scopeId === 'external_publish') {
    return 'edge';
  }
  return 'cloud';
}

function inferBadges(step: IndustryWorkflowBlueprint['businessSteps'][number]): string[] {
  const badges: string[] = [];
  const surface = inferSurface(step);
  badges.push(surface);
  badges.push(`workflow:${step.workflowRef.workflowId}`);
  badges.push(`stage:${step.workflowRef.workflowStageId}`);
  badges.push(`category:${step.workflowRef.workflowCategory}`);
  for (const lineup of step.commanderDecision.selectedLineups) {
    badges.push(`lineup:${lineup}`);
  }

  if (step.approval.required) {
    badges.push('approval');
  }
  if (step.runtimeAction.scopeId) {
    badges.push(step.runtimeAction.scopeId);
  }
  if (step.runtimeAction.bridgeTarget === 'lead-ops-runner') {
    badges.push('lead-ops');
  }
  if (step.runtimeAction.bridgeTarget === 'execute-campaign') {
    badges.push('campaign-exec');
  }
  return badges;
}

function inferReadinessState(
  step: IndustryWorkflowBlueprint['businessSteps'][number],
): IndustryWorkflowFrontendPreviewStepCard['readinessState'] {
  if (step.runtimeAction.scopeId === 'external_publish') {
    return 'blocked';
  }
  if (step.approval.required) {
    return 'approval_pending';
  }
  if (
    step.runtimeAction.bridgeTarget === 'lead-ops-runner' ||
    step.runtimeAction.bridgeTarget === 'execute-campaign' ||
    step.runtimeAction.bridgeTarget === 'orchestrator-control'
  ) {
    return 'watch';
  }
  return 'ready';
}

function inferBlockedReason(
  step: IndustryWorkflowBlueprint['businessSteps'][number],
  readinessState: IndustryWorkflowFrontendPreviewStepCard['readinessState'],
): string | null {
  if (step.runtimeAction.scopeId === 'external_publish') {
    return '需要先完成 publish_external 审批并确认边缘账号绑定后，才能进入真实发布。';
  }
  if (readinessState === 'approval_pending') {
    return `需要先完成审批动作：${step.approval.actions.join('、')}`;
  }
  return null;
}

function buildOperatorChecklist(
  step: IndustryWorkflowBlueprint['businessSteps'][number],
): string[] {
  const checklist: string[] = [];

  if (step.workflowRef.workflowCategory === 'strategy') {
    checklist.push('确认选题方向、核心痛点和评分标准是否一致。');
  }
  if (step.workflowRef.workflowCategory === 'content') {
    checklist.push('检查文案、素材、字幕、封面和数字人资源是否齐全。');
  }
  if (step.runtimeAction.bridgeTarget === 'execute-campaign') {
    checklist.push('确认执行 payload、账号绑定、模板参数和输出目录已准备好。');
  }
  if (step.runtimeAction.bridgeTarget === 'lead-ops-runner') {
    checklist.push('核对线索回传字段、联系方式、评分和原始上下文是否完整。');
  }
  if (step.runtimeAction.bridgeTarget === 'orchestrator-control') {
    checklist.push('确认跟进策略、外呼节奏和人工接管规则已设定。');
  }
  if (step.approval.required) {
    checklist.push(`完成审批前置动作：${step.approval.actions.join('、')}`);
  }
  if (step.runtimeAction.scopeId === 'external_publish') {
    checklist.push('确认边缘端账号、发布窗口和 webhook 回流地址已替换占位符。');
  }
  if (step.runtimeAction.operation === 'edge_inbox_monitor') {
    checklist.push('确认评论/私信监控脚本和边缘控制台地址已配置。');
  }

  return unique(checklist);
}

function findPlaceholderPaths(
  value: unknown,
  currentPath = 'payloadTemplate',
): string[] {
  if (typeof value === 'string') {
    return value.includes('{{') ? [currentPath] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findPlaceholderPaths(item, `${currentPath}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
      findPlaceholderPaths(nested, `${currentPath}.${key}`),
    );
  }
  return [];
}

function buildEvidenceRefs(
  step: IndustryWorkflowBlueprint['businessSteps'][number],
  runtimeStep: RuntimeHandoffStepContract | null,
): IndustryWorkflowFrontendPreviewStepCard['evidenceRefs'] {
  const refs: IndustryWorkflowFrontendPreviewStepCard['evidenceRefs'] = [
    {
      type: 'workflow',
      label: '标准工作流',
      ref: `${step.workflowRef.workflowId}/${step.workflowRef.workflowStageId}`,
    },
    {
      type: 'agent',
      label: '负责人 baseline agent',
      ref: step.ownerBaselineAgent?.baselineAgentId ?? step.ownerRole,
    },
  ];

  if (step.primaryOutput ?? step.outputs?.[0]) {
    refs.push({
      type: 'artifact',
      label: '主输出工件',
      ref: step.outputs[0] ?? '',
    });
  }
  if (step.approval.required) {
    refs.push({
      type: 'approval',
      label: '审批动作',
      ref: step.approval.actions.join(', '),
    });
  }
  if (runtimeStep) {
    refs.push({
      type: 'runtime',
      label: '运行入口',
      ref: `${runtimeStep.bridgeTarget}${runtimeStep.scopeId ? `#${runtimeStep.scopeId}` : ''}`,
    });
  }

  return refs;
}

function buildPayloadGaps(
  step: IndustryWorkflowBlueprint['businessSteps'][number],
  runtimeStep: RuntimeHandoffStepContract | null,
): IndustryWorkflowFrontendPreviewStepCard['payloadGaps'] {
  const gaps: IndustryWorkflowFrontendPreviewStepCard['payloadGaps'] = [];
  const placeholderPaths = findPlaceholderPaths(step.runtimeAction.payloadTemplate);

  for (const placeholderPath of placeholderPaths) {
    gaps.push({
      fieldPath: placeholderPath,
      source: 'placeholder',
      required: true,
      note: '该字段仍是占位符，提交前必须由主框架或边缘上下文替换。',
    });
  }

  if (runtimeStep) {
    for (const field of runtimeStep.requiredMainFrameworkFields) {
      if (field.required && field.source !== 'main_framework_form') {
        gaps.push({
          fieldPath: field.fieldPath,
          source: field.source,
          required: field.required,
          note: field.note,
        });
      }
    }
  }

  return unique(gaps.map((gap) => JSON.stringify(gap))).map((item) =>
    JSON.parse(item) as IndustryWorkflowFrontendPreviewStepCard['payloadGaps'][number],
  );
}

function buildDependencyChecks(
  step: IndustryWorkflowBlueprint['businessSteps'][number],
  runtimeStep: RuntimeHandoffStepContract | null,
): string[] {
  const checks: string[] = [];

  if (step.approval.required) {
    checks.push(`审批动作必须先完成：${step.approval.actions.join('、')}`);
  }
  if (step.runtimeAction.bridgeTarget === 'execute-campaign') {
    checks.push('确认执行 payload、账号绑定、模板参数和输出目录均已就绪');
  }
  if (step.runtimeAction.bridgeTarget === 'lead-ops-runner') {
    checks.push('确认线索回传字段、联系方式、原始上下文和评分信号完整');
  }
  if (step.runtimeAction.bridgeTarget === 'orchestrator-control') {
    checks.push('确认跟进策略、人工接管与外呼节奏规则已配置');
  }
  if (step.runtimeAction.scopeId === 'external_publish') {
    checks.push('确认边缘账号绑定、发布窗口、回流 webhook 与发布审批均已完成');
  }
  if (runtimeStep?.requiredMainFrameworkFields?.length) {
    checks.push(`检查主框架补齐字段数：${runtimeStep.requiredMainFrameworkFields.length}`);
  }

  return unique(checks);
}

function buildSuggestedCommands(
  step: IndustryWorkflowBlueprint['businessSteps'][number],
  runtimeStep: RuntimeHandoffStepContract | null,
): string[] {
  const commands: string[] = [];

  if (step.runtimeAction.bridgeTarget === 'execute-campaign') {
    commands.push(`submit:${step.workflowRef.workflowId}/${step.workflowRef.workflowStageId}:execute-campaign`);
  }
  if (step.runtimeAction.bridgeTarget === 'lead-ops-runner') {
    commands.push(`submit:${step.workflowRef.workflowId}/${step.workflowRef.workflowStageId}:lead-ops`);
  }
  if (step.runtimeAction.bridgeTarget === 'brain-shadow-runner') {
    commands.push(`submit:${step.workflowRef.workflowId}/${step.workflowRef.workflowStageId}:brain-shadow`);
  }
  if (step.runtimeAction.bridgeTarget === 'orchestrator-control') {
    commands.push(`submit:${step.workflowRef.workflowId}/${step.workflowRef.workflowStageId}:orchestrator-control`);
  }
  if (step.approval.required) {
    commands.push(`approval:request:${step.stepId}`);
  }
  if (runtimeStep) {
    commands.push(`handoff:runtime:${runtimeStep.workflowId}/${runtimeStep.workflowStageId}`);
  }

  return unique(commands);
}

function buildHandoffTargets(
  step: IndustryWorkflowBlueprint['businessSteps'][number],
  runtimeStep: RuntimeHandoffStepContract | null,
): string[] {
  const targets: string[] = [];
  if (runtimeStep) {
    targets.push(`runtime:${runtimeStep.bridgeTarget}`);
    if (runtimeStep.scopeId) {
      targets.push(`scope:${runtimeStep.scopeId}`);
    }
  }
  for (const support of step.supportBaselineAgents) {
    targets.push(`agent:${support.roleId}`);
  }
  return unique(targets);
}

function buildRollbackHint(
  step: IndustryWorkflowBlueprint['businessSteps'][number],
): string | null {
  if (step.runtimeAction.scopeId === 'external_publish') {
    return '停止边缘发布任务，撤回未发布内容，并回退到 cloud_archive 版本。';
  }
  if (step.runtimeAction.bridgeTarget === 'lead-ops-runner') {
    return '暂停线索写回，保留原始互动事件，重新校准评分后再入池。';
  }
  if (step.runtimeAction.bridgeTarget === 'orchestrator-control') {
    return '取消外呼/跟进请求，回退到 followup_plan 审批前状态并转人工。';
  }
  if (step.runtimeAction.bridgeTarget === 'execute-campaign') {
    return '停止当前执行任务，保留已生成工件并切换到 recovery_replay。';
  }
  return null;
}

function toStepCard(
  step: IndustryWorkflowBlueprint['businessSteps'][number],
  runtimeStep: RuntimeHandoffStepContract | null,
): IndustryWorkflowFrontendPreviewStepCard {
  const readinessState = inferReadinessState(step);
  const blockedReason = inferBlockedReason(step, readinessState);
  return {
    stepNumber: step.stepNumber,
    stepId: step.stepId,
    workflowId: step.workflowRef.workflowId,
    workflowStageId: step.workflowRef.workflowStageId,
    workflowCategory: step.workflowRef.workflowCategory,
    title: step.label,
    goal: step.goal,
    ownerRole: step.ownerRole,
    ownerAgentId: step.ownerBaselineAgent?.baselineAgentId ?? null,
    ownerStarterSkills: step.ownerBaselineAgent?.starterSkills ?? [],
    supportAgents: step.supportBaselineAgents.map((binding) => ({
      roleId: binding.roleId,
      baselineAgentId: binding.baselineAgentId,
    })),
    missionType: step.missionType,
    bridgeTarget: step.runtimeAction.bridgeTarget,
    scopeId: step.runtimeAction.scopeId ?? null,
    surface: inferSurface(step),
    badges: inferBadges(step),
    workflowBadges: [
      step.workflowRef.workflowId,
      `${step.workflowRef.workflowId}/${step.workflowRef.workflowStageId}`,
    ],
    lineups: step.commanderDecision.selectedLineups,
    lineupBadges: step.commanderDecision.selectedLineups.map((lineup) => `lineup:${lineup}`),
    readinessState,
    blockedReason,
    operatorChecklist: buildOperatorChecklist(step),
    evidenceRefs: buildEvidenceRefs(step, runtimeStep),
    payloadGaps: buildPayloadGaps(step, runtimeStep),
    dependencyChecks: buildDependencyChecks(step, runtimeStep),
    suggestedCommands: buildSuggestedCommands(step, runtimeStep),
    handoffTargets: buildHandoffTargets(step, runtimeStep),
    rollbackHint: buildRollbackHint(step),
    approvalRequired: step.approval.required,
    approvalActions: step.approval.actions,
    primaryOutput: step.outputs[0] ?? null,
  };
}

function normalizeLaneCategory(
  category: string,
): IndustryWorkflowFrontendPreviewLane['laneId'] {
  switch (category) {
    case 'content':
    case 'runtime':
    case 'lead':
    case 'conversion':
    case 'review':
    case 'risk':
      return category;
    case 'intelligence':
    case 'strategy':
    default:
      return 'strategy';
  }
}

function laneLabel(
  laneId: IndustryWorkflowFrontendPreviewLane['laneId'],
): string {
  switch (laneId) {
    case 'strategy':
      return 'Strategy';
    case 'content':
      return 'Content';
    case 'runtime':
      return 'Runtime';
    case 'lead':
      return 'Lead';
    case 'conversion':
      return 'Conversion';
    case 'review':
      return 'Review';
    case 'risk':
      return 'Risk';
  }
}

function buildWorkflowLanes(
  stepCards: IndustryWorkflowFrontendPreviewStepCard[],
): IndustryWorkflowFrontendPreviewLane[] {
  const laneOrder: IndustryWorkflowFrontendPreviewLane['laneId'][] = [
    'strategy',
    'content',
    'runtime',
    'lead',
    'conversion',
    'review',
    'risk',
  ];

  return laneOrder.map((laneId) => {
    const cards = stepCards.filter((step) => normalizeLaneCategory(step.workflowCategory) === laneId);
    const ownerCounts = new Map<string, number>();
    for (const card of cards) {
      ownerCounts.set(card.ownerRole, (ownerCounts.get(card.ownerRole) ?? 0) + 1);
    }
    const topOwners = [...ownerCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .map(([roleId, count]) => ({ roleId, count }));
    const approvalCount = cards.filter((card) => card.approvalRequired).length;
    const runtimeCount = cards.filter((card) => card.scopeId !== null || card.bridgeTarget !== 'brain-shadow-runner').length;
    const liveFacingCount = cards.filter((card) => card.scopeId === 'external_publish' || card.bridgeTarget === 'lead-ops-runner' || card.bridgeTarget === 'orchestrator-control').length;
    const laneBadges: string[] = [];
    if (approvalCount > 0) {
      laneBadges.push('approval-lane');
    }
    if (runtimeCount > 0) {
      laneBadges.push('runtime-lane');
    }
    if (liveFacingCount > 0) {
      laneBadges.push('live-lane');
    }
    if (cards.some((card) => card.approvalActions.includes('outbound_call') || card.approvalActions.includes('high_risk_customer_touchpoint'))) {
      laneBadges.push('high-risk-lane');
    }
    if (cards.some((card) => card.scopeId === 'external_publish')) {
      laneBadges.push('blocked-lane');
    }
    const primaryActions = unique(
      cards.flatMap((card) => {
        const actions: string[] = [];
        if (card.approvalRequired) {
          actions.push('review_approvals');
        }
        if (card.bridgeTarget === 'execute-campaign') {
          actions.push('prepare_runtime_dispatch');
        }
        if (card.bridgeTarget === 'lead-ops-runner') {
          actions.push('verify_lead_flow');
        }
        if (card.bridgeTarget === 'orchestrator-control') {
          actions.push('confirm_followup_policy');
        }
        if (card.workflowCategory === 'strategy') {
          actions.push('freeze_topic_direction');
        }
        return actions;
      }),
    ).slice(0, 4);
    const nextAttention = unique(
      cards.flatMap((card) => {
        const notes: string[] = [];
        if (card.scopeId === 'external_publish') {
          notes.push(`确认 ${card.stepId} 的发布审批与边缘账号绑定`);
        }
        if (card.approvalRequired && card.approvalActions.includes('outbound_call')) {
          notes.push(`确认 ${card.stepId} 的外呼审批与节奏限制`);
        }
        if (card.bridgeTarget === 'lead-ops-runner') {
          notes.push(`核对 ${card.stepId} 的线索回传字段是否完整`);
        }
        if (card.workflowCategory === 'content') {
          notes.push(`检查 ${card.stepId} 的素材、字幕和标题包是否齐全`);
        }
        if (card.workflowCategory === 'strategy') {
          notes.push(`确认 ${card.stepId} 的选题方向与评分标准`);
        }
        return notes;
      }),
    ).slice(0, 4);

    return {
      laneId,
      label: laneLabel(laneId),
      stepCount: cards.length,
      summary: {
        approvalCount,
        runtimeCount,
        liveFacingCount,
        topOwners,
        primaryActions,
        nextAttention,
      },
      laneBadges,
      stepCards: cards,
    };
  });
}

export function buildIndustryWorkflowFrontendPreview(
  blueprint: IndustryWorkflowBlueprint,
  runtimeHandoff: IndustryWorkflowRuntimeHandoffBundle,
): IndustryWorkflowFrontendPreview {
  const runtimeStepMap = new Map(runtimeHandoff.runtimeSteps.map((step) => [step.stepId, step]));
  const stepCards = blueprint.businessSteps.map((step) => toStepCard(step, runtimeStepMap.get(step.stepId) ?? null));
  const runtimeStepIds = new Set(runtimeHandoff.runtimeSteps.map((step) => step.stepId));
  const runtimeCards = stepCards.filter((step) => runtimeStepIds.has(step.stepId));
  const approvalCards = stepCards.filter((step) => step.approvalRequired);
  const workflowLanes = buildWorkflowLanes(stepCards);

  return {
    version: 'lobster.industry-workflow-frontend-preview.v0.1',
    generatedAt: new Date().toISOString(),
    header: {
      workflowId: blueprint.workflowId,
      industryLabel: `${blueprint.industry.categoryLabel}/${blueprint.industry.subIndustryLabel}`,
      brandName: blueprint.merchantDigest.brandName,
      channels: blueprint.channels,
      totalSteps: blueprint.businessSteps.length,
      runtimeStepCount: runtimeHandoff.runtimeSteps.length,
      approvalStepCount: blueprint.approvalSummary.length,
      gatedStepCount: approvalCards.length,
    },
    highlights: {
      topicRubricCount: blueprint.topicScoringRubric.length,
      cloudOutputCount: blueprint.cloudOutputs.length,
      edgeOutputCount: blueprint.edgeOutputs.length,
      baselineAgentCount: blueprint.baselineAgentBindings.length,
    },
    stepCards,
    runtimeCards,
    approvalCards,
    workflowLanes,
    baselineAgentSummary: blueprint.baselineAgentBindings.map(toAgentSummary),
  };
}
