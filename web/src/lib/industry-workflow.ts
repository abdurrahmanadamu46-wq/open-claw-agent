import catalogJson from '@/data/industry-workflow/industry-catalog.json';
import smokeJson from '@/data/industry-workflow/workflow-smoke.json';

export type IndustryChannel = 'douyin' | 'xiaohongshu' | 'kuaishou' | 'video_account';

export type IndustryCategoryOption = {
  id: string;
  label: string;
  defaultChannels: IndustryChannel[];
  subindustries: Array<{
    id: string;
    label: string;
  }>;
};

export type IndustryWorkflowMerchantProfile = {
  brandName?: string;
  tenantId?: string;
  bindAccounts?: string[];
  customerPainPoints: string[];
  solvedProblems: string[];
  personaBackground: string;
  competitiveAdvantages: string[];
};

export type IndustryWorkflowRequest = {
  workflowId: string;
  categoryId: string;
  subIndustryId: string;
  merchantProfile: IndustryWorkflowMerchantProfile;
  channels?: IndustryChannel[];
  callScoreThreshold?: number;
};

export type IndustryWorkflowBlueprint = {
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
  approvalSummary: Array<{
    stepNumber: number;
    stepId: string;
    actions: string[];
    note?: string;
  }>;
  businessSteps: Array<{
    stepNumber: number;
    stepId: string;
    label: string;
    goal: string;
    ownerRole: string;
    outputs: string[];
    approval: {
      required: boolean;
      actions: string[];
      note?: string;
    };
    runtimeAction: {
      bridgeTarget: string;
      scopeId?: string;
      operation: string;
    };
  }>;
};

export type IndustryWorkflowHandoff = {
  request: IndustryWorkflowRequest;
  blueprint: IndustryWorkflowBlueprint;
  taskDescription: string;
  createdAt: string;
};

const catalog = catalogJson as {
  version: string;
  categories: IndustryCategoryOption[];
};

const smokeBlueprint = smokeJson as IndustryWorkflowBlueprint;
export const INDUSTRY_WORKFLOW_HANDOFF_KEY = 'lobster.industry-workflow.handoff.v1';

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function listIndustryCategoryOptions(): IndustryCategoryOption[] {
  return catalog.categories;
}

export function getIndustryCategoryOption(categoryId: string): IndustryCategoryOption | null {
  return catalog.categories.find((item) => item.id === categoryId) ?? null;
}

export function getIndustrySubIndustryLabel(categoryId: string, subIndustryId: string): string {
  const category = getIndustryCategoryOption(categoryId);
  return category?.subindustries.find((item) => item.id === subIndustryId)?.label ?? subIndustryId;
}

export function buildIndustryWorkflowRequest(input: {
  workflowId: string;
  categoryId: string;
  subIndustryId: string;
  channels: IndustryChannel[];
  callScoreThreshold?: number;
  merchantProfile: IndustryWorkflowMerchantProfile;
}): IndustryWorkflowRequest {
  return {
    workflowId: input.workflowId.trim(),
    categoryId: input.categoryId,
    subIndustryId: input.subIndustryId,
    channels: unique(input.channels),
    callScoreThreshold: input.callScoreThreshold,
    merchantProfile: {
      brandName: input.merchantProfile.brandName?.trim() || undefined,
      tenantId: input.merchantProfile.tenantId?.trim() || undefined,
      bindAccounts: unique((input.merchantProfile.bindAccounts ?? []).map((item) => item.trim()).filter(Boolean)),
      customerPainPoints: input.merchantProfile.customerPainPoints.map((item) => item.trim()).filter(Boolean),
      solvedProblems: input.merchantProfile.solvedProblems.map((item) => item.trim()).filter(Boolean),
      personaBackground: input.merchantProfile.personaBackground.trim(),
      competitiveAdvantages: input.merchantProfile.competitiveAdvantages.map((item) => item.trim()).filter(Boolean),
    },
  };
}

export function buildIndustryWorkflowBlueprintPreview(
  request: IndustryWorkflowRequest,
): IndustryWorkflowBlueprint {
  const category = getIndustryCategoryOption(request.categoryId);
  const categoryLabel = category?.label ?? request.categoryId;
  const subIndustryLabel = getIndustrySubIndustryLabel(request.categoryId, request.subIndustryId);
  const channels = request.channels?.length ? request.channels : category?.defaultChannels ?? [];
  const merchantDigest = {
    brandName: request.merchantProfile.brandName?.trim() || 'Unnamed merchant',
    customerPainPoints: request.merchantProfile.customerPainPoints,
    solvedProblems: request.merchantProfile.solvedProblems,
    personaBackground: request.merchantProfile.personaBackground,
    competitiveAdvantages: request.merchantProfile.competitiveAdvantages,
  };

  const topicRubric = [
    `Does it hit a real decision pain point for ${subIndustryLabel}?`,
    'Does it expose a concrete merchant advantage instead of generic promotion?',
    'Can it become a repeatable topic for a vertical content slate?',
    'Can comments and DMs be routed into structured lead handling?',
  ];

  return {
    ...smokeBlueprint,
    generatedAt: new Date().toISOString(),
    workflowId: request.workflowId,
    industry: {
      categoryId: request.categoryId,
      categoryLabel,
      subIndustryId: request.subIndustryId,
      subIndustryLabel,
    },
    channels,
    merchantDigest,
    topicScoringRubric: topicRubric,
    approvalSummary: smokeBlueprint.approvalSummary,
    businessSteps: smokeBlueprint.businessSteps,
  };
}

export function buildIndustryWorkflowTaskDescription(request: IndustryWorkflowRequest): string {
  const categoryLabel = getIndustryCategoryOption(request.categoryId)?.label ?? request.categoryId;
  const subIndustryLabel = getIndustrySubIndustryLabel(request.categoryId, request.subIndustryId);
  const painPointDigest = request.merchantProfile.customerPainPoints.slice(0, 3).join('；');
  const solvedDigest = request.merchantProfile.solvedProblems.slice(0, 2).join('；');
  const advantageDigest = request.merchantProfile.competitiveAdvantages.slice(0, 2).join('；');
  return [
    `${categoryLabel}/${subIndustryLabel} 行业增长工作流规划`,
    `品牌：${request.merchantProfile.brandName || '未命名商家'}`,
    `痛点：${painPointDigest || '待补充'}`,
    `解决：${solvedDigest || '待补充'}`,
    `优势：${advantageDigest || '待补充'}`,
    '先做行业增长 workflow blueprint，不做外部执行。',
  ].join('\n');
}

export function storeIndustryWorkflowHandoff(input: IndustryWorkflowHandoff): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.setItem(INDUSTRY_WORKFLOW_HANDOFF_KEY, JSON.stringify(input));
}

export function readIndustryWorkflowHandoff(): IndustryWorkflowHandoff | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.sessionStorage.getItem(INDUSTRY_WORKFLOW_HANDOFF_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as IndustryWorkflowHandoff;
  } catch {
    return null;
  }
}

export function clearIndustryWorkflowHandoff(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.removeItem(INDUSTRY_WORKFLOW_HANDOFF_KEY);
}
