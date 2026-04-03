import industryCatalog from './config/industry-catalog.json' with { type: 'json' };
import { resolveCommanderDecision } from './engine.js';
import { getExecutableWorkflowById } from './workflow-catalog.js';
import type {
  BaselineRoleAgentBinding,
  CommanderExecutableWorkflow,
  CommanderWorkflowStage,
  CommanderDecision,
  DecisionContext,
  MissionType,
  RiskLevel,
  RoleId,
} from './types.js';

export type IndustryChannel = 'douyin' | 'xiaohongshu' | 'kuaishou' | 'video_account';

export interface IndustryCategoryOption {
  id: string;
  label: string;
  defaultChannels: IndustryChannel[];
  subindustries: Array<{
    id: string;
    label: string;
  }>;
}

export interface IndustryWorkflowMerchantProfile {
  brandName?: string;
  tenantId?: string;
  bindAccounts?: string[];
  customerPainPoints: string[];
  solvedProblems: string[];
  personaBackground: string;
  competitiveAdvantages: string[];
}

export interface IndustryWorkflowRequest {
  workflowId: string;
  categoryId: string;
  subIndustryId: string;
  merchantProfile: IndustryWorkflowMerchantProfile;
  channels?: IndustryChannel[];
  callScoreThreshold?: number;
}

export interface IndustryWorkflowRuntimeAction {
  bridgeTarget:
    | 'execute-campaign'
    | 'lead-ops-runner'
    | 'brain-shadow-runner'
    | 'orchestrator-control'
    | 'approval-gate';
  scopeId?: string;
  operation: string;
  payloadTemplate: Record<string, unknown>;
  feedbackSignals: string[];
}

export interface IndustryWorkflowBusinessStep {
  stepNumber: number;
  stepId: string;
  label: string;
  goal: string;
  workflowRef: {
    workflowId: string;
    workflowLabel: string;
    workflowCategory: CommanderExecutableWorkflow['category'];
    workflowStageId: string;
  };
  ownerRole: RoleId;
  ownerBaselineAgent: BaselineRoleAgentBinding | null;
  supportRoles: RoleId[];
  supportBaselineAgents: BaselineRoleAgentBinding[];
  missionType: MissionType;
  commanderDecision: CommanderDecision;
  outputs: string[];
  approval: {
    required: boolean;
    actions: string[];
    note?: string;
  };
  runtimeAction: IndustryWorkflowRuntimeAction;
}

export interface IndustryWorkflowBlueprint {
  blueprintVersion: string;
  generatedAt: string;
  workflowId: string;
  industry: {
    categoryId: string;
    categoryLabel: string;
    subIndustryId: string;
    subIndustryLabel: string;
  };
  channels: IndustryChannel[];
  merchantDigest: {
    brandName: string;
    customerPainPoints: string[];
    solvedProblems: string[];
    personaBackground: string;
    competitiveAdvantages: string[];
  };
  topicScoringRubric: string[];
  cloudOutputs: string[];
  edgeOutputs: string[];
  baselineAgentBindings: BaselineRoleAgentBinding[];
  canonicalWorkflowRefs: Array<{
    workflowId: string;
    workflowLabel: string;
    workflowCategory: CommanderExecutableWorkflow['category'];
  }>;
  approvalSummary: Array<{
    stepNumber: number;
    stepId: string;
    actions: string[];
    note?: string;
  }>;
  businessSteps: IndustryWorkflowBusinessStep[];
}

interface WorkflowStepTemplate {
  stepNumber: number;
  stepId: string;
  label: string;
  goal: string;
  workflowId: string;
  workflowStageId?: string;
  riskLevel: RiskLevel;
  latencyPriority: DecisionContext['latencyPriority'];
  revenueImpact: DecisionContext['revenueImpact'];
  evidenceSufficiency: DecisionContext['evidenceSufficiency'];
  requiresExternalAction?: boolean;
  requiresHumanTouchpoint?: boolean;
  tags: string[];
  outputs: string[];
  runtimeAction: Omit<IndustryWorkflowRuntimeAction, 'payloadTemplate'> & {
    payloadFactory: (input: {
      workflowId: string;
      tenantId: string;
      channels: IndustryChannel[];
      industryTemplateId: string;
      merchantProfile: IndustryWorkflowMerchantProfile;
      categoryLabel: string;
      subIndustryLabel: string;
      callScoreThreshold: number;
    }) => Record<string, unknown>;
  };
  manualApprovalActions?: string[];
  approvalNote?: string;
}

const catalog = industryCatalog as {
  version: string;
  categories: IndustryCategoryOption[];
};

function ensureIndustry(categoryId: string, subIndustryId: string) {
  const category = catalog.categories.find((item) => item.id === categoryId);
  if (!category) {
    throw new Error(`Unknown industry category: ${categoryId}`);
  }

  const subIndustry = category.subindustries.find((item) => item.id === subIndustryId);
  if (!subIndustry) {
    throw new Error(`Unknown sub industry: ${subIndustryId}`);
  }

  return { category, subIndustry };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildSupportRoles(decision: CommanderDecision, ownerRole: RoleId): RoleId[] {
  return decision.prioritizedActiveRoles.filter(
    (roleId) => roleId !== ownerRole && roleId !== 'commander' && roleId !== 'feedback',
  );
}

function buildWorkflowSupportRoles(
  workflow: CommanderExecutableWorkflow,
  ownerRole: RoleId,
  decision: CommanderDecision,
): RoleId[] {
  const workflowRoles = workflow.roles.filter(
    (roleId) => roleId !== ownerRole && roleId !== 'commander' && roleId !== 'feedback',
  );

  return unique([...workflowRoles, ...buildSupportRoles(decision, ownerRole)]);
}

function resolveWorkflowStage(
  workflow: CommanderExecutableWorkflow,
  workflowStageId?: string,
): CommanderWorkflowStage {
  if (!workflowStageId) {
    return workflow.stages[0]!;
  }

  const found = workflow.stages.find((stage) => stage.stageId === workflowStageId);
  if (!found) {
    throw new Error(`Workflow ${workflow.workflowId} does not contain stage ${workflowStageId}`);
  }
  return found;
}

function bindingForRole(
  decision: CommanderDecision,
  roleId: RoleId,
): BaselineRoleAgentBinding | null {
  return decision.baselineAgentBindings.find((binding) => binding.roleId === roleId) ?? null;
}

function bindingsForRoles(
  decision: CommanderDecision,
  roleIds: RoleId[],
): BaselineRoleAgentBinding[] {
  const wanted = new Set(roleIds);
  return decision.baselineAgentBindings.filter((binding) => wanted.has(binding.roleId));
}

function buildMerchantDigest(profile: IndustryWorkflowMerchantProfile) {
  return {
    brandName: profile.brandName ?? '未命名商家',
    customerPainPoints: profile.customerPainPoints,
    solvedProblems: profile.solvedProblems,
    personaBackground: profile.personaBackground,
    competitiveAdvantages: profile.competitiveAdvantages,
  };
}

function buildTopicRubric(subIndustryLabel: string, painPoints: string[], advantages: string[]): string[] {
  return [
    `是否击中 ${subIndustryLabel} 客户的高频决策痛点`,
    `是否能自然带出商家的差异化优势：${advantages.slice(0, 2).join('、') || '专业能力'}`,
    '是否便于沉淀为垂直选题库并支持连续发布',
    '是否能在不夸大承诺的前提下提升私信与评论转化',
    '是否能让边缘账号在评论区与私信承接时有明确下一步动作',
    ...(painPoints.length
      ? [`是否围绕真实痛点展开：${painPoints.slice(0, 2).join('、')}`]
      : []),
  ];
}

function buildWorkflowTemplates(): WorkflowStepTemplate[] {
  return [
    {
      stepNumber: 1,
      stepId: 'topic_slate',
      label: '龙虾元老出选题并打分',
      goal: '从行业、痛点、优势中产出可评分的选题池，并选出优先发布主题。',
      workflowId: 'wf_topic_scoring',
      workflowStageId: 'plan',
      riskLevel: 'L1',
      latencyPriority: 'normal',
      revenueImpact: 'high',
      evidenceSufficiency: 'medium',
      tags: ['industry-workflow', 'topic-score'],
      outputs: ['topic_slate', 'topic_scores', 'selected_topics'],
      runtimeAction: {
        bridgeTarget: 'brain-shadow-runner',
        operation: 'topic_slate_compile',
        feedbackSignals: ['topic_selected', 'topic_score_applied'],
        payloadFactory: ({ workflowId, categoryLabel, subIndustryLabel, merchantProfile, channels }) => ({
          workflow_id: workflowId,
          operation: 'topic_slate_compile',
          industry_label: `${categoryLabel}/${subIndustryLabel}`,
          channels,
          merchant_brief: buildMerchantDigest(merchantProfile),
        }),
      },
    },
    {
      stepNumber: 2,
      stepId: 'copy_and_policy_review',
      label: '选中文案生成并自动审违规',
      goal: '生成垂直成交文案并做敏感表达、违规承诺和平台政策预审。',
      workflowId: 'wf_copy_compliance',
      workflowStageId: 'draft',
      riskLevel: 'L2',
      latencyPriority: 'normal',
      revenueImpact: 'high',
      evidenceSufficiency: 'medium',
      tags: ['industry-workflow', 'copy', 'policy-review'],
      outputs: ['vertical_copy', 'policy_review_notes', 'safe_variant_pack'],
      runtimeAction: {
        bridgeTarget: 'approval-gate',
        operation: 'copy_policy_review',
        feedbackSignals: ['copy_review_passed', 'copy_review_rejected'],
        payloadFactory: ({ workflowId, merchantProfile, categoryLabel, subIndustryLabel }) => ({
          workflow_id: workflowId,
          operation: 'copy_policy_review',
          industry_label: `${categoryLabel}/${subIndustryLabel}`,
          risk_scope: ['sensitive_claims', 'publish_external'],
          merchant_brief: buildMerchantDigest(merchantProfile),
        }),
      },
      approvalNote: '对外发布前必须经过违规表达与敏感承诺审查。',
    },
    {
      stepNumber: 3,
      stepId: 'voice_avatar_render',
      label: '自动合成声音并驱动数字人视频',
      goal: '根据选中文案生成语音和数字人驱动素材。',
      workflowId: 'wf_visual_production',
      workflowStageId: 'storyboard',
      riskLevel: 'L1',
      latencyPriority: 'normal',
      revenueImpact: 'medium',
      evidenceSufficiency: 'medium',
      tags: ['industry-workflow', 'voice', 'digital-human'],
      outputs: ['voice_track', 'avatar_motion_plan'],
      runtimeAction: {
        bridgeTarget: 'execute-campaign',
        scopeId: 'internal_execute',
        operation: 'voice_avatar_render',
        feedbackSignals: ['voice_rendered', 'avatar_rendered'],
        payloadFactory: ({ workflowId, tenantId, industryTemplateId, channels, merchantProfile }) => ({
          campaign_id: `${workflowId}-voice-avatar`,
          tenant_id: tenantId,
          industry_template_id: `${industryTemplateId}.${channels[0] ?? 'douyin'}`,
          target_urls: [],
          bind_accounts: merchantProfile.bindAccounts ?? [],
          content_strategy: {
            template_type: 'voice_avatar_render',
            min_clips: 1,
            max_clips: 3,
          },
        }),
      },
    },
    {
      stepNumber: 4,
      stepId: 'scene_match',
      label: '根据文案匹配精准画面',
      goal: '根据文案结构与卖点自动生成分镜和画面提示。',
      workflowId: 'wf_visual_production',
      workflowStageId: 'storyboard',
      riskLevel: 'L1',
      latencyPriority: 'normal',
      revenueImpact: 'medium',
      evidenceSufficiency: 'medium',
      tags: ['industry-workflow', 'storyboard', 'scene-match'],
      outputs: ['scene_pack', 'visual_prompt_pack'],
      runtimeAction: {
        bridgeTarget: 'execute-campaign',
        scopeId: 'internal_execute',
        operation: 'scene_match',
        feedbackSignals: ['scene_pack_ready', 'visual_prompt_ready'],
        payloadFactory: ({ workflowId, tenantId, industryTemplateId, channels, merchantProfile }) => ({
          campaign_id: `${workflowId}-scene-pack`,
          tenant_id: tenantId,
          industry_template_id: `${industryTemplateId}.${channels[0] ?? 'douyin'}`,
          target_urls: [],
          bind_accounts: merchantProfile.bindAccounts ?? [],
          content_strategy: {
            template_type: 'scene_match',
            min_clips: 3,
            max_clips: 8,
          },
        }),
      },
    },
    {
      stepNumber: 5,
      stepId: 'subtitle_bgm',
      label: '自动生成特效字幕和背景音乐',
      goal: '自动生成字幕风格、节奏点和背景音乐建议。',
      workflowId: 'wf_visual_production',
      workflowStageId: 'storyboard',
      riskLevel: 'L1',
      latencyPriority: 'normal',
      revenueImpact: 'medium',
      evidenceSufficiency: 'medium',
      tags: ['industry-workflow', 'subtitle', 'bgm'],
      outputs: ['subtitle_track', 'bgm_pack'],
      runtimeAction: {
        bridgeTarget: 'execute-campaign',
        scopeId: 'internal_execute',
        operation: 'subtitle_bgm',
        feedbackSignals: ['subtitle_ready', 'bgm_ready'],
        payloadFactory: ({ workflowId, tenantId, industryTemplateId, channels, merchantProfile }) => ({
          campaign_id: `${workflowId}-subtitle-bgm`,
          tenant_id: tenantId,
          industry_template_id: `${industryTemplateId}.${channels[0] ?? 'douyin'}`,
          target_urls: [],
          bind_accounts: merchantProfile.bindAccounts ?? [],
          content_strategy: {
            template_type: 'subtitle_bgm',
            min_clips: 1,
            max_clips: 3,
          },
        }),
      },
    },
    {
      stepNumber: 6,
      stepId: 'title_cover',
      label: '自动生成标题封面',
      goal: '根据选题和文案生成高点击标题与封面方向。',
      workflowId: 'wf_title_cover',
      workflowStageId: 'headline',
      riskLevel: 'L1',
      latencyPriority: 'normal',
      revenueImpact: 'high',
      evidenceSufficiency: 'medium',
      tags: ['industry-workflow', 'title-cover'],
      outputs: ['title_pack', 'cover_direction'],
      runtimeAction: {
        bridgeTarget: 'execute-campaign',
        scopeId: 'internal_execute',
        operation: 'title_cover',
        feedbackSignals: ['title_ready', 'cover_ready'],
        payloadFactory: ({ workflowId, tenantId, industryTemplateId, channels, merchantProfile }) => ({
          campaign_id: `${workflowId}-title-cover`,
          tenant_id: tenantId,
          industry_template_id: `${industryTemplateId}.${channels[0] ?? 'douyin'}`,
          target_urls: [],
          bind_accounts: merchantProfile.bindAccounts ?? [],
          content_strategy: {
            template_type: 'title_cover',
            min_clips: 1,
            max_clips: 2,
          },
        }),
      },
    },
    {
      stepNumber: 7,
      stepId: 'cloud_archive',
      label: '内容包保存到云端',
      goal: '将文案、分镜、语音、封面和素材清单沉淀到云端内容包。',
      workflowId: 'wf_cloud_archive',
      workflowStageId: 'archive',
      riskLevel: 'L1',
      latencyPriority: 'normal',
      revenueImpact: 'medium',
      evidenceSufficiency: 'high',
      tags: ['industry-workflow', 'cloud-archive'],
      outputs: ['cloud_content_bundle', 'artifact_manifest'],
      runtimeAction: {
        bridgeTarget: 'orchestrator-control',
        operation: 'cloud_archive',
        feedbackSignals: ['cloud_bundle_saved'],
        payloadFactory: ({ workflowId, tenantId, merchantProfile, categoryLabel, subIndustryLabel, channels }) => ({
          workflow_id: workflowId,
          tenant_id: tenantId,
          operation: 'cloud_archive',
          content_bundle_key: `${tenantId}/${workflowId}/content-bundle.json`,
          industry_label: `${categoryLabel}/${subIndustryLabel}`,
          channels,
          merchant_brief: buildMerchantDigest(merchantProfile),
        }),
      },
    },
    {
      stepNumber: 8,
      stepId: 'edge_publish_dispatch',
      label: '云端派发任务到边缘端发布内容',
      goal: '由云端 Dispatcher 把已审批内容包派发到边缘执行端发布。',
      workflowId: 'wf_edge_publish',
      workflowStageId: 'publish',
      riskLevel: 'L2',
      latencyPriority: 'high',
      revenueImpact: 'high',
      evidenceSufficiency: 'high',
      requiresExternalAction: true,
      tags: ['industry-workflow', 'edge-publish', 'external_publish'],
      outputs: ['edge_publish_job', 'publish_trace'],
      runtimeAction: {
        bridgeTarget: 'execute-campaign',
        scopeId: 'external_publish',
        operation: 'edge_publish_dispatch',
        feedbackSignals: ['publish_queued', 'publish_external'],
        payloadFactory: ({ workflowId, tenantId, industryTemplateId, channels, merchantProfile }) => ({
          campaign_id: `${workflowId}-edge-publish`,
          tenant_id: tenantId,
          industry_template_id: `${industryTemplateId}.${channels[0] ?? 'douyin'}`,
          target_urls: [],
          bind_accounts: merchantProfile.bindAccounts ?? ['{{edge_account_id}}'],
          webhook_url: '{{lead_ops_webhook}}',
          content_strategy: {
            template_type: 'edge_publish',
            min_clips: 3,
            max_clips: 8,
          },
        }),
      },
      manualApprovalActions: ['publish_external'],
      approvalNote: '对外发布与边缘账号执行必须走 publish_external 审批。',
    },
    {
      stepNumber: 9,
      stepId: 'edge_inbox_monitor',
      label: '边缘龙虾监视私信和评论并回传云端',
      goal: '监视评论和私信，把互动事件同步给云端 9 龙虾元老处理。',
      workflowId: 'wf_edge_inbox',
      workflowStageId: 'reply',
      riskLevel: 'L2',
      latencyPriority: 'high',
      revenueImpact: 'high',
      evidenceSufficiency: 'high',
      tags: ['industry-workflow', 'edge-monitor', 'comment-dm'],
      outputs: ['interaction_events', 'comment_dm_feed'],
      runtimeAction: {
        bridgeTarget: 'brain-shadow-runner',
        operation: 'edge_inbox_monitor',
        feedbackSignals: ['comment_captured', 'dm_captured', 'cloud_feedback_written'],
        payloadFactory: ({ workflowId, tenantId, channels, merchantProfile }) => ({
          job_id: `${workflowId}-edge-monitor`,
          campaign_id: `${workflowId}-edge-publish`,
          action: 'edge_monitor_inbox',
          config: {
            campaign_id: `${workflowId}-edge-publish`,
            tenant_id: tenantId,
            industry_template_id: `${workflowId}.monitor`,
            target_urls: [],
            bind_accounts: merchantProfile.bindAccounts ?? ['{{edge_account_id}}'],
          },
          channels,
          steps: [
            { action: 'navigate', url: '{{edge_account_console}}' },
            {
              action: 'custom_script',
              script: 'watch_comments_and_dm_and_forward_to_cloud',
              context: {
                workflow_id: workflowId,
                channels,
              },
            },
          ],
        }),
      },
      approvalNote: '私信承接涉及敏感承诺或价格时，需要继续走敏感话术治理。',
    },
    {
      stepNumber: 10,
      stepId: 'lead_scoring',
      label: '龙虾元老对线索评分',
      goal: '结合意向、价值、风险对线索评分并写回后续动作队列。',
      workflowId: 'wf_lead_scoring',
      workflowStageId: 'score',
      riskLevel: 'L1',
      latencyPriority: 'high',
      revenueImpact: 'high',
      evidenceSufficiency: 'high',
      tags: ['industry-workflow', 'lead-score'],
      outputs: ['lead_tier', 'lead_score_card', 'followup_queue'],
      runtimeAction: {
        bridgeTarget: 'lead-ops-runner',
        operation: 'lead_score_writeback',
        feedbackSignals: ['lead_qualified', 'lead_scored', 'lead_synced'],
        payloadFactory: ({ workflowId, tenantId, channels }) => ({
          lead_submission: {
            tenant_id: tenantId,
            campaign_id: `${workflowId}-edge-publish`,
            contact_info: '{{lead_contact}}',
            intention_score: '{{lead_score}}',
            source_platform: channels[0] ?? 'douyin',
            raw_context: '{{edge_interaction_event}}',
          },
        }),
      },
    },
    {
      stepNumber: 11,
      stepId: 'high_score_call',
      label: '高评分线索自动发起电话动作',
      goal: '对高评分线索触发跟进计划和外呼请求，但必须带审批与止损。',
      workflowId: 'wf_high_score_call',
      workflowStageId: 'call',
      riskLevel: 'L3',
      latencyPriority: 'urgent',
      revenueImpact: 'strategic',
      evidenceSufficiency: 'high',
      requiresHumanTouchpoint: true,
      tags: ['industry-workflow', 'outbound-call', 'followup'],
      outputs: ['followup_plan', 'voice_call_request'],
      runtimeAction: {
        bridgeTarget: 'orchestrator-control',
        operation: 'high_score_call',
        feedbackSignals: ['call_requested', 'call_approved', 'call_result_written'],
        payloadFactory: ({ workflowId, tenantId, callScoreThreshold }) => ({
          workflow_id: workflowId,
          tenant_id: tenantId,
          operation: 'voice_call_request',
          threshold_score: callScoreThreshold,
          approval_required: true,
          target_source: 'lead_score_queue',
        }),
      },
      manualApprovalActions: ['outbound_call'],
      approvalNote: '高分线索直接打电话属于高风险客户触达，必须经过 outbound_call 审批。',
    },
  ];
}

export function listIndustryOptions(): IndustryCategoryOption[] {
  return catalog.categories;
}

export function compileIndustryWorkflowBlueprint(
  request: IndustryWorkflowRequest,
): IndustryWorkflowBlueprint {
  const { category, subIndustry } = ensureIndustry(request.categoryId, request.subIndustryId);
  const merchantDigest = buildMerchantDigest(request.merchantProfile);
  const channels = unique((request.channels?.length ? request.channels : category.defaultChannels) as IndustryChannel[]);
  const callScoreThreshold = request.callScoreThreshold ?? 85;
  const tenantId = request.merchantProfile.tenantId ?? 'tenant-demo';
  const industryTemplateId = `${category.id}.${subIndustry.id}`;
  const templates = buildWorkflowTemplates();

  const businessSteps: IndustryWorkflowBusinessStep[] = templates.map((template) => {
    const workflow = getExecutableWorkflowById(template.workflowId);
    const workflowStage = resolveWorkflowStage(workflow, template.workflowStageId);
    const context: DecisionContext = {
      missionId: `${request.workflowId}:${template.stepId}`,
      missionType: workflowStage.missionType,
      riskLevel: template.riskLevel,
      latencyPriority: template.latencyPriority,
      revenueImpact: template.revenueImpact,
      evidenceSufficiency: template.evidenceSufficiency,
      requiresExternalAction: template.requiresExternalAction,
      requiresHumanTouchpoint: template.requiresHumanTouchpoint,
      hasWarmLead: template.stepId === 'lead_scoring' || template.stepId === 'high_score_call',
      tags: [category.id, subIndustry.id, ...template.tags, ...channels],
    };

    const commanderDecision = resolveCommanderDecision(context);
    const approvalActions = unique([
      ...workflowStage.approvalActions,
      ...(template.manualApprovalActions ?? []),
      ...commanderDecision.approvalPlan.map((item) => item.action),
    ]);

    const supportRoles = buildWorkflowSupportRoles(workflow, workflowStage.ownerRole, commanderDecision);
    return {
      stepNumber: template.stepNumber,
      stepId: template.stepId,
      label: template.label,
      goal: template.goal,
      workflowRef: {
        workflowId: workflow.workflowId,
        workflowLabel: workflow.label,
        workflowCategory: workflow.category,
        workflowStageId: workflowStage.stageId,
      },
      ownerRole: workflowStage.ownerRole,
      ownerBaselineAgent: bindingForRole(commanderDecision, workflowStage.ownerRole),
      supportRoles,
      supportBaselineAgents: bindingsForRoles(commanderDecision, supportRoles),
      missionType: workflowStage.missionType,
      commanderDecision,
      outputs: template.outputs.length > 0 ? template.outputs : workflowStage.outputs,
      approval: {
        required: approvalActions.length > 0,
        actions: approvalActions,
        note: template.approvalNote,
      },
      runtimeAction: {
        bridgeTarget: workflowStage.bridgeTarget ?? template.runtimeAction.bridgeTarget,
        scopeId: workflowStage.scopeId ?? template.runtimeAction.scopeId,
        operation: template.runtimeAction.operation,
        feedbackSignals: template.runtimeAction.feedbackSignals,
        payloadTemplate: template.runtimeAction.payloadFactory({
          workflowId: request.workflowId,
          tenantId,
          channels,
          industryTemplateId,
          merchantProfile: request.merchantProfile,
          categoryLabel: category.label,
          subIndustryLabel: subIndustry.label,
          callScoreThreshold,
        }),
      },
    };
  });

  const approvalSummary = businessSteps
    .filter((step) => step.approval.required)
    .map((step) => ({
      stepNumber: step.stepNumber,
      stepId: step.stepId,
      actions: step.approval.actions,
      note: step.approval.note,
    }));

  const baselineBindingMap = new Map<string, BaselineRoleAgentBinding>();
  for (const step of businessSteps) {
    if (step.ownerBaselineAgent) {
      baselineBindingMap.set(step.ownerBaselineAgent.roleId, step.ownerBaselineAgent);
    }
    for (const binding of step.supportBaselineAgents) {
      baselineBindingMap.set(binding.roleId, binding);
    }
  }
  const baselineAgentBindings = [...baselineBindingMap.values()].sort((left, right) =>
    left.roleId.localeCompare(right.roleId),
  );
  const canonicalWorkflowRefs = unique(
    businessSteps.map((step) => `${step.workflowRef.workflowId}::${step.workflowRef.workflowStageId}`),
  ).map((key) => {
    const step = businessSteps.find(
      (item) => `${item.workflowRef.workflowId}::${item.workflowRef.workflowStageId}` === key,
    )!;
    return {
      workflowId: step.workflowRef.workflowId,
      workflowLabel: step.workflowRef.workflowLabel,
      workflowCategory: step.workflowRef.workflowCategory,
    };
  });

  return {
    blueprintVersion: 'lobster.industry-workflow-blueprint.v0.1',
    generatedAt: new Date().toISOString(),
    workflowId: request.workflowId,
    industry: {
      categoryId: category.id,
      categoryLabel: category.label,
      subIndustryId: subIndustry.id,
      subIndustryLabel: subIndustry.label,
    },
    channels,
    merchantDigest,
    topicScoringRubric: buildTopicRubric(
      subIndustry.label,
      merchantDigest.customerPainPoints,
      merchantDigest.competitiveAdvantages,
    ),
    cloudOutputs: [
      'topic_slate',
      'vertical_copy',
      'safe_variant_pack',
      'cloud_content_bundle',
      'lead_score_card',
      'followup_plan',
    ],
    edgeOutputs: ['edge_publish_job', 'comment_dm_feed', 'voice_call_request'],
    baselineAgentBindings,
    canonicalWorkflowRefs,
    approvalSummary,
    businessSteps,
  };
}
