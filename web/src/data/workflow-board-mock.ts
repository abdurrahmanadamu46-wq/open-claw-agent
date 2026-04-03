'use client';

export type WorkflowLaneId =
  | 'strategy'
  | 'content'
  | 'runtime'
  | 'lead'
  | 'conversion'
  | 'review'
  | 'risk';

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
  supportAgents: Array<{ roleId: string; baselineAgentId: string }>;
  missionType: string;
  bridgeTarget: string;
  scopeId: string | null;
  surface: 'cloud' | 'edge' | 'approval' | 'lead' | 'followup';
  badges: string[];
  readinessState: 'ready' | 'approval_pending' | 'blocked' | 'watch';
  blockedReason: string | null;
  operatorChecklist: string[];
  payloadGaps: Array<{
    fieldPath: string;
    source: string;
    required: boolean;
    note: string;
  }>;
  suggestedCommands: string[];
  handoffTargets: string[];
  rollbackHint: string | null;
  approvalRequired: boolean;
  approvalActions: string[];
  primaryOutput: string | null;
}

export interface IndustryWorkflowFrontendPreviewLane {
  laneId: WorkflowLaneId;
  label: string;
  stepCount: number;
  summary: {
    approvalCount: number;
    runtimeCount: number;
    liveFacingCount: number;
    topOwners: Array<{ roleId: string; count: number }>;
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

export const LOBSTER_META: Record<string, { zhName: string; emoji: string }> = {
  radar: { zhName: '触须虾', emoji: '📡' },
  strategist: { zhName: '脑虫虾', emoji: '🧠' },
  inkwriter: { zhName: '吐墨虾', emoji: '✒️' },
  visualizer: { zhName: '幻影虾', emoji: '🎬' },
  dispatcher: { zhName: '点兵虾', emoji: '📦' },
  echoer: { zhName: '回声虾', emoji: '💬' },
  catcher: { zhName: '铁网虾', emoji: '🎯' },
  abacus: { zhName: '金算虾', emoji: '🧮' },
  followup: { zhName: '回访虾', emoji: '🔄' },
  feedback: { zhName: '反馈虾', emoji: '📊' },
};

const now = '2026-03-31T00:20:00+08:00';
const workflowId = 'wf_demo_food_growth';

const stepCards: IndustryWorkflowFrontendPreviewStepCard[] = [
  {
    stepNumber: 1,
    stepId: 'topic-slate',
    workflowId,
    workflowStageId: 'strategy-01',
    workflowCategory: 'strategy',
    title: '选题与增长路线确认',
    goal: '围绕餐饮门店增长目标，确定本周选题方向和渠道优先级。',
    ownerRole: 'strategist',
    ownerAgentId: 'strategist-main',
    ownerStarterSkills: ['strategy-planning', 'industry-kb'],
    supportAgents: [
      { roleId: 'radar', baselineAgentId: 'radar-baseline' },
      { roleId: 'inkwriter', baselineAgentId: 'inkwriter-baseline' },
    ],
    missionType: 'strategy_design',
    bridgeTarget: 'brain-shadow-runner',
    scopeId: null,
    surface: 'cloud',
    badges: ['高优先级', '本周启动'],
    readinessState: 'ready',
    blockedReason: null,
    operatorChecklist: ['确认目标门店', '确认主渠道', '确认本周预算'],
    payloadGaps: [],
    suggestedCommands: ['预览策略骨架', '生成 starter kit'],
    handoffTargets: ['content-slate', 'publish-plan'],
    rollbackHint: '如选题偏离行业主诉求，回退到行业标签重新生成。',
    approvalRequired: false,
    approvalActions: [],
    primaryOutput: 'StrategyRoute',
  },
  {
    stepNumber: 2,
    stepId: 'copy-compliance',
    workflowId,
    workflowStageId: 'content-01',
    workflowCategory: 'content',
    title: '脚本与合规文案生成',
    goal: '产出适合短视频与评论区承接的文案包，并通过敏感表达审查。',
    ownerRole: 'inkwriter',
    ownerAgentId: 'inkwriter-main',
    ownerStarterSkills: ['copywriting', 'policy-guard'],
    supportAgents: [{ roleId: 'visualizer', baselineAgentId: 'visualizer-baseline' }],
    missionType: 'content_generation',
    bridgeTarget: 'brain-shadow-runner',
    scopeId: null,
    surface: 'cloud',
    badges: ['需审核'],
    readinessState: 'approval_pending',
    blockedReason: '仍需确认价格承诺和外部发布边界。',
    operatorChecklist: ['检查禁用词', '确认价格表达', '确认外部发布渠道'],
    payloadGaps: [
      {
        fieldPath: 'policy.price_commitment',
        source: 'tenant_policy',
        required: true,
        note: '当前租户尚未确认价格承诺话术边界。',
      },
    ],
    suggestedCommands: ['发起审批', '回看品牌话术包'],
    handoffTargets: ['visual-production'],
    rollbackHint: '如审批拒绝，回退到策略页调整表达强度。',
    approvalRequired: true,
    approvalActions: ['publish_external', 'price_commitment'],
    primaryOutput: 'CopyPack',
  },
  {
    stepNumber: 3,
    stepId: 'edge-publish',
    workflowId,
    workflowStageId: 'runtime-01',
    workflowCategory: 'runtime',
    title: '边缘节点发布任务下发',
    goal: '把通过审核的内容包和执行参数下发到边缘节点。',
    ownerRole: 'dispatcher',
    ownerAgentId: 'dispatcher-main',
    ownerStarterSkills: ['dispatch-routing', 'edge-control'],
    supportAgents: [{ roleId: 'visualizer', baselineAgentId: 'visualizer-baseline' }],
    missionType: 'runtime_dispatch',
    bridgeTarget: 'execute-campaign',
    scopeId: 'internal_execute',
    surface: 'edge',
    badges: ['边缘执行'],
    readinessState: 'watch',
    blockedReason: null,
    operatorChecklist: ['确认节点在线', '确认发布窗口', '检查账号健康度'],
    payloadGaps: [],
    suggestedCommands: ['查看节点状态', '执行灰度下发'],
    handoffTargets: ['lead-capture'],
    rollbackHint: '发布异常时回退到 preflight 审批链。',
    approvalRequired: false,
    approvalActions: [],
    primaryOutput: 'ExecutionPlan',
  },
  {
    stepNumber: 4,
    stepId: 'lead-capture',
    workflowId,
    workflowStageId: 'lead-01',
    workflowCategory: 'lead',
    title: '评论 / 私信线索识别',
    goal: '识别高意向评论和私信，将可跟进对象回流到线索池。',
    ownerRole: 'catcher',
    ownerAgentId: 'catcher-main',
    ownerStarterSkills: ['intent-gate', 'lead-routing'],
    supportAgents: [{ roleId: 'abacus', baselineAgentId: 'abacus-baseline' }],
    missionType: 'lead_qualification',
    bridgeTarget: 'lead-ops-runner',
    scopeId: null,
    surface: 'lead',
    badges: ['回流关键'],
    readinessState: 'ready',
    blockedReason: null,
    operatorChecklist: ['确认回流 webhook', '确认高意向阈值', '确认脱敏展示'],
    payloadGaps: [],
    suggestedCommands: ['查看线索池', '查看 webhook 健康度'],
    handoffTargets: ['conversion-followup'],
    rollbackHint: '如回流失败，进入日志审核定位 webhook 问题。',
    approvalRequired: false,
    approvalActions: [],
    primaryOutput: 'LeadAssessment',
  },
  {
    stepNumber: 5,
    stepId: 'conversion-followup',
    workflowId,
    workflowStageId: 'conversion-01',
    workflowCategory: 'conversion',
    title: '高意向线索跟进',
    goal: '对高意向线索安排外呼或人工跟进动作，缩短转化响应时间。',
    ownerRole: 'followup',
    ownerAgentId: 'followup-main',
    ownerStarterSkills: ['sales-followup', 'voice-call'],
    supportAgents: [
      { roleId: 'abacus', baselineAgentId: 'abacus-baseline' },
      { roleId: 'catcher', baselineAgentId: 'catcher-baseline' },
    ],
    missionType: 'conversion_push',
    bridgeTarget: 'orchestrator-control',
    scopeId: null,
    surface: 'followup',
    badges: ['高风险触达'],
    readinessState: 'approval_pending',
    blockedReason: '高风险客户触点必须先经过审批。',
    operatorChecklist: ['确认触达方式', '确认号码来源', '确认回访时间窗'],
    payloadGaps: [
      {
        fieldPath: 'touchpoint.outbound_call',
        source: 'approval_gate',
        required: true,
        note: '外呼动作必须完成审批后才能继续。',
      },
    ],
    suggestedCommands: ['前往审批中心', '查看 lead score card'],
    handoffTargets: ['trace-review'],
    rollbackHint: '审批未通过时回退到线索池，改为人工跟进。',
    approvalRequired: true,
    approvalActions: ['outbound_call', 'high_risk_customer_touchpoint'],
    primaryOutput: 'FollowUpActionPlan',
  },
  {
    stepNumber: 6,
    stepId: 'trace-review',
    workflowId,
    workflowStageId: 'review-01',
    workflowCategory: 'review',
    title: 'Trace 复盘与回滚判断',
    goal: '复盘本轮执行链路，判断是否需要回滚、补偿或调整策略版本。',
    ownerRole: 'feedback',
    ownerAgentId: 'feedback-main',
    ownerStarterSkills: ['trace-analysis', 'rollback-judge'],
    supportAgents: [{ roleId: 'dispatcher', baselineAgentId: 'dispatcher-baseline' }],
    missionType: 'review_evolution',
    bridgeTarget: 'brain-shadow-runner',
    scopeId: null,
    surface: 'approval',
    badges: ['复盘', '治理'],
    readinessState: 'watch',
    blockedReason: null,
    operatorChecklist: ['检查风险等级', '确认审批状态', '查看 replay 结果'],
    payloadGaps: [],
    suggestedCommands: ['打开 Trace', '预演回滚'],
    handoffTargets: ['risk-guard'],
    rollbackHint: '如风险等级继续升高，直接冻结本轮任务链。',
    approvalRequired: false,
    approvalActions: [],
    primaryOutput: 'TraceReviewReport',
  },
  {
    stepNumber: 7,
    stepId: 'risk-guard',
    workflowId,
    workflowStageId: 'risk-01',
    workflowCategory: 'risk',
    title: '风控与上线闸门',
    goal: '确认支付、通知、Feishu callback、ICP 等上线阻塞项是否满足。',
    ownerRole: 'feedback',
    ownerAgentId: 'feedback-main',
    ownerStarterSkills: ['governance-board', 'readiness-check'],
    supportAgents: [{ roleId: 'strategist', baselineAgentId: 'strategist-baseline' }],
    missionType: 'governance_review',
    bridgeTarget: 'brain-shadow-runner',
    scopeId: null,
    surface: 'approval',
    badges: ['上线闸门'],
    readinessState: 'blocked',
    blockedReason: 'Feishu 公网 callback 仍未切真。',
    operatorChecklist: ['检查 payment', '检查 notifications', '检查 Feishu callback', '检查 ICP'],
    payloadGaps: [
      {
        fieldPath: 'integrations.feishu.callback_url',
        source: 'commercial_readiness',
        required: true,
        note: '当前仍使用演示模式，正式上线前需要公网 HTTPS callback。',
      },
    ],
    suggestedCommands: ['打开商业化就绪度', '查看切真 Runbook'],
    handoffTargets: [],
    rollbackHint: '上线闸门未通过时，任务链保持预览态，不放量。',
    approvalRequired: false,
    approvalActions: [],
    primaryOutput: 'LaunchGateSummary',
  },
];

const laneLabels: Record<WorkflowLaneId, string> = {
  strategy: 'Strategy',
  content: 'Content',
  runtime: 'Runtime',
  lead: 'Lead',
  conversion: 'Conversion',
  review: 'Review',
  risk: 'Risk',
};

function buildLane(laneId: WorkflowLaneId, cards: IndustryWorkflowFrontendPreviewStepCard[]): IndustryWorkflowFrontendPreviewLane {
  const laneCards = cards.filter((card) => card.workflowCategory === laneId);
  const ownerCounter = new Map<string, number>();
  laneCards.forEach((card) => {
    ownerCounter.set(card.ownerRole, (ownerCounter.get(card.ownerRole) || 0) + 1);
  });
  const topOwners = [...ownerCounter.entries()].map(([roleId, count]) => ({ roleId, count }));
  return {
    laneId,
    label: laneLabels[laneId],
    stepCount: laneCards.length,
    summary: {
      approvalCount: laneCards.filter((card) => card.approvalRequired).length,
      runtimeCount: laneCards.filter((card) => card.surface === 'edge').length,
      liveFacingCount: laneCards.filter((card) => ['lead', 'followup', 'edge'].includes(card.surface)).length,
      topOwners,
      primaryActions: laneCards.flatMap((card) => card.approvalActions).slice(0, 4),
      nextAttention: laneCards.filter((card) => card.readinessState !== 'ready').map((card) => card.title).slice(0, 3),
    },
    laneBadges: laneCards.flatMap((card) => card.badges).slice(0, 3),
    stepCards: laneCards,
  };
}

export const workflowBoardMock: IndustryWorkflowFrontendPreview = {
  version: 'industry-workflow-preview.v1',
  generatedAt: now,
  header: {
    workflowId,
    industryLabel: '餐饮门店增长',
    brandName: '龙虾池演示商家',
    channels: ['douyin', 'xiaohongshu', 'wechat'],
    totalSteps: stepCards.length,
    runtimeStepCount: stepCards.filter((card) => card.surface === 'edge').length,
    approvalStepCount: stepCards.filter((card) => card.approvalRequired).length,
    gatedStepCount: stepCards.filter((card) => card.readinessState === 'blocked').length,
  },
  highlights: {
    topicRubricCount: 6,
    cloudOutputCount: 4,
    edgeOutputCount: 2,
    baselineAgentCount: 10,
  },
  stepCards,
  runtimeCards: stepCards.filter((card) => card.surface === 'edge'),
  approvalCards: stepCards.filter((card) => card.approvalRequired),
  workflowLanes: (
    ['strategy', 'content', 'runtime', 'lead', 'conversion', 'review', 'risk'] as WorkflowLaneId[]
  ).map((laneId) => buildLane(laneId, stepCards)),
  baselineAgentSummary: [
    {
      roleId: 'radar',
      baselineAgentId: 'radar-baseline',
      defaultBridgeTarget: 'brain-shadow-runner',
      defaultScopeId: null,
      starterSkills: ['signal-scan', 'summary', 'competitor-watch'],
    },
    {
      roleId: 'strategist',
      baselineAgentId: 'strategist-baseline',
      defaultBridgeTarget: 'brain-shadow-runner',
      defaultScopeId: null,
      starterSkills: ['strategy-planning', 'industry-kb', 'governance-route'],
    },
    {
      roleId: 'inkwriter',
      baselineAgentId: 'inkwriter-baseline',
      defaultBridgeTarget: 'brain-shadow-runner',
      defaultScopeId: null,
      starterSkills: ['copywriting', 'safe-variant', 'comment-hook'],
    },
    {
      roleId: 'visualizer',
      baselineAgentId: 'visualizer-baseline',
      defaultBridgeTarget: 'execute-campaign',
      defaultScopeId: 'internal_execute',
      starterSkills: ['storyboard', 'visual-prompt', 'cover-style'],
    },
    {
      roleId: 'dispatcher',
      baselineAgentId: 'dispatcher-baseline',
      defaultBridgeTarget: 'execute-campaign',
      defaultScopeId: 'internal_execute',
      starterSkills: ['dispatch-routing', 'edge-control', 'replay'],
    },
    {
      roleId: 'echoer',
      baselineAgentId: 'echoer-baseline',
      defaultBridgeTarget: 'brain-shadow-runner',
      defaultScopeId: null,
      starterSkills: ['comment-reply', 'tone-control', 'engagement-copy'],
    },
    {
      roleId: 'catcher',
      baselineAgentId: 'catcher-baseline',
      defaultBridgeTarget: 'lead-ops-runner',
      defaultScopeId: null,
      starterSkills: ['intent-gate', 'lead-routing', 'regex-filter'],
    },
    {
      roleId: 'abacus',
      baselineAgentId: 'abacus-baseline',
      defaultBridgeTarget: 'lead-ops-runner',
      defaultScopeId: null,
      starterSkills: ['lead-score', 'value-ranking', 'crm-writeback'],
    },
    {
      roleId: 'followup',
      baselineAgentId: 'followup-baseline',
      defaultBridgeTarget: 'orchestrator-control',
      defaultScopeId: null,
      starterSkills: ['voice-call', 'sales-followup', 'approval-aware-touchpoint'],
    },
    {
      roleId: 'feedback',
      baselineAgentId: 'feedback-baseline',
      defaultBridgeTarget: 'brain-shadow-runner',
      defaultScopeId: null,
      starterSkills: ['trace-analysis', 'rollback-judge', 'launch-gate'],
    },
  ],
};

export function getWorkflowBoardMock(workflowIdParam?: string | null): IndustryWorkflowFrontendPreview {
  if (!workflowIdParam || workflowIdParam === workflowBoardMock.header.workflowId) {
    return workflowBoardMock;
  }

  return {
    ...workflowBoardMock,
    header: {
      ...workflowBoardMock.header,
      workflowId: workflowIdParam,
    },
    stepCards: workflowBoardMock.stepCards.map((card) => ({
      ...card,
      workflowId: workflowIdParam,
    })),
    runtimeCards: workflowBoardMock.runtimeCards.map((card) => ({
      ...card,
      workflowId: workflowIdParam,
    })),
    approvalCards: workflowBoardMock.approvalCards.map((card) => ({
      ...card,
      workflowId: workflowIdParam,
    })),
    workflowLanes: workflowBoardMock.workflowLanes.map((lane) => ({
      ...lane,
      stepCards: lane.stepCards.map((card) => ({
        ...card,
        workflowId: workflowIdParam,
      })),
    })),
  };
}
