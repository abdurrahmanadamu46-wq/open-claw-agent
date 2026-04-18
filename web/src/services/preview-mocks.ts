import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { TenantIntegrations } from '@/types/integrations';
import type { SkillImprovementProposal } from '@/types/skill-improvements';

type MockResponse = AxiosResponse;

// Ports used in local dev (npm run dev) and Docker-compose (WEB_HOST_PORT=3301)
const PREVIEW_PORTS = new Set(['3000', '3001', '3002', '3003', '3005', '3101', '3301', '3302']);

function nowIso() {
  return new Date().toISOString();
}

export function shouldUsePreviewMocks(): boolean {
  if (typeof window === 'undefined') return false;
  // Explicit env-var override (NEXT_PUBLIC_USE_MOCK=true forces mocks on)
  if (process.env.NEXT_PUBLIC_USE_MOCK === 'true') return true;
  const { hostname, port } = window.location;
  return (hostname === '127.0.0.1' || hostname === 'localhost') && PREVIEW_PORTS.has(port || '3001');
}

function response<T>(config: InternalAxiosRequestConfig, data: T, status = 200): MockResponse {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config,
    request: { mocked: true },
  } as MockResponse;
}

function parseData(config: InternalAxiosRequestConfig): Record<string, any> {
  const raw = config.data;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, any>;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, any>;
  return {};
}

let previewIntegrations: TenantIntegrations = {
  storage: {
    provider: 'aliyun_oss',
    bucketName: 'lobster-pool-demo-assets',
    accessKeyId: 'DEMO_ACCESS_KEY',
    secretAccessKey: 'DEMO_SECRET',
    region: 'cn-shanghai',
  },
  plugin_hub: {
    adapters: [
      {
        id: 'deepseek',
        provider: 'deepseek',
        displayName: 'DeepSeek',
        enabled: true,
        capabilities: ['llm.chat', 'llm.reasoning'],
        authType: 'bearer',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        health: { status: 'healthy', latencyMs: 380, lastCheckedAt: nowIso() },
      },
      {
        id: 'aliyun_oss',
        provider: 'aliyun_oss',
        displayName: '阿里云 OSS',
        enabled: true,
        capabilities: ['storage.object'],
        authType: 'api_key',
        health: { status: 'healthy', latencyMs: 122, lastCheckedAt: nowIso() },
      },
      {
        id: 'lead_webhook',
        provider: 'webhook',
        displayName: '线索 Webhook',
        enabled: true,
        capabilities: ['webhook.lead_capture', 'crm.push'],
        authType: 'none',
        webhookUrl: 'https://demo.lobsterpool.local/webhook/leads',
        health: { status: 'healthy', latencyMs: 98, lastCheckedAt: nowIso() },
      },
    ],
    routing: {
      'llm.chat': { mode: 'auto', primaryAdapterId: 'deepseek' },
      'llm.reasoning': { mode: 'force', primaryAdapterId: 'deepseek' },
      'storage.object': { mode: 'auto', primaryAdapterId: 'aliyun_oss' },
      'webhook.lead_capture': { mode: 'fallback', primaryAdapterId: 'lead_webhook' },
    },
    updatedAt: nowIso(),
  },
  group_collab: {
    enabled: true,
    provider: 'mock',
    respondMode: 'intent',
    approvalNotifications: true,
    placeholderEnabled: true,
    placeholderThresholdMs: 2500,
    knowledgeCaptureMode: 'none',
    knowledgeTargetLayer: 'tenant_private',
    allowPlatformKnowledgeBackflow: false,
    mockDataEnabled: true,
    defaultAdapterId: 'mock-default',
    adapters: [
      {
        id: 'mock-default',
        label: 'Mock Collab Bus',
        provider: 'mock',
        enabled: true,
        mode: 'mock',
        capabilities: ['message', 'report', 'approval', 'confirmation', 'reminder', 'receipt'],
        defaultChatId: 'mock://ops-room',
        defaultTargetName: 'Mock Ops Room',
      },
      {
        id: 'feishu-default',
        label: 'Feishu Group Bot',
        provider: 'feishu',
        enabled: false,
        mode: 'live',
        capabilities: ['message', 'report', 'approval', 'confirmation', 'reminder'],
        defaultTargetName: 'Feishu Ops Room',
      },
      {
        id: 'wechat-default',
        label: 'WeChat Group Adapter',
        provider: 'wechat',
        enabled: false,
        mode: 'mock',
        capabilities: ['message', 'report', 'approval', 'confirmation', 'reminder'],
        defaultTargetName: 'WeChat Customer Group',
      },
    ],
  },
};

let previewOrders = [
  {
    order_id: 'order_demo_001',
    checkout_id: 'checkout_demo_001',
    user_id: 'demo_admin',
    tenant_id: 'tenant_demo',
    plan_code: 'pro',
    cycle: 'month',
    payment_provider: 'mockpay',
    amount_cny: 6999,
    currency: 'CNY',
    status: 'pending',
    created_at: nowIso(),
    updated_at: nowIso(),
  },
];

let previewCampaigns = [
  {
    campaign_id: 'cmp_demo_001',
    industry_template_id: 'food_template_growth',
    status: 'RUNNING',
    daily_publish_limit: 6,
    leads_collected: 18,
    created_at: nowIso(),
  },
  {
    campaign_id: 'cmp_demo_002',
    industry_template_id: 'beauty_template_retention',
    status: 'DRAFT',
    daily_publish_limit: 4,
    leads_collected: 6,
    created_at: nowIso(),
  },
];

const previewLeads = [
  {
    lead_id: 'lead_demo_001',
    campaign_id: 'cmp_demo_001',
    contact_info: '138****1024',
    intent_score: 96,
    source_platform: 'douyin',
    user_message: '想了解同城获客方案',
    captured_at: nowIso(),
    webhook_status: 'SUCCESS',
  },
  {
    lead_id: 'lead_demo_002',
    campaign_id: 'cmp_demo_001',
    contact_info: '189****2231',
    intent_score: 88,
    source_platform: 'xiaohongshu',
    user_message: '方便安排顾问联系吗',
    captured_at: nowIso(),
    webhook_status: 'SUCCESS',
  },
  {
    lead_id: 'lead_demo_003',
    campaign_id: 'cmp_demo_002',
    contact_info: '177****8099',
    intent_score: 62,
    source_platform: 'wechat',
    user_message: '先看看套餐价格',
    captured_at: nowIso(),
    webhook_status: 'PENDING',
  },
];

let previewSubscription = {
  id: 'sub_demo_001',
  user_id: 'demo_admin',
  tenant_id: 'tenant_demo',
  plan_code: 'pro',
  cycle: 'month',
  status: 'trialing',
  payment_provider: 'mockpay',
  token_limit: 600000,
  run_limit: 1200,
  used_tokens: 84210,
  used_runs: 132,
  auto_renew: false,
  current_period_start: nowIso(),
  current_period_end: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
};

let previewCollabRecords: Array<Record<string, any>> = [
  {
    recordId: 'collab_demo_report',
    tenantId: 'tenant_demo',
    requestId: 'req_demo_report',
    traceId: 'trc_demo_report',
    objectType: 'report',
    direction: 'outbound',
    status: 'delivered',
    title: '今日群播报',
    summary: '今日新增 3 条线索，1 条审批待确认。',
    body: '今日新增 3 条线索，1 条审批待确认。建议 18:30 前完成价格口径确认，再继续发群。',
    route: {
      adapterId: 'mock-default',
      provider: 'mock',
      mode: 'mock',
      chatId: 'mock://ops-room',
      targetName: 'Mock Ops Room',
    },
    tags: ['mock', 'report'],
    metadata: { seeded: true },
    history: [
      {
        eventId: 'evt_demo_report',
        eventType: 'collab.dispatch.completed',
        status: 'delivered',
        direction: 'outbound',
        summary: 'mock adapter delivered report',
        at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  },
  {
    recordId: 'collab_demo_approval',
    tenantId: 'tenant_demo',
    requestId: 'req_demo_approval',
    traceId: 'trc_demo_approval',
    objectType: 'approval',
    direction: 'outbound',
    status: 'awaiting_approval',
    title: '确认价格承诺口径',
    summary: '客户群里准备发送带价格承诺的话术，需要审批。',
    body: '请确认是否允许在客户群中发送“本周签约立减 800 元”的口径。',
    route: {
      adapterId: 'mock-default',
      provider: 'mock',
      mode: 'mock',
      chatId: 'mock://ops-room',
      targetName: 'Mock Ops Room',
    },
    tags: ['mock', 'approval'],
    metadata: { seeded: true },
    history: [
      {
        eventId: 'evt_demo_approval',
        eventType: 'collab.dispatch.completed',
        status: 'awaiting_approval',
        direction: 'outbound',
        summary: 'approval request sent to mock room',
        at: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
  },
  {
    recordId: 'collab_demo_confirmation',
    tenantId: 'tenant_demo',
    requestId: 'req_demo_confirmation',
    traceId: 'trc_demo_confirmation',
    objectType: 'confirmation',
    direction: 'outbound',
    status: 'awaiting_confirmation',
    title: '确认明日直播节奏',
    summary: '需要确认明日 19:00 直播是否保留。',
    body: '请确认明日 19:00 直播是否保留，若取消将自动调整今日群播报和导流节奏。',
    route: {
      adapterId: 'mock-default',
      provider: 'mock',
      mode: 'mock',
      chatId: 'mock://ops-room',
      targetName: 'Mock Ops Room',
    },
    tags: ['mock', 'confirmation'],
    metadata: { seeded: true },
    history: [
      {
        eventId: 'evt_demo_confirmation',
        eventType: 'collab.dispatch.completed',
        status: 'awaiting_confirmation',
        direction: 'outbound',
        summary: 'confirmation request sent to mock room',
        at: new Date(Date.now() - 26 * 60 * 1000).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 26 * 60 * 1000).toISOString(),
  },
  {
    recordId: 'collab_demo_reminder',
    tenantId: 'tenant_demo',
    requestId: 'req_demo_reminder',
    traceId: 'trc_demo_reminder',
    objectType: 'reminder',
    direction: 'outbound',
    status: 'sent',
    title: '审批催办',
    summary: '价格承诺口径仍待确认，已触发催办。',
    body: '价格承诺口径仍待确认，若 30 分钟内无结论，将自动转入保守话术版本。',
    route: {
      adapterId: 'mock-default',
      provider: 'mock',
      mode: 'mock',
      chatId: 'mock://ops-room',
      targetName: 'Mock Ops Room',
    },
    tags: ['mock', 'reminder'],
    metadata: { seeded: true },
    history: [
      {
        eventId: 'evt_demo_reminder',
        eventType: 'collab.dispatch.completed',
        status: 'sent',
        direction: 'outbound',
        summary: 'reminder sent to mock room',
        at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
  },
];

function createPreviewCollabReceipt(source: Record<string, any>, detail: string, state: 'acknowledged' | 'delivered' | 'failed' = 'acknowledged') {
  return {
    recordId: `collab_receipt_${Math.random().toString(36).slice(2, 10)}`,
    tenantId: 'tenant_demo',
    requestId: source.requestId,
    traceId: source.traceId,
    correlationId: source.recordId,
    objectType: 'receipt',
    direction: 'inbound',
    status: state === 'failed' ? 'failed' : 'acknowledged',
    title: `${source.title} 回执`,
    summary: detail,
    body: detail,
    route: source.route,
    tags: ['receipt', 'mock'],
    metadata: { sourceRecordId: source.recordId },
    history: [
      {
        eventId: `evt_receipt_${Math.random().toString(36).slice(2, 10)}`,
        eventType: 'collab.receipt.captured',
        status: state === 'failed' ? 'failed' : 'acknowledged',
        direction: 'inbound',
        summary: detail,
        at: nowIso(),
      },
    ],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function buildPreviewCollabSummary() {
  const byObjectType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const item of previewCollabRecords) {
    byObjectType[item.objectType] = (byObjectType[item.objectType] || 0) + 1;
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  }

  const recentActivity = previewCollabRecords
    .flatMap((record: Record<string, any>) =>
      (record.history || []).map((event: Record<string, any>) => ({
        recordId: record.recordId,
        traceId: record.traceId,
        objectType: record.objectType,
        eventType: event.eventType,
        status: event.status,
        title: record.title,
        summary: event.summary,
        provider: record.route.provider,
        occurredAt: event.at,
      })),
    )
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
    .slice(0, 12);

  const config = previewIntegrations.group_collab!;
  const adapters = (config.adapters || []).map((item) => ({
    ...item,
    health: item.provider === 'mock'
      ? 'mock'
      : item.enabled && item.webhookUrl
        ? 'ready'
        : item.enabled
          ? 'needs_config'
          : 'disabled',
    isDefault: item.id === config.defaultAdapterId,
    liveSupported: item.provider === 'feishu',
  }));

  return {
    contractVersion: 'collab.v1',
    totalRecords: previewCollabRecords.length,
    pendingApprovals: previewCollabRecords.filter((item) => item.status === 'awaiting_approval').length,
    pendingConfirmations: previewCollabRecords.filter((item) => item.status === 'awaiting_confirmation').length,
    pendingReminders: previewCollabRecords.filter((item) => item.objectType === 'reminder').length,
    recentActivity,
    pendingItems: previewCollabRecords.filter((item) => item.status === 'awaiting_approval' || item.status === 'awaiting_confirmation' || item.objectType === 'reminder').slice(0, 10),
    byObjectType,
    byStatus,
    adapters,
    config,
  };
}

function emptyPreviewTraceObjectStats() {
  return {
    message: 0,
    report: 0,
    approval: 0,
    confirmation: 0,
    reminder: 0,
    receipt: 0,
  };
}

function buildPreviewTraceSummary(records: Array<Record<string, any>>) {
  const objectStats = emptyPreviewTraceObjectStats();
  const statusStats: Record<string, number> = {};
  for (const item of records) {
    if (item.objectType in objectStats) {
      objectStats[item.objectType as keyof typeof objectStats] += 1;
    }
    statusStats[item.status] = (statusStats[item.status] || 0) + 1;
  }

  const insights = [];
  if (objectStats.approval > 0) {
    insights.push({
      category: 'approval_blocker',
      objectType: 'approval',
      insight: statusStats.awaiting_approval || statusStats.rejected || statusStats.failed
        ? 'approval items are the main visible blocking pattern in this collaboration trace'
        : 'approval items in this collaboration trace moved through without visible blockage',
      confidence: 0.7,
      allowedLayer: 'tenant_private',
    });
  }
  if (objectStats.confirmation > 0) {
    insights.push({
      category: 'confirmation_momentum',
      objectType: 'confirmation',
      insight: statusStats.confirmed
        ? 'confirmation items helped move the collaboration flow forward'
        : 'confirmation items still need follow-up before they can move the flow forward',
      confidence: 0.65,
      allowedLayer: 'tenant_private',
    });
  }
  if (objectStats.reminder > 0) {
    insights.push({
      category: 'reminder_effectiveness',
      objectType: 'reminder',
      insight: 'reminder cadence produced an observable delivery or acknowledgement signal',
      confidence: 0.6,
      allowedLayer: 'tenant_private',
    });
  }
  if (objectStats.receipt > 0) {
    insights.push({
      category: 'receipt_health',
      objectType: 'receipt',
      insight: statusStats.failed
        ? 'receipt health is degraded because at least one delivery or acknowledgement failed'
        : 'receipt health indicates the collaboration delivery path is observable',
      confidence: 0.7,
      allowedLayer: 'tenant_private',
    });
  }

  if (!insights.length) {
    insights.push({
      category: 'tenant_preference',
      objectType: 'message',
      insight: 'this trace contains too little collaboration signal for a durable tenant preference',
      confidence: 0.2,
      allowedLayer: 'tenant_private',
    });
  }

  return {
    contractVersion: 'collab.v1',
    summaryType: 'trace_sanitized_summary',
    source: {
      sourceKind: 'group_collab_trace',
      sourceRecordCount: records.length,
      inboundTraceId: 'redacted',
      rawIdentifiersReturned: false,
      rawHistoryReturned: false,
    },
    objectStats,
    statusStats,
    insights,
    tenantPrivateCandidates: insights,
    redaction: {
      rawTraceIdReturned: false,
      rawRequestIdsReturned: false,
      rawCorrelationIdsReturned: false,
      rawInboundTraceIdReturned: false,
      rawHistoryReturned: false,
      removedFields: ['traceId', 'requestId', 'correlationId', 'inboundTraceId', 'history.raw', 'receipt.raw', 'providerMessageId'],
    },
    generatedAt: nowIso(),
  };
}

function buildPreviewCollabKnowledgeSummaries() {
  return [
    {
      captureId: 'gk_demo_001',
      tenantId: 'tenant_demo',
      sourceLayer: 'tenant_private',
      sourceType: 'group_collab_approval_pattern',
      objectType: 'approval',
      insight: 'Price-commit approvals stall most often when the offer window is not stated explicitly.',
      evidenceRefs: [{ kind: 'group_collab_record', recordId: 'collab_demo_approval' }],
      createdAt: nowIso(),
    },
    {
      captureId: 'gk_demo_002',
      tenantId: 'tenant_demo',
      sourceLayer: 'tenant_private',
      sourceType: 'group_collab_followup_pattern',
      objectType: 'reminder',
      insight: 'Short reminders tied to a concrete deadline produce the highest acknowledgement rate.',
      evidenceRefs: [{ kind: 'group_collab_record', recordId: 'collab_demo_reminder' }],
      createdAt: nowIso(),
    },
    {
      captureId: 'gk_demo_003',
      tenantId: 'tenant_demo',
      sourceLayer: 'tenant_private',
      sourceType: 'group_collab_summary',
      objectType: 'receipt',
      insight: 'Receipt acknowledgements are the clearest signal that the collaboration chain stayed healthy end-to-end.',
      evidenceRefs: [{ kind: 'group_collab_record', recordId: 'collab_demo_receipt' }],
      createdAt: nowIso(),
    },
  ];
}

function buildPreviewRuntimeKnowledgeContext(input?: {
  tenantId?: string;
  industryTag?: string;
  roleId?: string;
  taskType?: string;
}) {
  const tenantId = input?.tenantId || 'tenant_demo';
  const industryTag = input?.industryTag || '餐饮服务_中餐馆';
  const tenantPrivateItems = buildPreviewCollabKnowledgeSummaries().map((item) => ({
    layer: 'tenant_private',
    source_type: item.sourceType,
    source_id: item.captureId,
    title: `Tenant collab summary: ${item.objectType}`,
    tenant_id: tenantId,
    updated_at: item.createdAt,
    metadata: {
      object_type: item.objectType,
      insight: item.insight,
      evidence_refs: item.evidenceRefs,
    },
  }));
  const platformCommonItems = [
    {
      layer: 'platform_common',
      source_type: 'rag_pack_schema',
      source_id: 'rag_pack_schema',
      title: 'RAG Pack Schema',
      path: 'dragon-senate-saas-v2/rag_factory/rag_pack_schema.json',
    },
    {
      layer: 'platform_common',
      source_type: 'lobster_operating_model',
      source_id: 'lobster_operating_model',
      title: 'Lobster Operating Model',
      path: 'packages/lobsters/lobster-operating-model.json',
    },
  ];
  const platformIndustryItems = [
    {
      layer: 'platform_industry',
      source_type: 'industry_taxonomy',
      source_id: industryTag,
      title: `Industry Taxonomy: ${industryTag}`,
      path: 'dragon-senate-saas-v2/data/industry_subcategories.json',
      industry_tag: industryTag,
    },
    {
      layer: 'platform_industry',
      source_type: 'industry_knowledge_pack',
      source_id: `${input?.roleId || 'strategist'}:${industryTag}`,
      title: `Industry Knowledge Packs: ${industryTag}`,
      path: `dragon-senate-saas-v2/data/knowledge-packs/${input?.roleId || 'strategist'}/${industryTag}`,
      industry_tag: industryTag,
    },
  ];

  return {
    version: 'knowledge_context.v1',
    tenant_id: tenantId,
    industry_tag: industryTag,
    task_type: input?.taskType || 'run_dragon_team',
    generated_at: nowIso(),
    layers: {
      platform_common: {
        count: platformCommonItems.length,
        items: platformCommonItems,
      },
      platform_industry: {
        count: platformIndustryItems.length,
        items: platformIndustryItems,
      },
      tenant_private: {
        count: tenantPrivateItems.length,
        items: tenantPrivateItems,
      },
    },
    explainable_sources: [...platformCommonItems, ...platformIndustryItems, ...tenantPrivateItems],
    policy: {
      raw_group_collab_trace_included: false,
      tenant_private_summary_only: true,
      platform_backflow_allowed: false,
    },
  };
}

let previewApprovals = [
  {
    approval_id: 'appr_demo_001',
    status: 'pending',
    approval_channel: 'mobile_web',
    approval_state: 'pending',
    action_summary: '发布前审批：同城投放任务',
    task_description: '请确认是否允许执行同城投放 + 线索回流链路',
    scope: {
      task_description: '同城投放 + 线索回流链路',
      risk_level: 'P1',
      score: 0.82,
      lead_count: 18,
      trace_id: 'trace_demo_001',
    },
  },
];

const previewAutopilotSignals = [
  {
    ruleKey: 'queue.process.fail',
    severity: 'P2',
    state: 'ok',
    message: '过去 60 分钟内未发现执行队列失败峰值。',
    value: 0,
    threshold: 3,
    windowMinutes: 60,
    sourceQueue: 'content_forge_queue',
  },
  {
    ruleKey: 'dlq.enqueue',
    severity: 'P2',
    state: 'fired',
    message: '过去 60 分钟内有 1 条消息进入 DLQ，建议回到 Trace 核查原因。',
    value: 1,
    threshold: 1,
    windowMinutes: 60,
    sourceQueue: 'matrix_dispatch_queue',
  },
];

const previewKernelSignals = [
  {
    rule_key: 'system_emergent.approval_backlog',
    family: 'system_emergent',
    severity: 'P2',
    state: 'fired',
    value: 1,
    threshold: 1,
    message: '当前审批链路存在积压。',
    recommended_action: '优先进入审批中心处理高风险动作，避免影响任务推进。',
  },
];

const previewTraceTaskStates = [
  {
    recordId: 'task_state_demo_001',
    taskId: 'cmp_demo_001',
    traceId: 'trace_demo_001',
    stage: 'dispatch',
    state: 'running',
    tenantId: 'tenant_demo',
    campaignId: 'cmp_demo_001',
    sourceQueue: 'matrix_dispatch_queue',
    nodeId: 'node_demo_01',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    recordId: 'task_state_demo_002',
    taskId: 'lead_follow_demo_001',
    traceId: 'trace_demo_001',
    stage: 'followup',
    state: 'queued',
    tenantId: 'tenant_demo',
    campaignId: 'cmp_demo_001',
    sourceQueue: 'lead_harvest_queue',
    nodeId: 'node_demo_02',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
];

const previewDlqItems = [
  {
    dlqJobId: 'dlq_demo_001',
    sourceQueue: 'matrix_dispatch_queue',
    sourceJobId: 'job_demo_001',
    tenantId: 'tenant_demo',
    traceId: 'trace_demo_001',
    campaignId: 'cmp_demo_001',
    taskId: 'cmp_demo_001',
    nodeId: 'node_demo_02',
    stage: 'dispatch',
    errorCode: 'dispatch.timeout',
    errorMessage: '边缘节点响应超时，已推入 DLQ。',
    retryable: true,
    attemptsMade: 1,
    maxAttempts: 3,
    originalPayload: { edge_id: 'node_demo_02' },
    failedAt: nowIso(),
  },
];

const previewReplayAudits = [
  {
    auditId: 'replay_demo_001',
    sourceQueue: 'matrix_dispatch_queue',
    dlqJobId: 'dlq_demo_001',
    sourceJobId: 'job_demo_001',
    taskId: 'cmp_demo_001',
    stage: 'dispatch',
    traceId: 'trace_demo_001',
    replayJobId: 'job_replay_001',
    replayCount: 1,
    requestedAt: nowIso(),
    completedAt: nowIso(),
    operatorId: 'demo_admin',
    operatorName: '演示管理员',
    operatorSource: 'preview',
    result: 'success',
    tenantId: 'tenant_demo',
  },
];

const previewAuditLogs = [
  {
    id: 'audit_demo_001',
    ts: nowIso(),
    level: 'WARN',
    module: 'AUTOPILOT',
    nodeId: 'node_demo_02',
    traceId: 'trace_demo_001',
    eventType: 'dlq.enqueue',
    message: '分发链路进入 DLQ，等待人工复核。',
    campaignId: 'cmp_demo_001',
    sourceQueue: 'matrix_dispatch_queue',
    taskId: 'cmp_demo_001',
    stage: 'dispatch',
  },
  {
    id: 'audit_demo_002',
    ts: nowIso(),
    level: 'INFO',
    module: 'DISPATCHER',
    nodeId: 'node_demo_01',
    traceId: 'trace_demo_001',
    eventType: 'dispatch.success',
    message: '主节点已成功接收本轮任务。',
    campaignId: 'cmp_demo_001',
    sourceQueue: 'matrix_dispatch_queue',
    taskId: 'cmp_demo_001',
    stage: 'dispatch',
  },
  {
    id: 'audit_demo_003',
    ts: nowIso(),
    level: 'SECURITY',
    module: 'WEBHOOK',
    nodeId: 'node_demo_01',
    traceId: 'trace_demo_001',
    eventType: 'approval.required',
    message: '高风险动作已被审批链路接管。',
    campaignId: 'cmp_demo_001',
    sourceQueue: 'lead_harvest_queue',
    taskId: 'lead_follow_demo_001',
    stage: 'followup',
  },
];

const previewKernelReport = {
  ok: true,
  trace_id: 'trace_demo_001',
  kernel_report: {
    risk_level: 'P2',
    strategy_version: 'default',
    score: 0.82,
    leads: [{ lead_id: 'lead_demo_001' }, { lead_id: 'lead_demo_002' }],
    edge_targets: [{ edge_id: 'node_demo_01' }, { edge_id: 'node_demo_02' }],
    risk_taxonomy: {
      primary_family: 'system_emergent',
    },
    autonomy: {
      route: 'review_required',
      approval_latency_sec: 96,
    },
    runtime: {
      score: 0.82,
    },
    industry_knowledge_packs: {
      ok: true,
      industry_tag: 'hotel_stay.apartment_hotel',
      matched_industry: '酒店民宿_公寓酒店',
      roles_total: 9,
      roles_ready: 9,
      files_expected: 36,
      files_ready: 36,
      missing: [],
      role_packs: {
        radar: {
          ready: true,
          path: 'dragon-senate-saas-v2/data/knowledge-packs/radar/酒店民宿_公寓酒店',
          packs: {
            industry_rules: {
              file_name: 'industry-rules.json',
              path: 'dragon-senate-saas-v2/data/knowledge-packs/radar/酒店民宿_公寓酒店/industry-rules.json',
              item_count: 12,
              case_count: 0,
              preview: [{ id: 'rule_signal_window', title: '入住窗口信号', priority: 'high' }],
            },
          },
        },
        strategist: {
          ready: true,
          path: 'dragon-senate-saas-v2/data/knowledge-packs/strategist/酒店民宿_公寓酒店',
          packs: {
            hooks: {
              file_name: 'hooks-library.json',
              path: 'dragon-senate-saas-v2/data/knowledge-packs/strategist/酒店民宿_公寓酒店/hooks-library.json',
              item_count: 10,
              case_count: 0,
              preview: [{ id: 'hook_long_stay', title: '长住策略钩子', priority: 'high' }],
            },
          },
        },
        inkwriter: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/inkwriter/酒店民宿_公寓酒店', packs: {} },
        visualizer: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/visualizer/酒店民宿_公寓酒店', packs: {} },
        dispatcher: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/dispatcher/酒店民宿_公寓酒店', packs: {} },
        echoer: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/echoer/酒店民宿_公寓酒店', packs: {} },
        catcher: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/catcher/酒店民宿_公寓酒店', packs: {} },
        abacus: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/abacus/酒店民宿_公寓酒店', packs: {} },
        followup: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/followup/酒店民宿_公寓酒店', packs: {} },
      },
    },
  },
  approval_journal: [
    {
      ts: nowIso(),
      event_type: 'approval_requested',
      decision: 'pending',
      reason: '需要人工确认外部分发动作',
      approval_id: 'appr_demo_001',
    },
  ],
  industry_kb: {
    metrics: {
      industry_tag: 'food_chinese_restaurant',
      industry_kb_hits: 6,
      industry_kb_requested: 7,
      industry_kb_hit_rate: 0.857,
      industry_kb_effect_delta: 0.18,
      references: [
        {
          entry_type: 'playbook',
          title: '同城餐饮短视频获客',
          effect_score: 0.82,
          source_account: 'tenant_demo',
        },
      ],
    },
  },
};

const previewAiSkillsOverview = {
  ok: true,
  tenant_id: 'tenant_demo',
  overview: {
    summary: {
      agents_total: 10,
      agents_enabled: 10,
      skills_total: 24,
      nodes_total: 18,
      kb_profiles_total: 6,
      rag_packs_total: 14,
      workflow_templates_total: 9,
    },
    profiles: [
      { agent_id: 'commander', enabled: true, profile_version: 'v1', runtime_mode: 'hybrid', skills_count: 3, nodes_count: 2 },
      { agent_id: 'radar', enabled: true, profile_version: 'v1', runtime_mode: 'cloud', skills_count: 2, nodes_count: 2 },
      { agent_id: 'strategist', enabled: true, profile_version: 'v1', runtime_mode: 'hybrid', skills_count: 3, nodes_count: 2 },
      { agent_id: 'inkwriter', enabled: true, profile_version: 'v1', runtime_mode: 'cloud', skills_count: 3, nodes_count: 2 },
      { agent_id: 'visualizer', enabled: true, profile_version: 'v1', runtime_mode: 'cloud', skills_count: 2, nodes_count: 2 },
      { agent_id: 'dispatcher', enabled: true, profile_version: 'v1', runtime_mode: 'hybrid', skills_count: 3, nodes_count: 2 },
      { agent_id: 'echoer', enabled: true, profile_version: 'v1', runtime_mode: 'cloud', skills_count: 2, nodes_count: 2 },
      { agent_id: 'catcher', enabled: true, profile_version: 'v1', runtime_mode: 'hybrid', skills_count: 2, nodes_count: 2 },
      { agent_id: 'abacus', enabled: true, profile_version: 'v1', runtime_mode: 'hybrid', skills_count: 2, nodes_count: 1 },
      { agent_id: 'followup', enabled: true, profile_version: 'v1', runtime_mode: 'cloud', skills_count: 2, nodes_count: 1 },
    ],
    agent_profiles: [
      'commander',
      'radar',
      'strategist',
      'inkwriter',
      'visualizer',
      'dispatcher',
      'echoer',
      'catcher',
      'abacus',
      'followup',
    ].map((agentId) => ({
      agent_id: agentId,
      enabled: true,
      profile_version: 'openclaw-native-v1',
      runtime_mode: agentId === 'commander' ? 'hybrid' : 'cloud',
      role_prompt: `${agentId} role prompt`,
      run_contract: { stage: 'demo' },
      skills: [
        {
          skill_id: `${agentId}_skill_1`,
          name: '基础技能',
          capability: '演示能力',
          node_id: `${agentId}_node_1`,
          enabled: true,
        },
      ],
      nodes: [
        {
          node_id: `${agentId}_node_1`,
          type: 'transform',
          title: '演示节点',
          enabled: true,
          timeout_sec: 120,
        },
      ],
      tags: ['demo'],
    })),
    catalog: {
      agent_ids: ['commander', 'radar', 'strategist', 'inkwriter', 'visualizer', 'dispatcher', 'echoer', 'catcher', 'abacus', 'followup'],
      capabilities: ['strategy', 'content', 'dispatch', 'lead'],
      default_profiles: [],
      schema_version: 'demo-v1',
    },
    llm_bindings: [
      { agent_id: 'commander', enabled: true, task_type: 'strategy_planning', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.3, max_tokens: 4000 },
      { agent_id: 'radar', enabled: true, task_type: 'radar_enrichment', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.2, max_tokens: 3000 },
      { agent_id: 'strategist', enabled: true, task_type: 'strategy_planning', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.3, max_tokens: 4000 },
      { agent_id: 'inkwriter', enabled: true, task_type: 'content_generation', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.6, max_tokens: 4000 },
      { agent_id: 'visualizer', enabled: true, task_type: 'visual_prompting', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.4, max_tokens: 3000 },
      { agent_id: 'dispatcher', enabled: true, task_type: 'dispatch_routing', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.1, max_tokens: 2500 },
      { agent_id: 'echoer', enabled: true, task_type: 'engagement_copy', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.5, max_tokens: 2500 },
      { agent_id: 'catcher', enabled: true, task_type: 'intent_classification', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.2, max_tokens: 2500 },
      { agent_id: 'abacus', enabled: true, task_type: 'lead_scoring', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.2, max_tokens: 2500 },
      { agent_id: 'followup', enabled: true, task_type: 'sales_followup', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.4, max_tokens: 3000 },
    ],
    llm_providers: [
      { provider_id: 'deepseek', label: 'DeepSeek', enabled: true, route: 'cloud', base_url: 'https://api.deepseek.com/v1', default_model: 'deepseek-chat' },
      { provider_id: 'openai', label: 'OpenAI', enabled: false, route: 'cloud', base_url: 'https://api.openai.com/v1', default_model: 'gpt-4o-mini' },
    ],
    industry_kb_profiles: [{ industry_tag: 'food_chinese_restaurant', tenant_id: 'tenant_demo' }],
    industry_kb_stats: [],
    industry_kb_metrics: {},
    agent_rag_pack_summary: [
      { agent_id: 'commander', pack_count: 2 },
      { agent_id: 'radar', pack_count: 2 },
      { agent_id: 'strategist', pack_count: 2 },
      { agent_id: 'inkwriter', pack_count: 2 },
      { agent_id: 'visualizer', pack_count: 1 },
      { agent_id: 'dispatcher', pack_count: 1 },
      { agent_id: 'echoer', pack_count: 1 },
      { agent_id: 'catcher', pack_count: 1 },
      { agent_id: 'abacus', pack_count: 1 },
      { agent_id: 'followup', pack_count: 1 },
    ],
    workflow_templates: [
      { template_name: '同城短视频获客', industry_tag: 'food_chinese_restaurant', version: 'v1', updated_at: nowIso() },
      { template_name: '高意向线索跟进', industry_tag: 'food_chinese_restaurant', version: 'v1', updated_at: nowIso() },
    ],
    workflow_templates_by_industry: {
      food_chinese_restaurant: 5,
      beauty_salon: 2,
      dental_clinic: 2,
    },
  },
};

let previewSkillImprovementProposals: SkillImprovementProposal[] = [
  {
    proposal_id: 'sip_demo_inkwriter_001',
    tenant_id: 'tenant_demo',
    lobster_id: 'inkwriter',
    skill_id: 'inkwriter_copy_generate',
    trigger_type: 'repeated_human_revision',
    status: 'scanned',
    evidence_refs: [
      {
        source_type: 'activity_stream',
        source_id: 'act_demo_revision_1024',
        summary: 'Three recent copy runs needed manual edits for overpromising local-store conversion claims.',
        confidence: 0.82,
      },
    ],
    patches: [
      {
        target_file: 'packages/lobsters/lobster-inkwriter/skill.manifest.yaml',
        patch_type: 'manifest_metadata',
        before: { publish_status: 'approved', effective_conditions: {} },
        after: {
          publish_status: 'review',
          scan_status: 'not_scanned',
          effective_conditions: { last_improvement_trigger: 'repeated_human_revision' },
          gotchas: ['Avoid guaranteed conversion claims without tenant-approved evidence.'],
          stability: 'proposal_pending_review',
        },
        summary: 'Draft a safer manifest update from repeated human revision evidence without mutating the live Skill asset.',
      },
    ],
    scan_status: 'safe',
    scan_report: { risk_level: 'low', issues: [], confidence: 0.9 },
    created_at: nowIso(),
    updated_at: nowIso(),
  },
  {
    proposal_id: 'sip_demo_dispatcher_001',
    tenant_id: 'tenant_demo',
    lobster_id: 'dispatcher',
    skill_id: 'dispatcher_publish_route',
    trigger_type: 'edge_publish_retry_spike',
    status: 'review',
    evidence_refs: [
      {
        source_type: 'edge_audit',
        source_id: 'edge_demo_retry_017',
        summary: 'Edge publish retries increased after session refresh; propose adding a gotcha and approval note.',
        confidence: 0.76,
      },
    ],
    patches: [
      {
        target_file: 'packages/lobsters/lobster-dispatcher/skill.manifest.yaml',
        patch_type: 'manifest_metadata',
        before: { publish_status: 'approved', gotchas: [] },
        after: {
          publish_status: 'review',
          scan_status: 'not_scanned',
          gotchas: ['When session refresh repeats twice, escalate to Commander before another publish attempt.'],
          effective_conditions: { last_improvement_trigger: 'edge_publish_retry_spike' },
          stability: 'proposal_pending_review',
        },
        summary: 'Capture an edge retry lesson as a review-gated dispatcher Skill metadata patch.',
      },
    ],
    scan_status: 'warn',
    scan_report: {
      risk_level: 'medium',
      issues: ['Touches publish routing language; keep Commander approval before live apply.'],
      confidence: 0.84,
    },
    created_at: nowIso(),
    updated_at: nowIso(),
  },
];

const previewRagCatalog = {
  ok: true,
  catalog: {
    profile: 'commander',
    target_count: 4,
    agents: [
      { agent_id: 'commander', target_count: 2 },
      { agent_id: 'strategist', target_count: 2 },
    ],
    targets: [],
  },
};

const previewRagPacks = {
  ok: true,
  tenant_id: 'tenant_demo',
  count: 4,
  summary: [
    { agent_id: 'commander', pack_count: 2, last_updated: nowIso() },
    { agent_id: 'strategist', pack_count: 2, last_updated: nowIso() },
  ],
  items: [
    {
      tenant_id: 'tenant_demo',
      profile: 'commander',
      agent_id: 'commander',
      knowledge_pack_id: 'pack_commander_001',
      knowledge_pack_name: '餐饮增长总脑包',
      payload: { summary: '总脑层的行业策略与审批框架。', tags: ['策略', '审批'] },
      updated_at: nowIso(),
      title: '餐饮增长总脑包',
      scope: 'tenant',
    },
    {
      tenant_id: 'tenant_demo',
      profile: 'commander',
      agent_id: 'strategist',
      knowledge_pack_id: 'pack_strategist_001',
      knowledge_pack_name: '餐饮同城策略包',
      payload: { summary: '用于同城获客与内容路线拆解。', tags: ['同城', '内容'] },
      updated_at: nowIso(),
      title: '餐饮同城策略包',
      scope: 'profile',
    },
  ],
};

const previewFleetNodes = [
  {
    nodeId: 'node_demo_01',
    tenantId: 'tenant_demo',
    clientId: 'client_demo',
    clientName: '龙虾池演示节点 A',
    status: 'ONLINE',
    lastPingAt: nowIso(),
    cpuPercent: 32,
    memoryPercent: 41,
    platforms: ['douyin', 'wechat'],
  },
  {
    nodeId: 'node_demo_02',
    tenantId: 'tenant_demo',
    clientId: 'client_demo',
    clientName: '龙虾池演示节点 B',
    status: 'BUSY',
    lastPingAt: nowIso(),
    cpuPercent: 62,
    memoryPercent: 58,
    platforms: ['telegram'],
  },
];

const previewCompetitiveFormulaLibrary = [
  {
    id: 'formula_demo_001',
    category: '爆款拆解',
    title: '29 秒讲清门店爆款套餐',
    hook: '附近的人都在冲这个双人餐',
    tags: ['餐饮', '同城', '短视频'],
    confidence: 0.91,
    extractedAt: nowIso(),
    source: {
      platform: 'douyin',
      accountId: 'acct_demo_001',
      accountName: 'demo_food',
      postUrl: 'https://example.com/post/1',
    },
  },
  {
    id: 'formula_demo_002',
    category: '评论承接',
    title: '高意向评论区回复模板',
    hook: '先给你看预约最方便的方式',
    tags: ['线索', '转化'],
    confidence: 0.86,
    extractedAt: nowIso(),
    source: {
      platform: 'xiaohongshu',
      accountId: 'acct_demo_002',
      accountName: 'demo_xhs',
      postUrl: 'https://example.com/post/2',
    },
  },
];

const previewGraphSnapshot = {
  status: 'success',
  data: {
    namespace: 'tenant_demo',
    reference_time: nowIso(),
    entities: [
      {
        entity_id: 'lead_001',
        name: '王女士',
        entity_type: 'lead',
        namespace: 'tenant_demo',
        attributes: { score: 92, channel: 'wechat' },
        created_at: nowIso(),
        updated_at: nowIso(),
      },
      {
        entity_id: 'campaign_001',
        name: '同城餐饮获客',
        entity_type: 'campaign',
        namespace: 'tenant_demo',
        attributes: { channel: 'douyin' },
        created_at: nowIso(),
        updated_at: nowIso(),
      },
      {
        entity_id: 'store_001',
        name: '龙虾池示范店',
        entity_type: 'merchant',
        namespace: 'tenant_demo',
        attributes: { city: 'Shanghai' },
        created_at: nowIso(),
        updated_at: nowIso(),
      },
    ],
    edges: [
      {
        edge_id: 'edge_001',
        source_id: 'lead_001',
        target_id: 'campaign_001',
        relation: 'generated_by',
        fact: '该线索来自同城餐饮获客活动',
        namespace: 'tenant_demo',
        valid_at: nowIso(),
        episode_id: 'episode_demo_001',
        confidence: 0.91,
      },
      {
        edge_id: 'edge_002',
        source_id: 'campaign_001',
        target_id: 'store_001',
        relation: 'serves',
        fact: '活动服务于龙虾池示范店',
        namespace: 'tenant_demo',
        valid_at: nowIso(),
        episode_id: 'episode_demo_002',
        confidence: 0.88,
      },
    ],
  },
};

const previewGraphTimeline = {
  status: 'success',
  data: [
    {
      edge_id: 'edge_timeline_001',
      source_id: 'campaign_001',
      target_id: 'lead_001',
      relation: 'captured',
      fact: '评论区线索被 catcher 识别并进入 CRM',
      namespace: 'tenant_demo',
      valid_at: nowIso(),
      episode_id: 'episode_timeline_001',
      confidence: 0.93,
    },
  ],
};

const previewUsecases = [
  {
    id: 'food_growth_starter',
    name: '餐饮门店同城获客 Starter',
    category: 'lead_gen',
    difficulty: 'beginner',
    description: '把短视频获客、评论承接和线索回流做成一个可直接启动的本地商家用例。',
    pain_point: '发了内容但没有稳定的到店线索。',
    lobsters: ['strategist', 'inkwriter', 'catcher', 'followup'],
    skills_required: ['strategy-planning', 'copywriting', 'lead-routing'],
    channels: ['douyin', 'wechat'],
    setup_steps: [
      { step: 1, action: '确认行业标签与主渠道', code_type: 'config', requires_user_input: true },
      { step: 2, action: '生成同城短视频内容包', code_type: 'prompt' },
      { step: 3, action: '配置评论区承接与线索回流', code_type: 'config' },
    ],
    scheduler_config: {
      kind: 'cron',
      schedule: '每日 12:00 / 18:00',
      session_mode: 'shared',
    },
    tips: ['先跑一个门店样本，再复制到更多门店。'],
    estimated_cost_per_run: '¥18-35',
    tags: ['starter', 'local-growth'],
  },
  {
    id: 'competitor_intel_loop',
    name: '竞品爆款公式雷达',
    category: 'competitive_intel',
    difficulty: 'intermediate',
    description: '定期抓取竞品内容信号并沉淀为可复用脚本结构。',
    pain_point: '不知道竞品最近为什么突然跑起来。',
    lobsters: ['radar', 'strategist', 'inkwriter'],
    skills_required: ['signal-scan', 'industry-kb'],
    channels: ['douyin', 'xiaohongshu'],
    setup_steps: [
      { step: 1, action: '维护竞品账号列表', code_type: 'config', requires_user_input: true },
      { step: 2, action: '触发爆款拆解入库', code_type: 'prompt' },
    ],
    tips: ['先从 3-5 个竞品号开始，避免过量噪声。'],
    estimated_cost_per_run: '¥12-20',
    tags: ['intel', 'radar'],
  },
];

const previewWorkflowTemplates = [
  {
    template_id: 'tpl_food_growth',
    name: '同城短视频获客',
    description: '从策略、内容、下发到线索回流的一条标准工作流模板。',
    category: 'growth',
    use_case: '适合本地餐饮与门店获客场景。',
    workflow_yaml: 'version: v1',
    lobsters_required: ['strategist', 'inkwriter', 'dispatcher', 'catcher'],
    estimated_duration_seconds: 600,
    estimated_tokens: 3200,
    difficulty: 'beginner',
    tags: ['starter', 'lead'],
    is_featured: true,
    use_count: 18,
    created_by: 'demo_admin',
  },
  {
    template_id: 'tpl_followup_ops',
    name: '高意向线索跟进',
    description: '把高意向线索筛选、审批与回访整合进同一条链路。',
    category: 'conversion',
    use_case: '适合需要快速预约和电话跟进的服务业场景。',
    workflow_yaml: 'version: v1',
    lobsters_required: ['catcher', 'abacus', 'followup'],
    estimated_duration_seconds: 420,
    estimated_tokens: 2200,
    difficulty: 'intermediate',
    tags: ['followup', 'crm'],
    is_featured: false,
    use_count: 9,
    created_by: 'demo_admin',
  },
];

const previewRbacPermissions = [
  {
    id: 'perm_demo_001',
    tenant_id: 'tenant_demo',
    resource_type: 'workflow',
    resource_id: '*',
    scope: 'read',
    subject_type: 'role',
    subject_id: 'operator',
    granted: true,
    created_at: nowIso(),
    note: '运营默认可读工作流',
    source: 'custom',
  },
];

const previewRbacRoles = [
  { id: 'admin', name: 'Admin', description: 'Full access' },
  { id: 'operator', name: 'Operator', description: 'Operate campaigns and leads' },
  { id: 'viewer', name: 'Viewer', description: 'Read-only access' },
];

const previewAuditEventTypes = [
  { event_type: 'login', category: 'auth', severity: 'INFO' },
  { event_type: 'campaign_create', category: 'workflow', severity: 'INFO' },
  { event_type: 'lead_reveal', category: 'security', severity: 'WARNING' },
];

const previewAuditEvents = [
  {
    id: 'audit_event_demo_001',
    event_type: 'campaign_create',
    category: 'workflow',
    severity: 'INFO',
    tenant_id: 'tenant_demo',
    user_id: 'demo_admin',
    resource_type: 'campaign',
    resource_id: 'cmp_demo_001',
    details: { after: { status: 'RUNNING' } },
    created_at: nowIso(),
  },
];

let previewWidgetConfig = {
  widget_id: 'widget_demo',
  tenant_id: 'tenant_demo',
  allowed_origins: ['demo.openclaw.ai', 'localhost'],
  welcome_message: '你好，这里是龙虾池演示 Widget。',
  theme_primary: '#14b8a6',
  accent_color: '#0f172a',
  custom_css: '',
  call_to_action: '立即咨询',
  launcher_label: '龙虾池助手',
  auto_open: false,
  launcher_position: 'bottom-right',
  updated_at: nowIso(),
};

const previewPartnerDashboard = {
  agent_id: 'partner_demo',
  tier: 'pro',
  total_seats: 12,
  active_seats: 8,
  monthly_revenue: 26800,
  platform_cost: 17400,
  estimated_net_profit: 9400,
  seat_quota_summary: {
    overall_health: 'healthy',
    quotas: {
      content: { limit: 200, used: 86, usage_pct: 43 },
    },
  },
  content_published_this_month: { douyin: 28, wechat: 12 },
  top_performing_seats: [{ seat_id: 'seat_001', seat_name: '主账号席位 A', score: 92 }],
  white_label: {
    white_label_enabled: true,
    brand_name: '龙虾池代理商示范',
    primary_color: '#14b8a6',
    logo_url: '',
    lobster_names: { strategist: '策略虾' },
  },
};

const previewPartnerSeats = [
  {
    seat_id: 'seat_001',
    seat_name: '主账号席位 A',
    platform: 'douyin',
    account_username: 'demo_douyin',
    client_name: '龙虾池演示',
    overall_health: 'healthy',
    quotas: {
      publish: { limit: 100, used: 42, usage_pct: 42 },
      leads: { limit: 200, used: 58, usage_pct: 29 },
      replies: { limit: 300, used: 120, usage_pct: 40 },
    },
  },
];

const previewPartnerStatements = [
  {
    id: 'stmt_demo_001',
    agent_id: 'partner_demo',
    period: '2026-03',
    seats_purchased: 12,
    seats_active: 8,
    total_purchase_cost: 17400,
    total_resell_revenue: 26800,
    net_profit: 9400,
    bonus_achieved: true,
    bonus_description: '达到季度加速奖励门槛',
    status: 'calculated',
    invoice_url: null,
  },
];

const previewCapabilityRoutes = [
  {
    audit_id: 'cap_route_001',
    created_at: nowIso(),
    tenant_id: 'tenant_demo',
    trace_id: 'trace_demo_001',
    workflow_id: 'wf_demo_001',
    industry_tag: 'food_chinese_restaurant',
    goal: '把同城餐饮获客主线拆成主管能力路由。',
    lobster_sequence: ['strategist', 'inkwriter', 'dispatcher', 'catcher', 'followup'],
    capability_plan: {
      strategist: [{ capability: 'strategy_route', reason: '需要先拆增长路线' }],
      inkwriter: [{ capability: 'copy_pack', reason: '需要形成可发文案' }],
      dispatcher: [{ capability: 'execution_plan', reason: '需要本地节点下发' }],
    },
    reasons: ['先策略后内容再执行', '高意向线索需要 followup 接力'],
  },
];

const previewPlatformFeedback = [
  {
    feedback_id: 'feedback_demo_001',
    created_at: nowIso(),
    tenant_id: 'tenant_demo',
    industry_tag: 'food_chinese_restaurant',
    source_layer: 'tenant_memory',
    target_layer: 'platform_industry',
    source_lobster: 'strategist',
    title: '同城餐饮获客首屏规律',
    abstracted_insight: '首屏出现地标 + 价格锚点时，同城餐饮点击率更稳定。',
    evidence: [{ source: 'report_001', score: 0.91 }],
    tags: ['餐饮', '同城', '点击率'],
    requires_review: true,
    eligible_for_platform: true,
    violations: [],
    metadata: { tenant_name: '龙虾池示范店' },
  },
];

const previewTenantCockpit = {
  ok: true,
  partial: false,
  tenant_id: 'tenant_demo',
  generated_at: nowIso(),
  summary: {
    strategy_level: 2,
    strategy_name: '标准推进',
    strategy_autonomy: 'semi_auto',
    total_tasks: 6,
    running_tasks: 2,
    pending_tasks: 3,
    failed_tasks: 1,
    total_activities: 8,
    total_cost: 86.42,
    graph_nodes: 3,
    graph_edges: 2,
    enabled_capabilities: 7,
    capability_routes_preview: previewCapabilityRoutes.length,
    platform_feedback_preview: previewPlatformFeedback.length,
    warnings_count: 0,
  },
  strategy: {
    level: 2,
    name: '标准推进',
    autonomy: 'semi_auto',
    approval_required: true,
    raw: { current_level: 2, label: '标准推进' },
  },
  tasks: {
    total: 6,
    status_counts: { running: 2, pending: 3, failed: 1 },
    items: [
      { task_id: 'cmp_demo_001', title: '同城餐饮获客', status: 'running' },
      { task_id: 'cmp_demo_002', title: '高意向线索推进', status: 'pending' },
    ],
    raw: null,
  },
  activities: {
    total: 3,
    page: 1,
    page_size: 20,
    items: [
      { id: 'activity_001', type: 'campaign.create', title: '创建获客任务', created_at: nowIso() },
      { id: 'activity_002', type: 'lead.reveal', title: '解密高意向线索', created_at: nowIso() },
    ],
    raw: null,
  },
  cost: {
    range: '7d',
    total_cost: 86.42,
    budget_used: 86.42,
    budget_limit: 500,
    items: [{ lobster_id: 'strategist', cost: 28.4 }, { lobster_id: 'inkwriter', cost: 19.5 }],
    raw: null,
  },
  graph: {
    node_count: 3,
    edge_count: 2,
    updated_at: nowIso(),
    nodes: previewGraphSnapshot.data.entities,
    edges: previewGraphSnapshot.data.edges,
    raw: null,
  },
  capabilities: {
    tenant_tier: 'pro',
    enabled_count: 7,
    total_count: 9,
    items: [
      { key: 'voice_clone', enabled: false, reason: '需升级到 enterprise', upgrade_required: 'enterprise' },
      { key: 'multi_edge_dispatch', enabled: true, max_value: 10 },
      { key: 'group_reports', enabled: true },
    ],
    raw: null,
  },
  governance: {
    capability_routes_preview: previewCapabilityRoutes,
    platform_feedback_preview: previewPlatformFeedback,
  },
  warnings: [],
};

export async function resolvePreviewMockResponse(
  config: InternalAxiosRequestConfig,
): Promise<MockResponse | null> {
  if (!shouldUsePreviewMocks()) return null;

  const method = String(config.method || 'get').toLowerCase();
  const path = String(config.url || '').replace(/^https?:\/\/[^/]+/i, '');
  const body = parseData(config);

  if (method === 'post' && path === '/auth/login') {
    return response(config, { token: 'preview-token', access_token: 'preview-token' });
  }

  if (method === 'post' && path === '/auth/register') {
    return response(config, { code: 0, token: 'preview-token', access_token: 'preview-token' });
  }

  if (method === 'post' && path === '/auth/forgot-password') {
    return response(config, { code: 0, message: '重置邮件已发送（演示模式）' });
  }

  if (method === 'post' && path === '/auth/reset-password') {
    return response(config, { code: 0, message: '密码已重置（演示模式）' });
  }

  if (method === 'get' && path === '/api/v1/crypto/public-key') {
    return response(config, {
      publicKey: 'MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAK3tM5R0Tj6G8Q8G2YQYkI2D0YF6G8p7YF+Yj3Jx0LQw8qU5m0v0nQdYgZxG3oKk0B6gUQ4z7dY8c9qY3n5S8zECAwEAAQ==',
      algorithm: 'RSA-OAEP',
      keySize: 2048,
    });
  }

  if (method === 'get' && path === '/api/v1/audit/logs') {
    return response(config, {
      items: [
        {
          id: 'security_audit_demo_001',
          ts: nowIso(),
          tenantId: 'tenant_demo',
          userId: 'demo_admin',
          username: 'demo_admin',
          action: 'login',
          resource: 'auth',
          resourceId: null,
          method: 'POST',
          path: '/auth/login',
          ipAddress: '127.0.0.1',
          requestBody: '{"username":"demo_admin","password":"***"}',
          responseStatus: 'success',
          duration: 82,
        },
        {
          id: 'security_audit_demo_002',
          ts: nowIso(),
          tenantId: 'tenant_demo',
          userId: 'demo_admin',
          username: 'demo_admin',
          action: 'create_scheduler_task',
          resource: 'scheduler_task',
          resourceId: 'task_demo_001',
          method: 'POST',
          path: '/api/v1/ai/scheduler/tasks',
          ipAddress: '127.0.0.1',
          requestBody: '{"name":"daily-brief","prompt":"***"}',
          responseStatus: 'success',
          duration: 156,
        },
      ],
      total: 2,
      page: 1,
      limit: 50,
    });
  }

  if (method === 'get' && path === '/api/v1/me') {
    return response(config, {
      code: 0,
      data: {
        id: 'demo_admin',
        name: '龙虾池演示账号',
        role: 'admin',
        roles: ['admin'],
        tenantId: 'tenant_demo',
        tenantName: '龙虾池示范店',
        isAdmin: true,
      },
    });
  }

  if (method === 'get' && path === '/api/v1/dashboard/metrics') {
    return response(config, {
      total_leads_today: 28,
      leads_growth_rate: '18%',
      active_campaigns: 6,
      total_videos_published: 19,
      node_health_rate: '96%',
      chart_data_7days: [
        { date: '03-24', leads: 12 },
        { date: '03-25', leads: 15 },
        { date: '03-26', leads: 18 },
        { date: '03-27', leads: 17 },
        { date: '03-28', leads: 24 },
        { date: '03-29', leads: 26 },
        { date: '03-30', leads: 28 },
      ],
    });
  }

  if (method === 'get' && path.startsWith('/api/v1/campaigns')) {
    return response(config, {
      code: 0,
      data: {
        total: previewCampaigns.length,
        list: previewCampaigns,
      },
    });
  }

  if (method === 'post' && path === '/api/v1/campaigns') {
    const nextCampaign = {
      campaign_id: `cmp_demo_${String(previewCampaigns.length + 1).padStart(3, '0')}`,
      industry_template_id: String(body.industry_template_id || 'general_template'),
      status: 'DRAFT',
      daily_publish_limit: Number((body.publish_strategy as Record<string, unknown> | undefined)?.daily_limit ?? 3),
      leads_collected: 0,
      created_at: nowIso(),
    };
    previewCampaigns = [nextCampaign, ...previewCampaigns];
    return response(config, {
      code: 0,
      data: { campaign_id: nextCampaign.campaign_id, status: nextCampaign.status },
    });
  }

  if (method === 'post' && /\/api\/v1\/campaigns\/[^/]+\/terminate$/.test(path)) {
    const campaignId = decodeURIComponent(path.split('/')[4] || '');
    previewCampaigns = previewCampaigns.map((item) =>
      item.campaign_id === campaignId ? { ...item, status: 'TERMINATED' } : item,
    );
    return response(config, { code: 0, data: { ok: true } });
  }

  if (method === 'get' && path.startsWith('/api/v1/leads?')) {
    return response(config, {
      code: 0,
      data: {
        total: previewLeads.length,
        list: previewLeads,
      },
    });
  }

  if (method === 'get' && /\/api\/v1\/leads\/[^/]+\/reveal$/.test(path)) {
    const leadId = decodeURIComponent(path.split('/')[4] || '');
    const lead = previewLeads.find((item) => item.lead_id === leadId);
    return response(config, {
      code: 0,
      data: {
        contact_info: lead?.lead_id === 'lead_demo_001' ? '13800001024' : lead?.lead_id === 'lead_demo_002' ? '18900002231' : '17700008099',
      },
    });
  }

  if (method === 'get' && path === '/autopilot/metrics/dashboard') {
    return response(config, {
      ok: true,
      tenantId: 'tenant_demo',
      windowMinutes: 60,
      query: {},
      totals: {
        queueProcessFail: 0,
        dlqEnqueue: 1,
        replayAttempt: 2,
        replaySuccess: 2,
        replayFailed: 0,
        replaySuccessRate: 1,
      },
      byQueue: {
        queueProcessFail: {},
        dlqEnqueue: { publish_queue: 1 },
      },
    });
  }

  if (method === 'get' && path === '/autopilot/alerts/evaluate') {
    return response(config, {
      ok: true,
      tenantId: 'tenant_demo',
      query: { windowMinutes: 60, sourceQueue: body.sourceQueue as string | undefined },
      signals: previewAutopilotSignals,
    });
  }

  if (method === 'get' && /\/autopilot\/trace\/[^/]+$/.test(path)) {
    const traceId = decodeURIComponent(path.split('/').pop() || 'trace_demo_001');
    return response(config, {
      ok: true,
      traceId,
      tenantId: 'tenant_demo',
      query: { from: '', to: '', errorsOnly: false, sourceQueue: '' },
      taskStates: previewTraceTaskStates.map((item) => ({ ...item, traceId })),
      dlqItems: previewDlqItems.map((item) => ({ ...item, traceId })),
      replayAudits: previewReplayAudits.map((item) => ({ ...item, traceId })),
      behavior: { snapshots: [] },
      fleet: { taskIds: ['cmp_demo_001'], snapshots: [] },
    });
  }

  if (method === 'get' && path === '/autopilot/logs/search') {
    return response(config, {
      ok: true,
      tenantId: 'tenant_demo',
      query: {
        from: '',
        to: '',
        errorsOnly: false,
        sourceQueue: '',
        module: '',
        level: '',
        nodeId: '',
        traceId: '',
        keyword: '',
        limit: 200,
      },
      total: previewAuditLogs.length,
      items: previewAuditLogs,
    });
  }

  if (method === 'get' && path === '/api/v1/ai/commercial/readiness') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      readiness: {
        score: 82,
        status: 'warning',
        blocker_count: 1,
        blockers: [
          {
            id: 'feishu-public-callback',
            severity: 'medium',
            domain: 'integrations',
            title: 'Feishu 公网 callback 待切真',
            detail: '当前仍使用本地演示模式，正式上线前需要配置公网 HTTPS callback。',
            next_action: '准备公网域名、签名密钥和订阅配置。',
          },
        ],
        deploy: { region: 'cn-shanghai', mode: 'preview' },
        payment: { provider: 'mockpay', checkout: 'sandbox' },
        notifications: { mode: 'file', smtp: { configured: false } },
        feishu: { enabled: false, callback_url: '' },
        compliance: { icp_ready: true },
      },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/kernel/alerts') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      count: previewKernelSignals.length,
      fired_count: previewKernelSignals.filter((item) => item.state === 'fired').length,
      totals: {
        kernel_reports_total: 12,
        single_agent_ratio: 0.18,
        inter_agent_ratio: 0.07,
        system_emergent_ratio: 0.12,
        approval_backlog: 1,
        approval_latency_sec: 96,
      },
      signals: previewKernelSignals,
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/kernel\/report\/[^/]+$/.test(path) && !path.endsWith('/rollback')) {
    const traceId = decodeURIComponent(path.split('/').pop() || 'trace_demo_001');
    return response(config, {
      ...previewKernelReport,
      trace_id: traceId,
    });
  }

  if (method === 'post' && /\/api\/v1\/ai\/kernel\/report\/[^/]+\/rollback$/.test(path)) {
    const traceId = decodeURIComponent(path.split('/')[6] || 'trace_demo_001');
    const dryRun = body.dry_run !== false;
    const approvalId = String(body.approval_id || 'appr_demo_001');
    return response(config, {
      ok: true,
      dry_run: dryRun,
      pending_approval: !dryRun && !body.approval_id,
      approval_id: approvalId,
      stage: String(body.stage || 'preflight'),
      rollback_trace_id: `${traceId}_rollback`,
      result: dryRun
        ? undefined
        : {
            status: 'rollback_completed',
            approval_id: approvalId,
          },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/kernel/metrics/dashboard') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      query: { granularity: 'hour' },
      totals: {
        kernel_reports_total: 12,
        kernel_applied: 11,
        strategy_hit_rate: 0.82,
        rollback_trigger_count: 1,
        rollback_success_count: 1,
        rollback_success_rate: 1,
        auto_pass_count: 5,
        auto_block_count: 1,
        review_required_count: 6,
        approval_required_count: 2,
        approval_resolved_count: 1,
        average_approval_latency_sec: 96,
      },
      byRisk: { P0: 0, P1: 1, P2: 4, P3: 7 },
      byRiskFamily: { single_agent: 2, inter_agent: 1, system_emergent: 3 },
      byStrategyVersion: [],
      strategyTrendSeries: [],
      autonomyTrendSeries: [],
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/hitl\/status\/[^/]+$/.test(path)) {
    const approvalId = decodeURIComponent(path.split('/').pop() || 'appr_demo_001');
    return response(config, {
      ok: true,
      approval_id: approvalId,
      status: {
        decision: 'pending',
        operator: '演示管理员',
        updated_at: nowIso(),
      },
      record: {
        approval_id: approvalId,
      },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/approval-gate/pending') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      count: previewApprovals.length,
      items: previewApprovals,
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/approval-gate\/[^/]+$/.test(path)) {
    const approvalId = decodeURIComponent(path.split('/').pop() || '');
    const approval = previewApprovals.find((item) => item.approval_id === approvalId) || previewApprovals[0];
    return response(config, {
      ok: true,
      approval: {
        ...approval,
        agent_id: 'dispatcher',
        tool_id: 'edge_dispatch',
        risk_level: approval?.scope?.risk_level || 'P1',
        request_id: 'req_demo_001',
        user_id: 'demo_admin',
        trace_id: approval?.scope?.trace_id || 'trace_demo_001',
        result: {
          plan: '先审批再下发',
          edge_targets: 2,
        },
        context: {
          campaign_id: 'cmp_demo_001',
          selected_lineup: ['strategist', 'dispatcher', 'catcher'],
        },
        timeline: [
          { ts: nowIso(), event: 'created', actor: 'system' },
          { ts: nowIso(), event: 'pending', actor: 'dispatcher' },
        ],
      },
    });
  }

  if (method === 'post' && path === '/api/v1/ai/approval-gate/decide') {
    const approvalId = String(body.approval_id || '');
    const decision = String(body.decision || 'approved');
    previewApprovals = previewApprovals.filter((item) => item.approval_id !== approvalId);
    return response(config, {
      ok: true,
      approval: {
        approval_id: approvalId,
        approval_state: decision,
        decision,
        reason: String(body.reason || ''),
      },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/hitl/pending') {
    return response(config, {
      ok: true,
      count: previewApprovals.length,
      items: previewApprovals,
    });
  }

  if (method === 'post' && path === '/api/v1/ai/hitl/decide') {
    const approvalId = String(body.approval_id || '');
    previewApprovals = previewApprovals.filter((item) => item.approval_id !== approvalId);
    return response(config, {
      approval_id: approvalId,
      status: { decision: body.decision || 'approved', updated_at: nowIso() },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/health') {
    return response(config, { ok: true, baseUrl: 'preview://ai-subservice' });
  }

  if (method === 'get' && path === '/api/v1/ai/status') {
    return response(config, {
      status: 'ok',
      registered_edges: previewFleetNodes.map((item) => ({ nodeId: item.nodeId })),
      known_edge_skills: [{ skill: 'publish' }, { skill: 'followup' }],
    });
  }

  if (method === 'get' && path === '/api/v1/fleet/nodes') {
    return response(config, { code: 0, data: { list: previewFleetNodes } });
  }

  if (method === 'get' && /\/api\/v1\/edges\/[^/]+\/doctor$/.test(path)) {
    const edgeId = decodeURIComponent(path.split('/')[4] || 'edge-demo');
    return response(config, {
      ok: true,
      edge_id: edgeId,
      doctor: {
        node_id: edgeId,
        generated_at: nowIso(),
        overall_status: edgeId.endsWith('03') ? 'fail' : edgeId.endsWith('02') ? 'warn' : 'ok',
        failed_checks: edgeId.endsWith('03') ? ['process.wss_connected'] : [],
        warn_checks: edgeId.endsWith('02') ? ['session.account_cookie_present'] : [],
        check_count: 6,
        recommended_actions: edgeId.endsWith('03') ? ['检查云端地址、edge_secret 和网络连接'] : edgeId.endsWith('02') ? ['确认客户账号已在本地浏览器登录并保留会话'] : [],
      },
      doctor_overall_status: edgeId.endsWith('03') ? 'fail' : edgeId.endsWith('02') ? 'warn' : 'ok',
      doctor_failed_checks: edgeId.endsWith('03') ? ['process.wss_connected'] : [],
      doctor_warn_checks: edgeId.endsWith('02') ? ['session.account_cookie_present'] : [],
      requested_run: {
        requested_at: nowIso(),
        requested_by: 'preview',
        status: 'completed',
        mode: 'refresh_on_next_heartbeat',
      },
      updated_at: nowIso(),
    });
  }

  if (method === 'post' && /\/api\/v1\/edges\/[^/]+\/doctor\/run$/.test(path)) {
    const edgeId = decodeURIComponent(path.split('/')[4] || 'edge-demo');
    return response(config, {
      ok: true,
      edge_id: edgeId,
      requested: true,
      request: {
        requested_at: nowIso(),
        requested_by: 'preview',
        status: 'queued',
        mode: 'refresh_on_next_heartbeat',
      },
      doctor: {},
    });
  }

  if (method === 'get' && path === '/api/v1/tenant/integrations') {
    return response(config, { code: 0, data: previewIntegrations });
  }

  if (method === 'patch' && path === '/api/v1/tenant/integrations') {
    previewIntegrations = { ...previewIntegrations, ...(body as Partial<TenantIntegrations>) };
    return response(config, { code: 0, data: previewIntegrations });
  }

  if (method === 'post' && path === '/api/v1/tenant/integrations/webhook/test') {
    return response(config, { code: 0, message: 'ok', jobId: 'job_webhook_demo' });
  }

  if (method === 'post' && path === '/api/v1/tenant/integrations/adapter/test') {
    return response(config, { code: 0, data: { ok: true, health: { status: 'healthy' } } });
  }

  if (method === 'get' && path === '/api/v1/collab/contract') {
    return response(config, {
      ok: true,
      contract: {
        contractVersion: 'collab.v1',
        frozenNames: ['approval', 'confirmation', 'reminder', 'receipt', 'dispatchRecords', 'dispatchRecordsSummary', 'mock', 'inboundTraceId', 'traceSanitizedSummary'],
        objectTypes: ['message', 'report', 'approval', 'confirmation', 'reminder', 'receipt'],
        statuses: ['queued', 'sent', 'delivered', 'awaiting_approval', 'approved', 'rejected', 'awaiting_confirmation', 'confirmed', 'acknowledged', 'failed'],
        providers: ['mock', 'feishu', 'wechat_work', 'wechat', 'dingtalk', 'custom'],
        inboundEvents: ['approval.approved', 'approval.rejected', 'confirmation.confirmed', 'receipt.acknowledged', 'receipt.delivered', 'reminder.acknowledged'],
        readModels: {
          dispatchRecords: {
            endpoint: '/api/v1/collab/records',
            method: 'GET',
            truthSource: 'GroupCollabRecord',
            mustInclude: ['recordId', 'traceId', 'objectType', 'status', 'title', 'summary', 'route', 'history'],
          },
          dispatchRecordsSummary: {
            endpoint: '/api/v1/collab/summary',
            method: 'GET',
            truthSource: 'GroupCollabRecord projection',
            pendingItemsShape: 'GroupCollabRecord[]',
            recentActivityMustInclude: ['recordId', 'traceId', 'objectType', 'eventType', 'status', 'title', 'summary', 'provider', 'occurredAt'],
          },
        },
        endpoints: {
          summary: '/api/v1/collab/summary',
          records: '/api/v1/collab/records',
          recordDetail: '/api/v1/collab/records/:recordId',
          dispatch: '/api/v1/collab/dispatch',
          mockInbound: '/api/v1/collab/mock/inbound',
          adapters: '/api/v1/collab/adapters',
          traceSummary: '/api/v1/collab/trace-summary',
        },
        traceBoundary: {
          rawTraceDefaultKnowledgeIngestion: false,
          rawTraceBelongsTo: ['collaboration_audit_evidence', 'execution_trace_evidence', 'explanation_chain_evidence'],
          inboundTraceId: 'preserve_original_trace_for_internal_join_but_redact_in_summary_output',
          traceSummaryOutput: 'sanitized_summary_only',
        },
        forbiddenBackflow: ['raw_approval', 'raw_confirmation', 'raw_reminder', 'raw_receipt', 'raw_summary_mock', 'raw_traceId', 'raw_requestId', 'raw_correlationId', 'raw_inboundTraceId', 'raw_tenant_collaboration_history'],
        allowedTenantPrivateOutputs: ['approval_blocker_pattern', 'confirmation_momentum_pattern', 'reminder_effectiveness_pattern', 'receipt_health_pattern', 'tenant_collaboration_preference'],
        examples: {
          traceSummary: {
            traceId: 'trc_demo_approval',
            output: 'sanitized_summary_only',
          },
        },
      },
    });
  }

  if (method === 'get' && path === '/api/v1/collab/summary') {
    return response(config, { ok: true, summary: buildPreviewCollabSummary() });
  }

  if (method === 'get' && path === '/api/v1/collab/adapters') {
    return response(config, { ok: true, items: buildPreviewCollabSummary().adapters });
  }

  if (method === 'get' && path === '/api/v1/collab/records') {
    const params = (config.params || {}) as Record<string, unknown>;
    const objectType = params.objectType ? String(params.objectType) : '';
    const status = params.status ? String(params.status) : '';
    const provider = params.provider ? String(params.provider) : '';
    const traceId = params.traceId ? String(params.traceId) : '';
    const correlationId = params.correlationId ? String(params.correlationId) : '';
    const limit = Number(params.limit ?? 50);
    const offset = Number(params.offset ?? 0);
    const filtered = previewCollabRecords.filter((item) => {
      if (objectType && item.objectType !== objectType) return false;
      if (status && item.status !== status) return false;
      if (provider && item.route.provider !== provider) return false;
      if (traceId && item.traceId !== traceId) return false;
      if (correlationId && item.correlationId !== correlationId && item.recordId !== correlationId) return false;
      return true;
    });
    return response(config, {
      ok: true,
      contractVersion: 'collab.v1',
      total: filtered.length,
      items: filtered.slice(offset, offset + limit),
    });
  }

  if (method === 'get' && /\/api\/v1\/collab\/records\/[^/]+$/.test(path)) {
    const recordId = decodeURIComponent(path.split('/').pop() || '');
    const record = previewCollabRecords.find((item) => item.recordId === recordId);
    if (!record) {
      return response(config, { ok: false, message: 'record not found' }, 404);
    }
    return response(config, {
      ok: true,
      contractVersion: 'collab.v1',
      record,
    });
  }

  if (method === 'post' && path === '/api/v1/collab/dispatch') {
    const adapterId = String(body.adapterId || previewIntegrations.group_collab?.defaultAdapterId || 'mock-default');
    const adapter = previewIntegrations.group_collab?.adapters.find((item) => item.id === adapterId)
      || previewIntegrations.group_collab?.adapters[0];
    const provider = adapter?.provider || 'mock';
    const record = {
      recordId: `collab_${Math.random().toString(36).slice(2, 10)}`,
      tenantId: 'tenant_demo',
      requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
      traceId: String(body.traceId || `trc_${Math.random().toString(36).slice(2, 10)}`),
      correlationId: body.correlationId ? String(body.correlationId) : undefined,
      objectType: String(body.objectType || 'report'),
      direction: 'outbound',
      status: body.objectType === 'approval'
        ? 'awaiting_approval'
        : body.objectType === 'confirmation'
          ? 'awaiting_confirmation'
          : body.objectType === 'reminder'
            ? 'sent'
            : 'delivered',
      title: String(body.title || '群协作消息'),
      summary: String(body.summary || body.body || ''),
      body: String(body.body || ''),
      route: {
        adapterId,
        provider,
        mode: adapter?.mode || 'mock',
        chatId: body?.target?.chatId || adapter?.defaultChatId || 'mock://ops-room',
        targetName: body?.target?.targetName || adapter?.defaultTargetName || 'Mock Ops Room',
      },
      tags: Array.isArray(body.tags) ? body.tags : [],
      metadata: {
        ...(body.metadata || {}),
        deliveryMode: body.deliveryMode || 'auto',
        fallbackUsed: provider !== 'feishu' || !adapter?.enabled,
      },
      history: [
        {
          eventId: `evt_${Math.random().toString(36).slice(2, 10)}`,
          eventType: 'collab.dispatch.completed',
          status: body.objectType === 'approval'
            ? 'awaiting_approval'
            : body.objectType === 'confirmation'
              ? 'awaiting_confirmation'
              : body.objectType === 'reminder'
                ? 'sent'
                : 'delivered',
          direction: 'outbound',
          summary: provider === 'feishu' && adapter?.enabled ? 'feishu adapter accepted message' : 'mock adapter accepted message',
          at: nowIso(),
        },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const liveFeishuReady = provider === 'feishu' && !!adapter?.enabled && !!adapter?.webhookUrl;
    const receipt = createPreviewCollabReceipt(record, liveFeishuReady ? 'feishu 已接收群协作消息' : 'mock adapter accepted message');
    previewCollabRecords = [receipt, record, ...previewCollabRecords].slice(0, 100);
    return response(config, {
      ok: true,
      contractVersion: 'collab.v1',
      record,
      receipt,
      fallbackUsed: !liveFeishuReady,
    });
  }

  if (method === 'post' && path === '/api/v1/collab/mock/inbound') {
    const recordId = String(body.recordId || body.correlationId || '');
    const target = previewCollabRecords.find((item) => item.recordId === recordId || item.correlationId === recordId);
    if (!target) {
      return response(config, { ok: false, message: 'record not found' }, 404);
    }
    const eventType = String(body.eventType || 'receipt.acknowledged');
    const nextStatus = eventType === 'approval.approved'
      ? 'approved'
      : eventType === 'approval.rejected'
        ? 'rejected'
        : eventType === 'confirmation.confirmed'
          ? 'confirmed'
          : target.status;
    const updated = {
      ...target,
      status: nextStatus,
      updatedAt: nowIso(),
      history: [
        {
          eventId: `evt_${Math.random().toString(36).slice(2, 10)}`,
          eventType,
          status: nextStatus,
          direction: 'inbound',
          summary: String(body.note || eventType),
          at: nowIso(),
        },
        ...(target.history || []),
      ],
    };
    previewCollabRecords = previewCollabRecords.map((item) => item.recordId === target.recordId ? updated : item);
    if (eventType === 'receipt.acknowledged' || eventType === 'receipt.delivered' || eventType === 'reminder.acknowledged') {
      previewCollabRecords = [createPreviewCollabReceipt(updated, String(body.note || eventType)), ...previewCollabRecords].slice(0, 100);
    }
    return response(config, {
      ok: true,
      contractVersion: 'collab.v1',
      record: updated,
    });
  }

  if (method === 'post' && path === '/api/v1/collab/trace-summary') {
    const traceId = String(body.traceId || '').trim();
    const records = previewCollabRecords.filter((item) => item.traceId === traceId);
    if (!traceId || records.length === 0) {
      return response(config, { ok: false, message: 'trace records not found' }, traceId ? 404 : 400);
    }
    return response(config, {
      ok: true,
      summary: buildPreviewTraceSummary(records),
    });
  }

  if (method === 'get' && path === '/api/v1/ai/notifications/status') {
    return response(config, {
      ok: true,
      notifications: {
        mode: 'file',
        file_outbox: 'tmp/notifications',
        smtp: { configured: false, host: '', from_email: '' },
        sms_mock_enabled: true,
        sms_webhook_configured: false,
      },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/notifications/outbox') {
    return response(config, {
      ok: true,
      count: 1,
      items: [
        {
          file: 'tmp/notifications/demo.json',
          kind: 'billing_trial',
          target: 'ops@example.com',
          requested_at: nowIso(),
          channel: 'file',
        },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/ai/notifications/test') {
    return response(config, {
      ok: true,
      result: { ok: true, mode: 'file', kind: 'test', target: String(body.target || ''), detail: {} },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/integrations/feishu/callback-readiness') {
    return response(config, {
      ok: true,
      ready: false,
      callback_url: '',
      checks: { public_base_url: false, signing_secret: false },
      next_step: '配置公网 callback',
    });
  }

  if (method === 'get' && path === '/api/v1/ai/billing/plans') {
    return response(config, {
      ok: true,
      plans: {
        starter: { token_limit: 120000, run_limit: 300, price_month_cny: 1999, price_year_cny: 19999 },
        pro: { token_limit: 600000, run_limit: 1200, price_month_cny: 6999, price_year_cny: 69999 },
        enterprise: { token_limit: 2000000, run_limit: 5000, price_month_cny: 19999, price_year_cny: 199999 },
      },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/billing/subscription') {
    return response(config, { ok: true, subscription: previewSubscription });
  }

  if (method === 'get' && path === '/api/v1/ai/billing/usage-summary') {
    return response(config, {
      ok: true,
      summary: {
        user_id: 'demo_admin',
        tenant_id: 'tenant_demo',
        total_runs: 132,
        total_tokens: 84210,
        total_cost_cny: 86.42,
        by_event_type: {
          strategy: { runs: 28, tokens: 24100, cost_cny: 20.3 },
          content: { runs: 64, tokens: 40110, cost_cny: 41.2 },
          lead_followup: { runs: 40, tokens: 20000, cost_cny: 24.92 },
        },
      },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/billing/providers-status') {
    return response(config, {
      ok: true,
      providers: {
        default_provider: 'mockpay',
        providers: {
          mockpay: { enabled: true, ready: true },
          alipay: { enabled: false, ready: false },
          wechatpay: { enabled: false, ready: false },
        },
      },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/billing/orders') {
    return response(config, { ok: true, count: previewOrders.length, orders: previewOrders });
  }

  if (method === 'get' && path === '/api/v1/ai/billing/compensation') {
    return response(config, { ok: true, count: 1, items: [{ task_id: 'comp_demo_001', order_id: 'order_demo_001', user_id: 'demo_admin', tenant_id: 'tenant_demo', reason_code: 'payment_timeout', status: 'queued', created_at: nowIso(), updated_at: nowIso() }] });
  }

  if (method === 'get' && path === '/api/v1/ai/billing/webhook/events') {
    return response(config, { ok: true, count: 2, items: [
      { provider: 'mockpay', event_id: 'evt_demo_001', action: 'checkout.created', order_id: 'order_demo_001', processed_ok: true, duplicate: false, created_at: nowIso() },
      { provider: 'mockpay', event_id: 'evt_demo_002', action: 'payment.pending', order_id: 'order_demo_001', processed_ok: true, duplicate: false, created_at: nowIso() },
    ] });
  }

  if (method === 'post' && path === '/api/v1/ai/billing/trial/activate') {
    previewSubscription = {
      ...previewSubscription,
      plan_code: String(body.plan_code || 'pro'),
      status: 'trialing',
      current_period_start: nowIso(),
      current_period_end: new Date(Date.now() + 1000 * 60 * 60 * 24 * Number(body.duration_days || 14)).toISOString(),
    };
    return response(config, { ok: true, subscription: previewSubscription });
  }

  if (method === 'post' && path === '/api/v1/ai/billing/checkout') {
    const nextOrder = {
      order_id: `order_demo_${String(previewOrders.length + 1).padStart(3, '0')}`,
      checkout_id: `checkout_demo_${String(previewOrders.length + 1).padStart(3, '0')}`,
      user_id: 'demo_admin',
      tenant_id: 'tenant_demo',
      plan_code: String(body.plan_code || 'pro'),
      cycle: String(body.cycle || 'month'),
      payment_provider: 'mockpay',
      amount_cny: body.plan_code === 'enterprise' ? 19999 : body.plan_code === 'starter' ? 1999 : 6999,
      currency: 'CNY',
      status: 'pending',
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    previewOrders = [nextOrder, ...previewOrders];
    return response(config, {
      ok: true,
      checkout: {
        checkout_id: nextOrder.checkout_id,
        order_id: nextOrder.order_id,
        checkout_url: '/settings/billing?checkout=mock',
        status: 'pending',
      },
      order: nextOrder,
    });
  }

  if (method === 'get' && path === '/api/v1/ai/skills-pool/overview') {
    return response(config, previewAiSkillsOverview);
  }

  if (method === 'get' && path === '/api/v1/ai/skills') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      skills: [
        {
          id: 'strategist_skill_1',
          name: '行业策略分析',
          category: 'strategy',
          enabled: true,
          bound_lobsters: ['strategist'],
          publish_status: 'approved',
          priority: 'high',
          scan_status: 'safe',
          scan_report: { risk_level: 'low', issues: [], confidence: 0.92 },
          applies_when: { task_types: ['strategy_planning'], channels: ['xiaohongshu'] },
          effective_conditions: { industry_tag: 'beauty.sensitive-skin' },
        },
        {
          id: 'inkwriter_skill_1',
          name: '高意向评论承接',
          category: 'engagement',
          enabled: true,
          bound_lobsters: ['inkwriter'],
          publish_status: 'review',
          priority: 'medium',
          scan_status: 'warn',
          scan_report: {
            risk_level: 'medium',
            issues: ['需确认话术是否包含未经授权的承诺型表达。'],
            confidence: 0.84,
          },
          applies_when: { task_types: ['engagement_copy'], channels: ['xiaohongshu'] },
          effective_conditions: { lead_intent: 'high' },
        },
      ],
    });
  }

  if (method === 'get' && path === '/api/v1/ai/skills/improvement-proposals') {
    const params = (config.params || {}) as Record<string, unknown>;
    const tenantId = String(params.tenant_id || 'tenant_demo');
    const status = String(params.status || '').trim();
    const limitValue = Number(params.limit ?? 100);
    const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 100;
    const items = previewSkillImprovementProposals
      .filter((item) => !status || item.status === status)
      .slice(0, limit)
      .map((item) => ({ ...item, tenant_id: tenantId }));
    return response(config, { ok: true, tenant_id: tenantId, count: items.length, items });
  }

  if (method === 'get' && path === '/api/v1/ai/skills/improvement-overview') {
    const tenantId = String(config.params?.tenant_id || 'tenant_demo');
    return response(config, {
      ok: true,
      tenant_id: tenantId,
      summary: {
        proposal_total: previewSkillImprovementProposals.length,
        signal_total: 3,
        effect_event_total: 3,
        pending_review: previewSkillImprovementProposals.filter((item) => item.status === 'scanned' || item.status === 'review').length,
        ready_to_apply: previewSkillImprovementProposals.filter((item) => item.status === 'approved').length,
        applied: previewSkillImprovementProposals.filter((item) => item.status === 'applied').length,
        rolled_back: previewSkillImprovementProposals.filter((item) => item.status === 'rolled_back').length,
        recommend_rollback: 0,
        readiness_status: 'learning_loop_active',
      },
      proposal_status_counts: previewSkillImprovementProposals.reduce<Record<string, number>>((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {}),
      scan_status_counts: previewSkillImprovementProposals.reduce<Record<string, number>>((acc, item) => {
        acc[item.scan_status || 'not_scanned'] = (acc[item.scan_status || 'not_scanned'] || 0) + 1;
        return acc;
      }, {}),
      signal_reason_counts: { created: 2, duplicate_signal: 1 },
      recommendation_counts: { keep_applied: 1 },
      global_effect_summary: {
        tenant_id: tenantId,
        proposal_id: '',
        event_count: 3,
        observation_count: 2,
        avg_delta: 0.22,
        positive_observations: 2,
        negative_observations: 0,
        latest_event: null,
        recommendation: {
          action: 'keep_applied',
          priority: 'normal',
          reason: 'Post-apply observations are positive with avg_delta=0.2200.',
          can_auto_rollback: false,
          observation_floor: 2,
        },
      },
      proposal_effect_summaries: [],
      recent_proposals: previewSkillImprovementProposals.slice(0, 3),
      recent_signals: [],
      recent_effects: [],
      dual_track_memory: {
        tenant_id: tenantId,
        resident_count: 3,
        history_count: 18,
        resident_max_chars: 3575,
        tracks: {
          resident: 'small_stable_always_loaded',
          history: 'large_searchable_on_demand',
        },
      },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/skills/improvement-signals') {
    const tenantId = String(config.params?.tenant_id || 'tenant_demo');
    return response(config, {
      ok: true,
      tenant_id: tenantId,
      count: 3,
      items: [
        {
          event_id: 'sise_demo_runtime_001',
          tenant_id: tenantId,
          lobster_id: 'inkwriter',
          skill_id: 'inkwriter_copy_generate',
          signal_type: 'runtime_failure',
          source_id: 'task_demo_copy_001',
          summary: 'Runtime failure from inkwriter produced a scanned improvement proposal.',
          confidence: 0.78,
          created: true,
          reason: 'created',
          proposal_id: 'sip_demo_inkwriter_001',
          created_at: nowIso(),
        },
        {
          event_id: 'sise_demo_feedback_001',
          tenant_id: tenantId,
          lobster_id: 'inkwriter',
          skill_id: 'inkwriter_copy_generate',
          signal_type: 'repeated_human_revision',
          source_id: 'fb_demo_001',
          summary: 'Human revised the opening hook; signal deduped against an existing proposal.',
          confidence: 0.92,
          created: false,
          reason: 'duplicate_signal',
          proposal_id: 'sip_demo_inkwriter_001',
          created_at: nowIso(),
        },
        {
          event_id: 'sise_demo_edge_001',
          tenant_id: tenantId,
          lobster_id: 'dispatcher',
          skill_id: 'dispatcher_scheduled_publish',
          signal_type: 'edge_publish_retry_spike',
          source_id: 'edge_event_001',
          summary: 'Edge publish failed after three retries and routed into the learning loop.',
          confidence: 0.84,
          created: true,
          reason: 'created',
          proposal_id: 'sip_demo_dispatcher_001',
          created_at: nowIso(),
        },
      ],
    });
  }

  if (method === 'get' && path === '/api/v1/ai/skills/improvement-effects') {
    const tenantId = String(config.params?.tenant_id || 'tenant_demo');
    const proposalId = String(config.params?.proposal_id || 'sip_demo_inkwriter_001');
    const items = [
      {
        event_id: 'siee_demo_apply_001',
        proposal_id: proposalId,
        tenant_id: tenantId,
        lobster_id: 'inkwriter',
        skill_id: 'inkwriter_copy_generate',
        event_type: 'applied',
        source_type: 'skill_manifest',
        source_id: 'inkwriter',
        metric_name: '',
        metric_value: null,
        baseline_value: null,
        delta: null,
        summary: 'Applied approved proposal to the inkwriter manifest.',
        metadata: { applied_by: 'preview_admin' },
        created_at: nowIso(),
      },
      {
        event_id: 'siee_demo_runtime_001',
        proposal_id: proposalId,
        tenant_id: tenantId,
        lobster_id: 'inkwriter',
        skill_id: 'inkwriter_copy_generate',
        event_type: 'effect_observation',
        source_type: 'runtime',
        source_id: 'run_preview_001',
        metric_name: 'quality_score',
        metric_value: 0.82,
        baseline_value: 0.68,
        delta: 0.14,
        summary: 'Runtime quality improved after the applied proposal.',
        metadata: { stop_reason: 'completed' },
        created_at: nowIso(),
      },
      {
        event_id: 'siee_demo_feedback_001',
        proposal_id: proposalId,
        tenant_id: tenantId,
        lobster_id: 'inkwriter',
        skill_id: 'inkwriter_copy_generate',
        event_type: 'effect_observation',
        source_type: 'human_feedback',
        source_id: 'fb_preview_001',
        metric_name: 'human_feedback_score',
        metric_value: 0.9,
        baseline_value: 0.6,
        delta: 0.3,
        summary: 'Operator accepted the revised opening hook.',
        metadata: { rating: 'thumbs_up' },
        created_at: nowIso(),
      },
    ];
    return response(config, {
      ok: true,
      tenant_id: tenantId,
      proposal_id: proposalId,
      count: items.length,
      items,
      summary: {
        tenant_id: tenantId,
        proposal_id: proposalId,
        event_count: items.length,
        observation_count: 2,
        avg_delta: 0.22,
        positive_observations: 2,
        negative_observations: 0,
        latest_event: items[0],
        recommendation: {
          action: 'keep_applied',
          priority: 'normal',
          reason: 'Post-apply observations are positive with avg_delta=0.2200.',
          can_auto_rollback: false,
          observation_floor: 2,
        },
      },
    });
  }

  if (method === 'post' && path === '/api/v1/ai/skills/improvement-proposals') {
    const tenantId = String(body.tenant_id || 'tenant_demo');
    const lobsterId = String(body.lobster_id || 'inkwriter');
    const skillId = String(body.skill_id || `${lobsterId}_skill_1`);
    const triggerType = String(body.trigger_type || 'manual_operator_evidence');
    const evidenceRefs = Array.isArray(body.evidence_refs) && body.evidence_refs.length
      ? body.evidence_refs
      : [{
        source_type: 'manual',
        source_id: `manual_${Date.now()}`,
        summary: 'Preview operator supplied a manual improvement signal.',
        confidence: 0.7,
      }];
    const proposal: SkillImprovementProposal = {
      proposal_id: `sip_preview_${Date.now()}`,
      tenant_id: tenantId,
      lobster_id: lobsterId,
      skill_id: skillId,
      trigger_type: triggerType,
      status: 'draft',
      evidence_refs: evidenceRefs.map((item: Record<string, unknown>) => ({
        source_type: String(item.source_type || 'manual'),
        source_id: String(item.source_id || 'manual'),
        summary: String(item.summary || 'Preview improvement evidence.'),
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.7,
      })),
      patches: [
        {
          target_file: `packages/lobsters/lobster-${lobsterId}/skill.manifest.yaml`,
          patch_type: 'manifest_metadata',
          before: { publish_status: 'approved' },
          after: {
            publish_status: 'review',
            scan_status: 'not_scanned',
            effective_conditions: { last_improvement_trigger: triggerType },
            stability: 'proposal_pending_review',
          },
          summary: 'Preview patch draft generated from evidence; live Skill assets are not changed.',
        },
      ],
      scan_status: 'not_scanned',
      scan_report: { risk_level: 'unknown', issues: [], confidence: 0 },
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    previewSkillImprovementProposals = [proposal, ...previewSkillImprovementProposals];
    return response(config, { ok: true, proposal });
  }

  if (method === 'post' && path === '/api/v1/ai/skills/improvement-proposals/trigger') {
    const confidence = Number(body.confidence ?? 0);
    if (confidence < 0.65) {
      return response(config, {
        ok: true,
        created: false,
        reason: 'confidence_below_threshold',
        threshold: 0.65,
        proposal: null,
      });
    }
    const tenantId = String(body.tenant_id || 'tenant_demo');
    const lobsterId = String(body.lobster_id || 'inkwriter');
    const skillId = String(body.skill_id || `${lobsterId}_skill_1`);
    const sourceId = String(body.source_id || `signal_${Date.now()}`);
    const proposal: SkillImprovementProposal = {
      proposal_id: `sip_trigger_${Date.now()}`,
      tenant_id: tenantId,
      lobster_id: lobsterId,
      skill_id: skillId,
      trigger_type: String(body.signal_type || 'manual_signal'),
      status: 'scanned',
      evidence_refs: [{
        source_type: String(body.signal_type || 'manual_signal'),
        source_id: sourceId,
        summary: String(body.summary || 'Preview trigger crossed improvement threshold.'),
        confidence,
      }],
      patches: [{
        target_file: `packages/lobsters/lobster-${lobsterId}/skill.manifest.yaml`,
        patch_type: 'manifest_metadata',
        before: { publish_status: 'approved' },
        after: {
          publish_status: 'review',
          scan_status: 'not_scanned',
          effective_conditions: { last_improvement_trigger: String(body.signal_type || 'manual_signal') },
          stability: 'proposal_pending_review',
        },
        summary: 'Preview trigger generated a scanned Skill improvement proposal without applying the live patch.',
      }],
      scan_status: 'safe',
      scan_report: { risk_level: 'low', issues: [], confidence: 0.91 },
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    previewSkillImprovementProposals = [proposal, ...previewSkillImprovementProposals];
    return response(config, {
      ok: true,
      created: true,
      reason: 'created',
      threshold: 0.65,
      proposal,
    });
  }

  if (method === 'post' && /\/api\/v1\/ai\/skills\/improvement-proposals\/[^/]+\/scan$/.test(path)) {
    const proposalId = decodeURIComponent(path.split('/')[6] || '');
    const idx = previewSkillImprovementProposals.findIndex((item) => item.proposal_id === proposalId);
    if (idx < 0) return response(config, { ok: false, message: 'proposal not found' }, 404);
    const next: SkillImprovementProposal = {
      ...previewSkillImprovementProposals[idx],
      status: 'scanned',
      scan_status: 'safe',
      scan_report: { risk_level: 'low', issues: [], confidence: 0.92 },
      updated_at: nowIso(),
    };
    previewSkillImprovementProposals[idx] = next;
    return response(config, { ok: true, proposal: next });
  }

  if (method === 'post' && /\/api\/v1\/ai\/skills\/improvement-proposals\/[^/]+\/decide$/.test(path)) {
    const proposalId = decodeURIComponent(path.split('/')[6] || '');
    const idx = previewSkillImprovementProposals.findIndex((item) => item.proposal_id === proposalId);
    if (idx < 0) return response(config, { ok: false, message: 'proposal not found' }, 404);
    const decision = String(body.decision || 'review');
    const next: SkillImprovementProposal = {
      ...previewSkillImprovementProposals[idx],
      status: decision === 'approved' || decision === 'rejected' ? decision : 'review',
      decided_by: 'preview_admin',
      decision_reason: String(body.reason || ''),
      updated_at: nowIso(),
    };
    previewSkillImprovementProposals[idx] = next;
    return response(config, { ok: true, proposal: next });
  }

  if (method === 'post' && /\/api\/v1\/ai\/skills\/improvement-proposals\/[^/]+\/apply$/.test(path)) {
    const proposalId = decodeURIComponent(path.split('/')[6] || '');
    const idx = previewSkillImprovementProposals.findIndex((item) => item.proposal_id === proposalId);
    if (idx < 0) return response(config, { ok: false, message: 'proposal not found' }, 404);
    if (previewSkillImprovementProposals[idx].status !== 'approved') {
      return response(config, { ok: false, message: 'proposal_must_be_approved_before_apply' }, 400);
    }
    const next: SkillImprovementProposal = {
      ...previewSkillImprovementProposals[idx],
      status: 'applied',
      updated_at: nowIso(),
      decision_reason: String(body.reason || previewSkillImprovementProposals[idx].decision_reason || 'preview apply'),
    };
    previewSkillImprovementProposals[idx] = next;
    return response(config, {
      ok: true,
      proposal: next,
      manifest: next.patches[0]?.after || {},
    });
  }

  if (method === 'post' && /\/api\/v1\/ai\/skills\/improvement-proposals\/[^/]+\/rollback$/.test(path)) {
    const proposalId = decodeURIComponent(path.split('/')[6] || '');
    const idx = previewSkillImprovementProposals.findIndex((item) => item.proposal_id === proposalId);
    if (idx < 0) return response(config, { ok: false, message: 'proposal not found' }, 404);
    if (previewSkillImprovementProposals[idx].status !== 'applied') {
      return response(config, { ok: false, message: 'proposal_must_be_applied_before_rollback' }, 400);
    }
    const next: SkillImprovementProposal = {
      ...previewSkillImprovementProposals[idx],
      status: 'rolled_back',
      updated_at: nowIso(),
      decision_reason: String(body.reason || previewSkillImprovementProposals[idx].decision_reason || 'preview rollback'),
    };
    previewSkillImprovementProposals[idx] = next;
    return response(config, {
      ok: true,
      proposal: next,
      manifest: next.patches[0]?.before || {},
    });
  }

  if (method === 'get' && path === '/api/v1/ai/llm/providers') {
    return response(config, { ok: true, tenant_id: 'tenant_demo', providers: previewAiSkillsOverview.overview.llm_providers });
  }

  if (method === 'get' && path === '/api/v1/ai/llm/model/catalog') {
    return response(config, {
      ok: true,
      catalog: {
        agents: ['commander', 'radar', 'strategist', 'inkwriter', 'visualizer', 'dispatcher', 'echoer', 'catcher', 'abacus', 'followup'],
        hot_models: ['deepseek-chat', 'qwen-max', 'gpt-4o-mini', 'qwen-plus', 'glm-4.7-flash'],
        task_type_agent_map: {
          strategy_planning: 'commander',
          radar_enrichment: 'radar',
          content_generation: 'inkwriter',
          visual_prompting: 'visualizer',
          dispatch_routing: 'dispatcher',
          sales_followup: 'followup',
        },
        providers: [
          {
            provider_id: 'deepseek',
            label: 'DeepSeek',
            route: 'cloud',
            base_url: 'https://api.deepseek.com/v1',
            default_model: 'deepseek-chat',
            model_options: ['deepseek-chat', 'deepseek-reasoner'],
          },
          {
            provider_id: 'openai',
            label: 'OpenAI',
            route: 'cloud',
            base_url: 'https://api.openai.com/v1',
            default_model: 'gpt-4o-mini',
            model_options: ['gpt-4o-mini', 'gpt-4.1-mini'],
          },
        ],
      },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/llm/agent-bindings') {
    return response(config, { ok: true, tenant_id: 'tenant_demo', bindings: previewAiSkillsOverview.overview.llm_bindings });
  }

  if (method === 'put' && path.startsWith('/api/v1/ai/llm/agent-bindings/')) {
    const agentId = decodeURIComponent(path.split('/').pop() || '');
    const idx = previewAiSkillsOverview.overview.llm_bindings.findIndex((item) => item.agent_id === agentId);
    const next = {
      agent_id: agentId,
      enabled: Boolean(body.enabled ?? true),
      task_type: String(body.task_type || 'strategy_planning'),
      provider_id: String(body.provider_id || 'deepseek'),
      model_name: String(body.model_name || 'deepseek-chat'),
      temperature: Number(body.temperature ?? 0.3),
      max_tokens: Number(body.max_tokens ?? 3000),
      note: String(body.note || ''),
    };
    if (idx >= 0) previewAiSkillsOverview.overview.llm_bindings[idx] = next;
    return response(config, { ok: true, tenant_id: 'tenant_demo', binding: next });
  }

  if (method === 'get' && path === '/api/v1/ai/agent-rag/catalog') {
    return response(config, previewRagCatalog);
  }

  if (method === 'get' && path === '/api/v1/ai/agent-rag/packs') {
    return response(config, previewRagPacks);
  }

  if (method === 'get' && path === '/api/v1/ai/industry-kb/starter-kit/tasks') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      industry_tag: 'food_chinese_restaurant',
      count: 2,
      items: [
        {
          task_key: 'starter_food_001',
          status: 'accepted',
          task: {
            title: '同城短视频获客链路',
            channel: 'douyin',
            touchpoint: 'short_video',
            governance_mode: 'hitl_default',
            objective: '先跑通首批同城获客链路，再进入跟进与复盘。',
          },
          verifier: { feasibility_score: 0.82, observability_score: 0.78, governance_fit_score: 0.91 },
          created_at: nowIso(),
          updated_at: nowIso(),
        },
        {
          task_key: 'starter_food_002',
          status: 'accepted',
          task: {
            title: '高意向线索跟进',
            channel: 'wechat',
            touchpoint: 'lead_followup',
            governance_mode: 'hitl_default',
            objective: '把高意向线索跟进做成标准化动作。',
          },
          verifier: { feasibility_score: 0.85, observability_score: 0.8, governance_fit_score: 0.94 },
          created_at: nowIso(),
          updated_at: nowIso(),
        },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/ai/industry-kb/starter-kit/generate') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      industry_tag: String(body.industry_tag || 'food_chinese_restaurant'),
      generated_at: nowIso(),
      explorer_summary: {},
      accepted_count: 2,
      rejected_count: 0,
      accepted_tasks: [],
      rejected_tasks: [],
    });
  }

  // ── Autopilot status / probe / reset ──────────────────────────────────────

  if (method === 'get' && path === '/autopilot/status') {
    return response(config, {
      ok: true,
      status: 'running',
      circuitOpen: false,
      active_tasks: 2,
      queues: [
        { queue: 'matrix_dispatch_queue', depth: 1, consumers: 2 },
        { queue: 'lead_harvest_queue', depth: 0, consumers: 1 },
      ],
      last_heartbeat_at: nowIso(),
    });
  }

  if (method === 'post' && path === '/autopilot/trigger-probe') {
    return response(config, { ok: true, jobId: `probe_${Date.now()}`, probe_id: 'probe_demo_001', triggered_at: nowIso() });
  }

  if (method === 'post' && path === '/autopilot/reset-circuit') {
    return response(config, { ok: true, circuit: 'closed', reset_at: nowIso() });
  }

  // ── AI Kernel rollout policy & templates ──────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/kernel/rollout/policy') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      policy: {
        strategy_version: 'default',
        risk_gate: { P0: 'block', P1: 'review_required', P2: 'auto_pass', P3: 'auto_pass' },
        autonomy_level: 'semi_auto',
        max_parallel_tasks: 4,
        rollback_enabled: true,
        approval_timeout_sec: 300,
      },
    });
  }

  if (method === 'put' && path === '/api/v1/ai/kernel/rollout/policy') {
    return response(config, { ok: true, tenant_id: 'tenant_demo', policy: body });
  }

  if (method === 'get' && path === '/api/v1/ai/kernel/rollout/templates') {
    return response(config, {
      ok: true,
      count: 2,
      items: [
        { key: 'tpl_conservative', name: '保守模式', description: '所有 P1+ 需人工审批', created_at: nowIso() },
        { key: 'tpl_aggressive', name: '激进模式', description: '仅 P0 需人工审批', created_at: nowIso() },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/ai/kernel/rollout/templates') {
    return response(config, { ok: true, key: `tpl_${Date.now()}`, name: String(body.name || '新模板'), created_at: nowIso() });
  }

  if (method === 'patch' && path.startsWith('/api/v1/ai/kernel/rollout/templates/')) {
    return response(config, { ok: true, key: path.split('/').pop(), name: String(body.name || '') });
  }

  if (method === 'delete' && path.startsWith('/api/v1/ai/kernel/rollout/templates/')) {
    return response(config, { ok: true });
  }

  if (method === 'get' && path === '/api/v1/ai/kernel/rollout/templates/export') {
    return response(config, { ok: true, templates: [] });
  }

  if (method === 'post' && path === '/api/v1/ai/kernel/rollout/templates/import') {
    return response(config, { ok: true, imported: 0 });
  }

  if (method === 'get' && path === '/api/v1/ai/kernel/reports') {
    return response(config, {
      ok: true,
      count: 1,
      items: [{ trace_id: 'trace_demo_001', risk_level: 'P2', created_at: nowIso() }],
    });
  }

  // ── Seat billing ──────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/billing/seats/plans') {
    return response(config, {
      ok: true,
      tiers: [
        { min_seats: 1, max_seats: 5, unit_price: 299, floor_price: 999, pricing: {} },
        { min_seats: 6, max_seats: 20, unit_price: 249, floor_price: 2499, pricing: {} },
        { min_seats: 21, max_seats: 999, unit_price: 199, floor_price: 4999, pricing: {} },
      ],
    });
  }

  if (method === 'get' && path === '/api/v1/ai/billing/seats/subscription') {
    return response(config, { ok: true, subscription: null });
  }

  if (method === 'post' && path === '/api/v1/ai/billing/seats/subscription') {
    return response(config, {
      ok: true,
      subscription: {
        id: `seat_sub_demo_${Date.now()}`,
        tenant_id: 'tenant_demo',
        seat_count: Number(body.seat_count || 1),
        unit_price: 299,
        floor_price: 999,
        billing_cycle: String(body.billing_cycle || 'monthly'),
        status: 'trialing',
        monthly_amount: 999,
        annual_amount: 9999,
        trial_ends_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
      },
    });
  }

  if (method === 'post' && /\/api\/v1\/ai\/billing\/seats\/subscription\/[^/]+\/checkout$/.test(path)) {
    return response(config, {
      ok: true,
      subscription: { id: path.split('/')[7], status: 'active' },
      checkout: { checkout_id: `seat_checkout_demo`, checkout_url: '/settings/billing?checkout=mock', order_id: `seat_order_demo`, status: 'pending' },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/billing/seats/quotas') {
    return response(config, {
      ok: true,
      summary: {
        tenant_id: 'tenant_demo',
        seat_count: 1,
        overall_health: 'healthy',
        quotas: { api_calls: { limit: 10000, used: 1200, usage_pct: 0.12 } },
        seats: [],
      },
    });
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/sessions') {
    return response(config, {
      ok: true,
      count: 2,
      items: [
        { session_id: 'sess_demo_001', tenant_id: 'tenant_demo', created_at: nowIso(), message_count: 8, last_message_at: nowIso() },
        { session_id: 'sess_demo_002', tenant_id: 'tenant_demo', created_at: nowIso(), message_count: 3, last_message_at: nowIso() },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/sessions\/[^/]+\/history$/.test(path)) {
    return response(config, {
      ok: true,
      session_id: path.split('/')[5],
      messages: [
        { role: 'user', content: '帮我规划一个同城获客方案', ts: nowIso() },
        { role: 'assistant', content: '好的，我来帮你规划。首先需要确认目标行业和区域范围…', ts: nowIso() },
      ],
    });
  }

  if (method === 'delete' && /\/api\/v1\/ai\/sessions\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  // ── Channels ──────────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/channels/status') {
    return response(config, {
      douyin: {
        total: 2,
        enabled: 2,
        accounts: [
          { id: 'dy_acc_001', name: '抖音演示账号 A', enabled: true, tenant: 'tenant_demo', options: { dm_scope: 'shared' } },
          { id: 'dy_acc_002', name: '抖音演示账号 B', enabled: true, tenant: 'tenant_demo', options: { dm_scope: 'per-peer' } },
        ],
      },
      wechat: {
        total: 1,
        enabled: 1,
        accounts: [
          { id: 'wx_acc_001', name: '微信演示账号', enabled: true, tenant: 'tenant_demo', options: { dm_scope: 'shared' } },
        ],
      },
      telegram: {
        total: 1,
        enabled: 1,
        accounts: [
          { id: 'tg_acc_001', name: 'Telegram Demo', enabled: true, tenant: 'tenant_demo', options: { dm_scope: 'isolated' } },
        ],
      },
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/channels\/[^/]+\/accounts$/.test(path)) {
    const channel = path.split('/')[5];
    return response(config, {
      ok: true,
      channel,
      accounts: [
        { account_id: `${channel}_acc_001`, username: `demo_${channel}`, dm_scope: 'all', enabled: true },
      ],
    });
  }

  if (method === 'put' && /\/api\/v1\/ai\/channels\/[^/]+\/accounts\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'get' && path === '/api/v1/ai/edge/adapters') {
    return response(config, {
      ok: true,
      count: 2,
      items: [
        {
          platform: 'xiaohongshu',
          version: '1.0.0',
          display_name: '小红书',
          owner: 'openclaw-edge',
          status: 'active',
          actions: ['login_check', 'publish_video', 'publish_image_post'],
          required_primitives: ['open_url', 'type_text', 'click_element'],
          risk_level: 'high',
          requires_local_session: true,
          supports_replay: true,
          supports_canary: true,
          known_limitations: ['selector drift may happen on creator pages'],
        },
        {
          platform: 'douyin',
          version: '1.0.0',
          display_name: '抖音',
          owner: 'openclaw-edge',
          status: 'active',
          actions: ['login_check', 'publish_video', 'publish_image_post'],
          required_primitives: ['open_url', 'type_text', 'click_element'],
          risk_level: 'high',
          requires_local_session: true,
          supports_replay: true,
          supports_canary: true,
          known_limitations: ['publish selectors may vary by creator account tier'],
        },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/edge\/adapters\/[^/]+$/.test(path)) {
    const platform = decodeURIComponent(path.split('/').pop() || 'xiaohongshu');
    const item =
      platform === 'douyin'
        ? {
            platform: 'douyin',
            version: '1.0.0',
            display_name: '抖音',
            owner: 'openclaw-edge',
            status: 'active',
            actions: ['login_check', 'publish_video', 'publish_image_post'],
            required_primitives: ['open_url', 'type_text', 'click_element'],
            risk_level: 'high',
            requires_local_session: true,
            supports_replay: true,
            supports_canary: true,
            known_limitations: ['publish selectors may vary by creator account tier', 'image-post flow is provisional'],
          }
        : {
            platform: 'xiaohongshu',
            version: '1.0.0',
            display_name: '小红书',
            owner: 'openclaw-edge',
            status: 'active',
            actions: ['login_check', 'publish_video', 'publish_image_post'],
            required_primitives: ['open_url', 'type_text', 'click_element'],
            risk_level: 'high',
            requires_local_session: true,
            supports_replay: true,
            supports_canary: true,
            known_limitations: ['selector drift may happen on creator pages', 'upload still uses direct file input'],
          };
    return response(config, {
      ok: true,
      platform,
      adapter: item,
    });
  }

  // ── MCP Servers ───────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/mcp/servers') {
    return response(config, {
      ok: true,
      servers: [
        {
          id: 'mcp_demo_001',
          name: '本地工具服务器',
          transport: 'sse',
          url: 'http://127.0.0.1:9000/mcp',
          env: {},
          enabled: true,
          status: 'healthy',
          created_at: nowIso(),
          last_ping: nowIso(),
          allowed_lobsters: ['strategist', 'radar'],
        },
        {
          id: 'mcp_demo_002',
          name: '远端数据分析',
          transport: 'edge',
          edge_node_id: 'node_demo_01',
          env: {},
          enabled: false,
          status: 'unknown',
          created_at: nowIso(),
          last_ping: nowIso(),
          allowed_lobsters: ['abacus'],
        },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/ai/mcp/servers') {
    return response(config, {
      ok: true,
      server: {
        id: String(body.id || `mcp_${Date.now()}`),
        name: String(body.name || '新 MCP Server'),
        transport: String(body.transport || 'stdio'),
        command: body.command ? String(body.command) : undefined,
        url: body.url ? String(body.url) : undefined,
        env: typeof body.env === 'object' && body.env ? body.env : {},
        enabled: body.enabled !== false,
        status: 'unknown',
        created_at: nowIso(),
        last_ping: null,
        allowed_lobsters: Array.isArray(body.allowed_lobsters) ? body.allowed_lobsters.map((item) => String(item)) : [],
        edge_node_id: body.edge_node_id ? String(body.edge_node_id) : undefined,
      },
    });
  }

  if (method === 'put' && /\/api\/v1\/ai\/mcp\/servers\/[^/]+$/.test(path)) {
    return response(config, {
      ok: true,
      server: {
        id: decodeURIComponent(path.split('/').pop() || ''),
        name: String(body.name || '已更新 MCP Server'),
        transport: String(body.transport || 'stdio'),
        command: body.command ? String(body.command) : undefined,
        url: body.url ? String(body.url) : undefined,
        env: typeof body.env === 'object' && body.env ? body.env : {},
        enabled: body.enabled !== false,
        status: 'healthy',
        created_at: nowIso(),
        last_ping: nowIso(),
        allowed_lobsters: Array.isArray(body.allowed_lobsters) ? body.allowed_lobsters.map((item) => String(item)) : [],
        edge_node_id: body.edge_node_id ? String(body.edge_node_id) : undefined,
      },
    });
  }

  if (method === 'delete' && /\/api\/v1\/ai\/mcp\/servers\/[^/]+$/.test(path)) {
    return response(config, { ok: true, deleted: true });
  }

  if (method === 'get' && /\/api\/v1\/ai\/mcp\/servers\/[^/]+\/tools$/.test(path)) {
    return response(config, {
      ok: true,
      tools: [
        { server_id: decodeURIComponent(path.split('/')[6] || 'mcp_demo_001'), tool_name: 'search_web', description: '搜索网络信息', input_schema: {} },
        { server_id: decodeURIComponent(path.split('/')[6] || 'mcp_demo_001'), tool_name: 'read_file', description: '读取本地文件', input_schema: {} },
      ],
    });
  }

  if (method === 'post' && /\/api\/v1\/ai\/mcp\/servers\/[^/]+\/ping$/.test(path)) {
    return response(config, { ok: true, server_id: decodeURIComponent(path.split('/')[6] || ''), healthy: true });
  }

  if (method === 'post' && path === '/api/v1/ai/mcp/call') {
    return response(config, { ok: true, result: { output: '演示工具调用结果' } });
  }

  if (method === 'get' && path === '/api/v1/ai/mcp/call/history') {
    return response(config, {
      ok: true,
      items: [
        { id: 'call_001', lobster_id: 'strategist', server_id: 'mcp_demo_001', tool_name: 'search_web', args_summary: 'q=同城获客', result_summary: '3 hits', duration_ms: 320, status: 'success', created_at: nowIso() },
        { id: 'call_002', lobster_id: 'abacus', server_id: 'mcp_demo_001', tool_name: 'read_file', args_summary: 'path=/tmp/demo.txt', result_summary: 'timeout', duration_ms: 50, status: 'error', created_at: nowIso() },
      ],
    });
  }

  if (method === 'get' && path === '/api/v1/ai/mcp/monitor/top') {
    return response(config, { ok: true, items: [{ tool: 'search_web', count: 128 }] });
  }

  if (method === 'get' && path === '/api/v1/ai/mcp/monitor/heatmap') {
    return response(config, { ok: true, items: [{ lobster: 'strategist', tool: 'search_web', count: 32 }] });
  }

  if (method === 'get' && path === '/api/v1/ai/mcp/monitor/failures') {
    return response(config, { ok: true, items: [{ lobster: 'abacus', tool: 'read_file', total: 12, failed: 3, denied: 1, failure_rate_pct: 25, avg_latency_ms: 180 }] });
  }

  if (method === 'get' && path === '/api/v1/ai/mcp/monitor/recent') {
    return response(config, { ok: true, calls: [] });
  }

  if (method === 'get' && path === '/api/v1/ai/mcp/policies') {
    return response(config, { ok: true, items: [{ lobster_name: 'strategist', allowed_tools: ['search_web'], denied_tools: ['delete_file'], limits: {}, allow_unknown_tools: false }] });
  }

  if (method === 'put' && path.startsWith('/api/v1/ai/mcp/policies/')) {
    return response(config, { ok: true });
  }

  if (method === 'get' && path === '/api/v1/ai/mcp/marketplace') {
    return response(config, {
      ok: true,
      items: [
        { tool_id: 'market_001', name: '抖音数据分析', description: '分析同城短视频指标', category: 'analytics', icon: '📈', mcp_endpoint: 'mcp://analytics', version: '1.0.0', author: 'openclaw', is_builtin: false, is_active: true, monthly_cost_usd: 19.9, created_at: Date.now(), tags: ['analytics'], subscribed: false },
        { tool_id: 'market_002', name: '竞品监控', description: '竞品内容抓取与告警', category: 'intelligence', icon: '🛰️', mcp_endpoint: 'mcp://intel', version: '1.2.0', author: 'openclaw', is_builtin: true, is_active: true, monthly_cost_usd: 0, created_at: Date.now(), tags: ['intel'], subscribed: true },
        { tool_id: 'market_003', name: '内容合规检查', description: '内容风险与术语审查', category: 'compliance', icon: '🛡️', mcp_endpoint: 'mcp://compliance', version: '0.9.0', author: 'openclaw', is_builtin: false, is_active: true, monthly_cost_usd: 9.9, created_at: Date.now(), tags: ['risk'], subscribed: false },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/ai/mcp/marketplace') {
    return response(config, { ok: true });
  }

  if (method === 'get' && path === '/api/v1/ai/mcp/marketplace/subscriptions') {
    return response(config, { ok: true, items: [{ tenant_id: 'tenant_demo', tool_id: 'market_002', subscribed_at: Date.now(), is_active: true, name: '竞品监控', description: '竞品内容抓取与告警', category: 'intelligence', icon: '🛰️', version: '1.2.0', monthly_cost_usd: 0, tags: ['intel'] }] });
  }

  if (method === 'post' && path === '/api/v1/ai/mcp/marketplace/subscribe') {
    return response(config, { ok: true });
  }

  if (method === 'post' && path === '/api/v1/ai/mcp/marketplace/unsubscribe') {
    return response(config, { ok: true });
  }

  // ── Memory ────────────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/memory/stats') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      stats: {
        layers: {
          l0: { count: 148, bytes: 4_194_304 },
          l1: { count: 24, bytes: 983_040 },
          l2: { count: 8, bytes: 262_144 },
        },
        compression: {
          avg_l0_to_l1_ratio: 0.72,
          avg_reports_per_wisdom: 3,
        },
        categories: {
          content: 6,
          customer: 5,
          channel: 4,
          cost: 2,
        },
      },
    });
  }

  if (method === 'get' && path === '/api/v1/tenant-memory/stats') {
    return response(config, {
      ok: true,
      tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
      total_entries: 6,
      by_scope: {
        tenant: 3,
        shared: 1,
        role_local: 2,
      },
      scope_details: {
        tenant: { count: 3, shared: true, durable: true },
        shared: { count: 1, shared: true, durable: true },
        role_local: { count: 2, shared: false, durable: true },
      },
      by_category: {
        brand: 2,
        compliance: 1,
        content: 2,
        engagement: 1,
      },
      by_lobster: {
        strategist: 2,
        dispatcher: 1,
        echoer: 1,
        inkwriter: 2,
      },
      last_updated_at: Date.now() / 1000,
      scopes_available: ['session', 'tenant', 'shared', 'role_local', 'mission_local'],
    });
  }

  if (method === 'get' && path === '/api/v1/tenant-memory/entries') {
    return response(config, {
      ok: true,
      total: 3,
      entries: [
        {
          entry_id: 'tm_001',
          tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
          scope: 'tenant',
          scope_shared: true,
          scope_durable: true,
          category: 'brand',
          key: '品牌语气',
          value: '品牌对外表达要克制，不使用绝对化词汇。',
          source_lobster: 'strategist',
          checksum: 'chk001',
          version: 1,
          is_deleted: false,
          created_at: Date.now() / 1000 - 3600,
          updated_at: Date.now() / 1000 - 600,
        },
        {
          entry_id: 'tm_002',
          tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
          scope: 'shared',
          scope_shared: true,
          scope_durable: true,
          category: 'compliance',
          key: '敏感承诺',
          value: '涉及价格和效果承诺的内容必须走审批链。',
          source_lobster: 'dispatcher',
          checksum: 'chk002',
          version: 2,
          is_deleted: false,
          created_at: Date.now() / 1000 - 7200,
          updated_at: Date.now() / 1000 - 1800,
        },
        {
          entry_id: 'tm_003',
          tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
          scope: 'tenant',
          scope_shared: true,
          scope_durable: true,
          category: 'content',
          key: '门店探店模板',
          value: '首帧优先出现门头、价格锚点和明确地标，点击率更稳。',
          source_lobster: 'inkwriter',
          checksum: 'chk003',
          version: 1,
          is_deleted: false,
          created_at: Date.now() / 1000 - 8600,
          updated_at: Date.now() / 1000 - 2400,
        },
      ],
    });
  }

  if (method === 'get' && path === '/api/v1/tenant-memory/dual-track/stats') {
    const tenantId = String(config.params?.tenant_id || 'tenant_demo');
    return response(config, {
      ok: true,
      tenant_id: tenantId,
      stats: {
        tenant_id: tenantId,
        resident_count: 3,
        history_count: 18,
        resident_max_chars: 3575,
        latest_history_at: Date.now() / 1000 - 360,
        tracks: {
          resident: 'small_stable_always_loaded',
          history: 'large_searchable_on_demand',
        },
      },
    });
  }

  if (method === 'get' && path === '/api/v1/tenant-memory/dual-track/context') {
    const tenantId = String(config.params?.tenant_id || 'tenant_demo');
    const query = String(config.params?.query || '');
    const sourceChain = [
      { source_type: 'activity_stream', source_id: 'act_demo_revision_1024', summary: 'Copy was revised to avoid unsupported conversion promise.' },
      { source_type: 'edge_audit', source_id: 'edge_demo_retry_017', summary: 'Publish retries increased after session refresh.' },
    ];
    return response(config, {
      ok: true,
      tenant_id: tenantId,
      query,
      resident_context: [
        '- pricing_claim_guard: 涉及价格优惠、效果承诺、到店转化时，先确认租户授权口径，再输出承诺型表达。 (sources: activity_stream:act_demo_revision_1024)',
        '- publish_retry_guard: 小红书发布连续两次 session refresh 后，不继续盲重试，先升级 Commander 审核。 (sources: edge_audit:edge_demo_retry_017)',
      ].join('\n'),
      resident_items: [
        {
          resident_id: 'res_demo_001',
          tenant_id: tenantId,
          scope: 'tenant',
          key: 'pricing_claim_guard',
          content: '涉及价格优惠、效果承诺、到店转化时，先确认租户授权口径。',
          source_refs: [sourceChain[0]],
          priority: 90,
          lobster_id: 'inkwriter',
          checksum: 'reschk001',
          created_at: Date.now() / 1000 - 7200,
          updated_at: Date.now() / 1000 - 900,
        },
      ],
      history_matches: [
        {
          history_id: 'hist_demo_001',
          tenant_id: tenantId,
          source_type: 'activity_stream',
          source_id: 'act_demo_revision_1024',
          content: 'Operator repeatedly revised copy that overpromised local-store conversion claims.',
          content_hash: 'histchk001',
          source_refs: [sourceChain[0]],
          lobster_id: 'inkwriter',
          task_id: 'task_demo_copy_001',
          session_id: 'session_demo_001',
          metadata: { surface: 'preview' },
          created_at: Date.now() / 1000 - 1200,
          score: query ? 2 : 0,
        },
        {
          history_id: 'hist_demo_002',
          tenant_id: tenantId,
          source_type: 'edge_audit',
          source_id: 'edge_demo_retry_017',
          content: 'Edge publish retries increased after session refresh; Commander should review before another publish attempt.',
          content_hash: 'histchk002',
          source_refs: [sourceChain[1]],
          lobster_id: 'dispatcher',
          task_id: 'task_demo_publish_001',
          session_id: 'session_demo_002',
          metadata: { surface: 'preview' },
          created_at: Date.now() / 1000 - 2400,
          score: query ? 1 : 0,
        },
      ],
      source_chain: sourceChain,
      resident_max_chars: Number(config.params?.resident_max_chars || 3575),
      original_retained_in_history: true,
    });
  }

  if (method === 'post' && path === '/api/v1/tenant-memory/dual-track/remember') {
    const tenantId = String(body.tenant_id || 'tenant_demo');
    const now = Date.now() / 1000;
    const sourceRefs = Array.isArray(body.source_refs) && body.source_refs.length
      ? body.source_refs
      : [{ source_type: String(body.source_type || 'manual'), source_id: String(body.source_id || `manual_${Date.now()}`), summary: 'Preview memory source.' }];
    return response(config, {
      ok: true,
      tenant_id: tenantId,
      history: {
        history_id: `hist_preview_${Date.now()}`,
        tenant_id: tenantId,
        source_type: String(body.source_type || 'manual'),
        source_id: String(body.source_id || 'manual'),
        content: String(body.content || ''),
        content_hash: 'preview_hash',
        source_refs: sourceRefs,
        lobster_id: String(body.lobster_id || 'commander'),
        task_id: String(body.task_id || ''),
        session_id: String(body.session_id || ''),
        metadata: body.metadata || {},
        created_at: now,
        score: 0,
      },
      resident: body.promote_to_resident ? {
        resident_id: `res_preview_${Date.now()}`,
        tenant_id: tenantId,
        scope: String(body.scope || 'tenant'),
        key: String(body.resident_key || 'preview_memory'),
        content: String(body.content || '').slice(0, 700),
        source_refs: sourceRefs,
        priority: Number(body.resident_priority || 80),
        lobster_id: String(body.lobster_id || 'commander'),
        checksum: 'preview_resident_hash',
        created_at: now,
        updated_at: now,
      } : null,
      secret_guard_labels: [],
    });
  }

  if (method === 'get' && path === '/api/v1/runtime-capabilities/overview') {
    return response(config, {
      ok: true,
      tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
      generated_at: nowIso(),
      summary: {
        provider_count: 4,
        enabled_provider_count: 2,
        mcp_server_count: 2,
        healthy_mcp_server_count: 1,
        connector_credential_count: 3,
        configured_connector_count: 2,
      },
      providers: [
        { id: 'deepseek', name: 'deepseek', enabled: true, route: 'cloud', base_url: 'https://api.deepseek.com/v1' },
        { id: 'dashscope', name: 'dashscope', enabled: true, route: 'cloud', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      ],
      mcp_servers: [
        { id: 'tenant_fs', name: 'Tenant FS', transport: 'stdio', status: 'healthy', enabled: true },
        { id: 'design_ops', name: 'Design Ops', transport: 'http', status: 'unavailable', enabled: true },
      ],
      connector_credentials: [
        { tenant_id: String(config.params?.tenant_id || 'tenant_demo'), connector: 'feishu', present: true, expired: false, has_refresh_token: true },
        { tenant_id: String(config.params?.tenant_id || 'tenant_demo'), connector: 'hubspot', present: true, expired: false, has_refresh_token: false },
        { tenant_id: String(config.params?.tenant_id || 'tenant_demo'), connector: 'google_drive', present: false, expired: false, has_refresh_token: false },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/tasks\/runtime\/compaction\/.+$/.test(path)) {
    const sessionId = path.split('/').slice(-1)[0] || 'tenant_demo:dispatcher';
    return response(config, {
      ok: true,
      session_id: sessionId,
      compactor_version: 'v2',
      compaction_count: 2,
      recent_files_tracked: 3,
      has_workflow: true,
      skills_tracked: 2,
      runtime_policy_attached: true,
      skill_schema_attachment_count: 2,
      account_snapshot_attached: true,
      estimated_tokens: 5120,
      trigger_threshold: 3840,
      usage_percent: 133.3,
      should_compact: true,
      tokens_until_compact: 0,
      fresh_tail_count: 32,
      tool_call_count: 4,
      tool_result_count: 4,
      tool_pair_boundary_preserved: true,
      workflow_attached: true,
    });
  }

  if (method === 'get' && path === '/api/v1/control-plane/knowledge/overview') {
    return response(config, {
      ok: true,
      tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
      generated_at: nowIso(),
      summary: {
        knowledge_base_count: 4,
        module_count: 12,
        workflow_template_industries: 6,
        skills_total: 28,
        rag_packs_total: 7,
        storage_provider: 's3',
        provider_count: 4,
        mcp_server_count: 2,
        connector_credential_count: 3,
        tenant_memory_total_entries: 6,
        tenant_memory_scope_count: 3,
      },
      skills_pool: { ok: true, overview: { summary: { skills_total: 28, rag_packs_total: 7 } } },
      knowledge_bases: { ok: true, items: [{ kb_id: 'kb_demo_1', name: 'Brand KB' }] },
      modules: { ok: true, items: [{ module_id: 'mod_copy', name: 'Copy Module' }] },
      runtime_capabilities: {
        ok: true,
        tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
        generated_at: nowIso(),
        summary: {
          provider_count: 4,
          enabled_provider_count: 2,
          mcp_server_count: 2,
          healthy_mcp_server_count: 1,
          connector_credential_count: 3,
          configured_connector_count: 2,
        },
        providers: [{ id: 'deepseek', name: 'deepseek', enabled: true }],
        mcp_servers: [{ id: 'tenant_fs', name: 'Tenant FS', status: 'healthy' }],
        connector_credentials: [{ connector: 'feishu', present: true, expired: false }],
      },
      tenant_memory: {
        ok: true,
        tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
        total_entries: 6,
        by_scope: { tenant: 3, shared: 1, role_local: 2 },
        scope_details: {
          tenant: { count: 3, shared: true, durable: true },
          shared: { count: 1, shared: true, durable: true },
          role_local: { count: 2, shared: false, durable: true },
        },
        by_category: { brand: 2, compliance: 1, content: 2, engagement: 1 },
        by_lobster: { strategist: 2, dispatcher: 1, echoer: 1, inkwriter: 2 },
        last_updated_at: Date.now() / 1000,
        scopes_available: ['session', 'tenant', 'shared', 'role_local', 'mission_local'],
      },
      integrations: {
        storage: { provider: 's3' },
        group_collab: { provider: 'feishu' },
        custom_tools: { count: 3 },
      },
    });
  }

  if (method === 'get' && path === '/api/v1/control-plane/knowledge/tenant-private-summaries') {
    const params = (config.params || {}) as Record<string, unknown>;
    const sourceType = params.source_type ? String(params.source_type) : '';
    const limit = Math.max(1, Math.min(Number(params.limit ?? 50) || 50, 200));
    const filtered = buildPreviewCollabKnowledgeSummaries().filter((item) => {
      if (sourceType && item.sourceType !== sourceType) return false;
      return true;
    });
    return response(config, {
      ok: true,
      tenant_id: String(params.tenant_id || 'tenant_demo'),
      total: filtered.length,
      items: filtered.slice(0, limit),
    });
  }

  if (method === 'post' && path === '/api/v1/control-plane/knowledge/resolve') {
    const tenantId = String(body.tenant_id || 'tenant_demo');
    const roleId = String(body.role_id || 'strategist');
    const industryTag = String(body.industry_tag || '餐饮服务_中餐馆');
    const taskType = String(body.task_type || 'workflow_board_preview');
    const context = buildPreviewRuntimeKnowledgeContext({
      tenantId,
      roleId,
      industryTag,
      taskType,
    });
    return response(config, {
      ok: true,
      tenant_id: tenantId,
      role_id: roleId,
      industry_tag: industryTag,
      task_type: taskType,
      resolved: {
        platform_common: context.layers.platform_common.items,
        platform_industry: context.layers.platform_industry.items,
        tenant_private: context.layers.tenant_private.items,
      },
      explainable_sources: context.explainable_sources,
      policy: context.policy,
    });
  }

  if (method === 'get' && path === '/api/v1/control-plane/monitor/overview') {
    return response(config, {
      ok: true,
      tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
      generated_at: nowIso(),
      summary: {
        node_count: 2,
        online_count: 1,
        busy_count: 1,
        log_count: 2,
        runtime_foreground_count: 2,
        task_notification_count: 2,
        edge_snapshot_count: 2,
        subject_count: 3,
        prefix_count: 2,
      },
      snapshot: {
        ok: true,
        tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
        nodes: previewFleetNodes.map((node, index) => ({
          node_id: node.nodeId,
          tenant_id: node.tenantId,
          client_name: node.clientName,
          region: Array.isArray(node.platforms) ? node.platforms.join(',') : undefined,
          status: node.status,
          load_percent: Math.max(Number(node.cpuPercent || 0), Number(node.memoryPercent || 0)),
          running_task_id: index === 1 ? 'task_demo_002' : 'task_demo_001',
          last_seen_at: node.lastPingAt,
        })),
        recent_logs: [
          {
            event_id: 'fleetlog_task_demo_002',
            task_id: 'task_demo_002',
            node_id: 'node_demo_02',
            level: 'warn',
            stage: 'edge_publish_dispatch',
            message: '边缘节点正在处理发布窗口检查。',
            created_at: nowIso(),
          },
          {
            event_id: 'fleetlog_task_demo_001',
            task_id: 'task_demo_001',
            node_id: 'node_demo_01',
            level: 'info',
            stage: 'cloud_archive',
            message: '云端归档完成，等待后续信号。',
            created_at: nowIso(),
          },
        ],
        runtime_foreground: [
          {
            task_id: 'run_demo_dispatcher_01',
            lobster_id: 'dispatcher',
            description: '发布账号 A 的早间内容包',
            status: 'running',
            mode: 'foreground',
            elapsed_sec: 8.4,
            is_backgrounded: false,
          },
          {
            task_id: 'run_demo_radar_01',
            lobster_id: 'radar',
            description: '扫描今日行业热点与竞品动态',
            status: 'backgrounded',
            mode: 'background',
            elapsed_sec: 35.2,
            is_backgrounded: true,
          },
        ],
        recent_task_notifications: [
          {
            activity_id: 'act_tasknotif_001',
            task_id: 'run_demo_visualizer_01',
            lobster_id: 'visualizer',
            status: 'completed',
            mode: 'background',
            summary: '封面与分镜生成完成',
            total_tokens: 1860,
            tool_uses: 4,
            duration_ms: 18220,
            created_at: nowIso(),
          },
          {
            activity_id: 'act_tasknotif_002',
            task_id: 'run_demo_echoer_01',
            lobster_id: 'echoer',
            status: 'failed',
            mode: 'background',
            summary: '评论承接任务失败：渠道回复超时',
            total_tokens: 420,
            tool_uses: 2,
            duration_ms: 6430,
            created_at: nowIso(),
          },
        ],
        recent_edge_snapshots: [
          {
            snapshot_id: 'snap_edge_001',
            node_id: 'node_demo_01',
            task_id: 'task_demo_001',
            status: 'failed',
            duration_ms: 2210,
            blocked_steps: 1,
            needs_approval_steps: 1,
            checked_steps: 3,
            created_at: nowIso(),
          },
          {
            snapshot_id: 'snap_edge_002',
            node_id: 'node_demo_02',
            task_id: 'task_demo_002',
            status: 'success',
            duration_ms: 1830,
            blocked_steps: 0,
            needs_approval_steps: 0,
            checked_steps: 2,
            created_at: nowIso(),
          },
        ],
      },
      event_bus: {
        prefix: String(config.params?.subject_prefix || ''),
        subjects: {
          subjects: [
            { subject: 'task.tenant_demo.dispatcher', count_last_minute: 3, count_last_hour: 38, total_count: 320, last_published_at: Math.floor(Date.now() / 1000) - 30 },
            { subject: 'task.tenant_demo.echoer', count_last_minute: 1, count_last_hour: 14, total_count: 188, last_published_at: Math.floor(Date.now() / 1000) - 70 },
            { subject: 'activity.tenant_demo.task_notification_emitted', count_last_minute: 2, count_last_hour: 21, total_count: 96, last_published_at: Math.floor(Date.now() / 1000) - 45 },
          ],
        },
        prefixes: {
          prefixes: [
            { prefix: 'task.tenant_demo', count_last_minute: 4, count_last_hour: 52, total_count: 508 },
            { prefix: 'activity.tenant_demo', count_last_minute: 2, count_last_hour: 21, total_count: 96 },
          ],
        },
      },
      kernel: {
        orla_dispatcher: {
          tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
          days: 7,
          dispatcher_total: 14,
          orla_enabled_total: 9,
          success_count: 8,
          shared_state_hit_rate: 0.6667,
          by_stage: { dispatch_plan: 7, dispatch_exception_reasoning: 2 },
          by_tier: { standard: 4, pro: 4, frontier: 1 },
          promotion_triggers: { queue_conflict: 2, edge_retry_exhausted: 1 },
          latest: { activity_id: 'act_orla_1' },
        },
      },
      ws: {
        path: '/ws/execution-logs',
        readiness: 'pending_gateway_bridge',
      },
    });
  }

  if (method === 'get' && path === '/api/v1/control-plane/supervisors/overview') {
    return response(config, {
      ok: true,
      tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
      generated_at: nowIso(),
      summary: {
        lobster_count: 9,
        enabled_binding_count: 7,
        provider_count: 4,
        enabled_provider_count: 2,
        skills_total: 28,
        nodes_total: 11,
      },
      service: { status: 'ok' },
      providers: {
        providers: [
          { provider_id: 'deepseek', label: 'DeepSeek', default_model: 'deepseek-chat', enabled: true },
          { provider_id: 'dashscope', label: 'DashScope', default_model: 'qwen-max', enabled: true },
        ],
      },
      bindings: {
        bindings: [
          { agent_id: 'radar', enabled: true, task_type: 'radar_enrichment', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.3, max_tokens: 4096 },
          { agent_id: 'strategist', enabled: true, task_type: 'strategy_planning', provider_id: 'dashscope', model_name: 'qwen-max', temperature: 0.3, max_tokens: 4096 },
        ],
      },
      skills_pool: {
        tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
        overview: {
          summary: {
            agents_total: 9,
            agents_enabled: 7,
            skills_total: 28,
            nodes_total: 11,
            kb_profiles_total: 4,
            rag_packs_total: 7,
            workflow_templates_total: 6,
          },
          agent_rag_pack_summary: [
            { agent_id: 'radar', pack_count: 2 },
            { agent_id: 'strategist', pack_count: 1 },
            { agent_id: 'dispatcher', pack_count: 1 },
          ],
        },
      },
      lobsters: {
        items: [
          { id: 'radar', zh_name: '触须虾', display_name: 'Radar', status: 'enabled' },
          { id: 'strategist', zh_name: '策士虾', display_name: 'Strategist', status: 'enabled' },
        ],
      },
    });
  }

  if (method === 'get' && path === '/api/v1/control-plane/supervisors/overview') {
    return response(config, {
      ok: true,
      tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
      generated_at: nowIso(),
      summary: {
        lobster_count: 9,
        enabled_binding_count: 7,
        provider_count: 4,
        enabled_provider_count: 2,
        skills_total: 28,
        nodes_total: 11,
      },
      service: { status: 'ok' },
      providers: {
        providers: [
          { provider_id: 'deepseek', label: 'DeepSeek', default_model: 'deepseek-chat', enabled: true },
          { provider_id: 'dashscope', label: 'DashScope', default_model: 'qwen-max', enabled: true },
        ],
      },
      bindings: {
        bindings: [
          { agent_id: 'radar', enabled: true, task_type: 'radar_enrichment', provider_id: 'deepseek', model_name: 'deepseek-chat', temperature: 0.3, max_tokens: 4096 },
          { agent_id: 'strategist', enabled: true, task_type: 'strategy_planning', provider_id: 'dashscope', model_name: 'qwen-max', temperature: 0.3, max_tokens: 4096 },
        ],
      },
      skills_pool: {
        tenant_id: String(config.params?.tenant_id || 'tenant_demo'),
        overview: {
          summary: {
            agents_total: 9,
            agents_enabled: 7,
            skills_total: 28,
            nodes_total: 11,
            kb_profiles_total: 4,
            rag_packs_total: 7,
            workflow_templates_total: 6,
          },
          agent_rag_pack_summary: [
            { agent_id: 'radar', pack_count: 2 },
            { agent_id: 'strategist', pack_count: 1 },
            { agent_id: 'dispatcher', pack_count: 1 },
          ],
        },
      },
      lobsters: {
        items: [
          { id: 'radar', zh_name: '触须虾', display_name: 'Radar', status: 'enabled' },
          { id: 'strategist', zh_name: '策士虾', display_name: 'Strategist', status: 'enabled' },
        ],
      },
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/memory\/stats\/[^/]+$/.test(path)) {
    return response(config, {
      ok: true,
      stats: {
        lobster_id: path.split('/').pop(),
        tenant_id: 'tenant_demo',
        l0_count: 32,
        l1_count: 11,
        l2_count: 4,
        compression_ratio: 0.68,
        layers: {
          L0: { count: 32, bytes: 786_432 },
          L1: { count: 11, bytes: 262_144 },
          L2: { count: 4, bytes: 81_920 },
        },
      },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/memory/wisdoms') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      count: 3,
      wisdoms: [
        {
          wisdom_id: 'wisdom_001',
          category: 'content',
          statement: '同城餐饮短视频首帧需要出现明确地标、价格锚点或门店外观，点击率更稳定。',
          confidence: 0.91,
          source_reports: ['report_001', 'report_003', 'report_004'],
          lobster_ids: ['strategist', 'inkwriter'],
          tenant_id: 'tenant_demo',
          created_at: nowIso(),
          updated_at: nowIso(),
          merge_count: 3,
        },
        {
          wisdom_id: 'wisdom_002',
          category: 'customer',
          statement: '用户主动询问价格、地址或到店方式时，通常已经进入高意向阶段，应立即转 followup。',
          confidence: 0.88,
          source_reports: ['report_005', 'report_006'],
          lobster_ids: ['catcher', 'followup'],
          tenant_id: 'tenant_demo',
          created_at: nowIso(),
          updated_at: nowIso(),
          merge_count: 2,
        },
        {
          wisdom_id: 'wisdom_003',
          category: 'channel',
          statement: '周末午后发布本地生活内容的互动率显著高于工作日，适合做门店引流型主题。',
          confidence: 0.84,
          source_reports: ['report_007'],
          lobster_ids: ['abacus'],
          tenant_id: 'tenant_demo',
          created_at: nowIso(),
          updated_at: nowIso(),
          merge_count: 1,
        },
      ],
    });
  }

  if (method === 'get' && path === '/api/v1/ai/memory/reports') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      count: 2,
      reports: [
        {
          report_id: 'report_001',
          source_entry_id: 'entry_001',
          lobster_id: 'strategist',
          task_summary: '本周执行复盘',
          decision: '继续放大同城短视频路线，保留低风险门店探店模板。',
          outcome: '共执行 42 条任务，转化率 18%。',
          next_steps: ['补齐工作日晚间样本', '增强 CTA 对比测试'],
          key_entities: ['同城门店', '短视频引流'],
          metrics: { conversion_rate: 0.18, task_count: 42 },
          tenant_id: 'tenant_demo',
          created_at: nowIso(),
          token_count: 860,
          source_token_count: 3120,
          promoted_to_l2: true,
        },
        {
          report_id: 'report_002',
          source_entry_id: 'entry_002',
          lobster_id: 'abacus',
          task_summary: '上周策略命中分析',
          decision: '保留高点击首帧模板，压缩弱转化泛流量选题。',
          outcome: '命中率 82%，最强策略为同城短视频。',
          next_steps: ['复盘低转化样本', '细分平台投放时间窗'],
          key_entities: ['抖音', '小红书'],
          metrics: { hit_rate: 0.82 },
          tenant_id: 'tenant_demo',
          created_at: nowIso(),
          token_count: 540,
          source_token_count: 1980,
          promoted_to_l2: false,
        },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/ai/memory/compress') {
    return response(config, { ok: true, compressed_count: 12, compression_ratio: 0.74 });
  }

  if (method === 'post' && path === '/api/v1/ai/memory/hybrid-search') {
    return response(config, {
      ok: true,
      backend: 'preview',
      query: String(body.query || ''),
      items: [
        {
          final_score: 0.91,
          dense_rank: 1,
          sparse_rank: 2,
          memory_details: {
            memory_id: 'mem_001',
            lobster_id: 'strategist',
            category: String(body.memory_type || 'content'),
            content: '相关记忆内容示例：同城门店内容在首屏突出价格锚点和地标时，点击率更高。',
            created_at: nowIso(),
          },
        },
      ],
    });
  }

  if (method === 'get' && path === '/api/v1/ai/vector-backup/history') {
    return response(config, {
      ok: true,
      items: [
        { backup_id: 'backup_001', collection_name: 'lobster_episodic_memory', snapshot_name: 'lobster_episodic_memory-001', backup_path: '/tmp/vector/lobster_episodic_memory-001.snapshot', status: 'ok', size_bytes: 1024000, created_at: nowIso(), detail: {} },
        { backup_id: 'backup_002', collection_name: 'viral_formulas', snapshot_name: 'viral_formulas-001', backup_path: '/tmp/vector/viral_formulas-001.snapshot', status: 'ok', size_bytes: 768000, created_at: nowIso(), detail: {} },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/vector-backup\/snapshots\/[^/]+$/.test(path)) {
    return response(config, {
      ok: true,
      collection_name: decodeURIComponent(path.split('/').pop() || 'lobster_episodic_memory'),
      snapshots: [
        { name: `${decodeURIComponent(path.split('/').pop() || 'lobster_episodic_memory')}-snap-001`, creation_time: nowIso(), size: 1024000 },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/ai/vector-backup/trigger') {
    const collections = Array.isArray(body.collections) && body.collections.length
      ? body.collections.map((item) => String(item))
      : ['lobster_episodic_memory'];
    return response(config, {
      ok: true,
      elapsed_seconds: 3,
      collections: Object.fromEntries(
        collections.map((collection) => [
          collection,
          { status: 'ok', path: `/tmp/vector/${collection}.snapshot`, size_mb: 1.2 },
        ]),
      ),
    });
  }

  // ── Strategy intensity & autonomy policy ─────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/strategy/intensity') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      current_level: 2,
      max_level: 5,
      label: '标准推进',
      description: '系统按正常节奏推进任务，人工可随时介入。',
      updated_at: nowIso(),
    });
  }

  if (method === 'get' && path === '/api/v1/ai/strategy/intensity/history') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      history: [
        { level: 1, label: '保守', changed_at: nowIso(), operator: 'system' },
        { level: 2, label: '标准推进', changed_at: nowIso(), operator: 'demo_admin' },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/ai/strategy/intensity/escalate') {
    return response(config, { ok: true, current_level: 3, label: '积极推进' });
  }

  if (method === 'post' && path === '/api/v1/ai/strategy/intensity/deescalate') {
    return response(config, { ok: true, current_level: 1, label: '保守' });
  }

  if (method === 'get' && path === '/api/v1/ai/autonomy/policy') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      policy: {
        autonomy_level: 'semi_auto',
        auto_approve_below_risk: 'P3',
        require_human_above_risk: 'P1',
        max_auto_runs_per_hour: 20,
        pause_on_dlq: true,
      },
    });
  }

  if (method === 'put' && path === '/api/v1/ai/autonomy/policy') {
    return response(config, { ok: true, policy: body });
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/analytics/attribution') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      attribution: [
        { channel: 'douyin', leads: 18, revenue_cny: 12400, attribution_pct: 0.58 },
        { channel: 'wechat', leads: 9, revenue_cny: 6800, attribution_pct: 0.29 },
        { channel: 'xiaohongshu', leads: 3, revenue_cny: 2100, attribution_pct: 0.13 },
      ],
      total_leads: 30,
      total_revenue_cny: 21300,
      period: 'last_30_days',
    });
  }

  if (method === 'get' && path === '/api/v1/analytics/funnel') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      funnel: [
        { stage: '曝光', count: 48200, drop_rate: 0 },
        { stage: '点击', count: 3840, drop_rate: 0.92 },
        { stage: '私信', count: 186, drop_rate: 0.95 },
        { stage: '线索识别', count: 48, drop_rate: 0.74 },
        { stage: '意向确认', count: 22, drop_rate: 0.54 },
        { stage: '转化', count: 9, drop_rate: 0.59 },
      ],
      period: 'last_30_days',
    });
  }

  // ── AI providers (plugin-style) ───────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/providers') {
    return response(config, {
      ok: true,
      providers: [
        { id: 'deepseek', label: 'DeepSeek', enabled: true, base_url: 'https://api.deepseek.com/v1', default_model: 'deepseek-chat', health: { status: 'healthy', latency_ms: 380 } },
        { id: 'openai', label: 'OpenAI', enabled: false, base_url: 'https://api.openai.com/v1', default_model: 'gpt-4o-mini', health: { status: 'offline', latency_ms: 0 } },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/ai/providers') {
    return response(config, { ok: true, id: `provider_${Date.now()}`, ...body });
  }

  if (method === 'put' && /\/api\/v1\/ai\/providers\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'delete' && /\/api\/v1\/ai\/providers\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'post' && /\/api\/v1\/ai\/providers\/[^/]+\/reload$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'post' && /\/api\/v1\/ai\/providers\/[^/]+\/smoke$/.test(path)) {
    return response(config, { ok: true, latency_ms: 350, model: 'deepseek-chat' });
  }

  if (method === 'get' && /\/api\/v1\/ai\/providers\/[^/]+\/metrics$/.test(path)) {
    return response(config, { ok: true, requests: 128, errors: 2, avg_latency_ms: 380, p99_latency_ms: 920 });
  }

  if (method === 'get' && path === '/api/v1/ai/providers/health') {
    return response(config, { ok: true, healthy: 1, total: 2 });
  }

  // ── Team / Users ──────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/auth/users') {
    return response(config, {
      code: 0,
      data: [
        { id: 'demo_admin', name: '演示管理员', role: 'admin', tenantId: 'tenant_demo', isAdmin: true, createdAt: nowIso() },
        { id: 'demo_op', name: '演示运营', role: 'operator', tenantId: 'tenant_demo', isAdmin: false, createdAt: nowIso() },
      ],
    });
  }

  // ── Scheduler tasks ───────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/scheduler/tasks') {
    return response(config, {
      ok: true,
      count: 2,
      tasks: [
        { task_id: 'task_demo_001', name: '每日策略简报', schedule: '0 9 * * *', enabled: true, last_run_at: nowIso(), next_run_at: nowIso() },
        { task_id: 'task_demo_002', name: '高意向线索跟进提醒', schedule: '0 */2 * * *', enabled: true, last_run_at: nowIso(), next_run_at: nowIso() },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/ai/scheduler/tasks') {
    return response(config, { ok: true, task_id: `task_${Date.now()}`, ...body });
  }

  if (method === 'delete' && /\/api\/v1\/ai\/scheduler\/tasks\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'get' && /\/api\/v1\/ai\/scheduler\/tasks\/[^/]+\/history$/.test(path)) {
    return response(config, {
      ok: true,
      items: [
        { run_id: 'run_001', status: 'success', started_at: nowIso(), finished_at: nowIso() },
      ],
    });
  }

  // ── Industry KB taxonomy ──────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/industry-kb/taxonomy') {
    return response(config, {
      ok: true,
      taxonomy: [
        {
          category_tag: '餐饮服务',
          category_name: '餐饮服务',
          sub_industries: [
            {
              tag: '餐饮服务_中餐馆',
              name: '中餐馆',
              aliases: ['中式餐饮', '本地中餐'],
            },
            {
              tag: '餐饮服务_快餐店',
              name: '快餐店',
              aliases: ['快餐', '简餐'],
            },
          ],
        },
        {
          category_tag: '美业健康',
          category_name: '美业健康',
          sub_industries: [
            {
              tag: '美业健康_美容院',
              name: '美容院',
              aliases: ['美容美发', '皮肤管理'],
            },
          ],
        },
        {
          category_tag: '医疗健康',
          category_name: '医疗健康',
          sub_industries: [
            {
              tag: '医疗健康_口腔门诊',
              name: '口腔门诊',
              aliases: ['口腔诊所', '牙科'],
            },
          ],
        },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/ai/industry-kb/bootstrap') {
    return response(config, { ok: true, industry_tag: String(body.industry_tag || '') });
  }

  if (method === 'get' && path === '/api/v1/ai/industry-knowledge-packs/readiness') {
    const industryTag = String(config.params?.industry_tag || '餐饮服务_中餐馆');
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      industry_tag: industryTag,
      readiness: {
        ok: true,
        industry_tag: industryTag,
        matched_industry: industryTag === 'hotel_stay.apartment_hotel' ? '酒店民宿_公寓酒店' : industryTag,
        roles_total: 9,
        roles_ready: 9,
        files_expected: 36,
        files_ready: 36,
        missing: [],
        role_packs: {},
      },
    });
  }

  // ── Run dragon team (async status) ───────────────────────────────────────

  if (method === 'post' && path === '/api/v1/ai/run-dragon-team') {
    const knowledgeContext = buildPreviewRuntimeKnowledgeContext({
      tenantId: 'tenant_demo',
      industryTag: String(body.industry_tag || body.industry || '餐饮服务_中餐馆'),
      roleId: 'strategist',
      taskType: 'run_dragon_team',
    });
    const industryTag = String(body.industry_tag || body.industry || '餐饮服务_中餐馆');
    const industryKnowledgePacks = {
      ok: true,
      industry_tag: industryTag,
      matched_industry: industryTag === 'hotel_stay.apartment_hotel' ? '酒店民宿_公寓酒店' : industryTag,
      roles_total: 9,
      roles_ready: 9,
      files_expected: 36,
      files_ready: 36,
      missing: [],
    };
    return response(config, {
      ok: true,
      mission_id: `mission_dragon_${Date.now()}`,
      request_id: `req_dragon_${Date.now()}`,
      status: 'success',
      pipeline_mode: 'standard',
      artifact_count: 3,
      industry_knowledge_packs: industryKnowledgePacks,
      knowledge_context: knowledgeContext,
      kernel_report: {
        knowledge_context: knowledgeContext,
        industry_knowledge_packs: industryKnowledgePacks,
      },
      message: '策略生成已完成，知识上下文已注入。',
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/artifacts\/job\/[^/]+$/.test(path)) {
    return response(config, {
      ok: true,
      job_id: path.split('/').pop(),
      mission_id: 'mission_demo_knowledge_ready',
      pipeline_mode: 'dragon_senate',
      pipeline_explain: {
        steps: ['radar', 'strategist', 'inkwriter', 'visualizer', 'dispatcher'],
        workflow: 'content-campaign-14step',
      },
      status: 'completed',
      artifact_count: 3,
      industry_knowledge_packs: {
        ok: true,
        matched_industry: '酒店民宿_公寓酒店',
        roles_total: 9,
        roles_ready: 9,
        files_expected: 36,
        files_ready: 36,
        missing: [],
        role_packs: {
          radar: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/radar/酒店民宿_公寓酒店', packs: {} },
          strategist: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/strategist/酒店民宿_公寓酒店', packs: {} },
          inkwriter: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/inkwriter/酒店民宿_公寓酒店', packs: {} },
          visualizer: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/visualizer/酒店民宿_公寓酒店', packs: {} },
          dispatcher: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/dispatcher/酒店民宿_公寓酒店', packs: {} },
          echoer: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/echoer/酒店民宿_公寓酒店', packs: {} },
          catcher: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/catcher/酒店民宿_公寓酒店', packs: {} },
          abacus: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/abacus/酒店民宿_公寓酒店', packs: {} },
          followup: { ready: true, path: 'dragon-senate-saas-v2/data/knowledge-packs/followup/酒店民宿_公寓酒店', packs: {} },
        },
      },
      artifact_index: [],
      artifacts: {},
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/artifacts\/mission\/[^/]+$/.test(path)) {
    return response(config, {
      ok: true,
      mission_id: path.split('/').pop(),
      pipeline_mode: 'dragon_senate',
      pipeline_explain: {},
      job_count: 1,
      jobs: [{ job_id: 'job_demo_001', status: 'completed', artifact_count: 3, pipeline_mode: 'dragon_senate' }],
      latest_job_id: 'job_demo_001',
      artifact_count: 3,
      industry_knowledge_packs: {
        ok: true,
        matched_industry: '酒店民宿_公寓酒店',
        roles_total: 9,
        roles_ready: 9,
        files_expected: 36,
        files_ready: 36,
        missing: [],
        role_packs: {},
      },
      artifact_index: [],
      artifacts: {},
    });
  }

  if (method === 'post' && path === '/api/v1/ai/run-dragon-team-async') {
    return response(config, {
      ok: true,
      job_id: `job_dragon_async_${Date.now()}`,
      status: 'queued',
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/run-dragon-team-async\/[^/]+$/.test(path)) {
    const knowledgeContext = buildPreviewRuntimeKnowledgeContext({
      tenantId: 'tenant_demo',
      industryTag: '餐饮服务_中餐馆',
      roleId: 'strategist',
      taskType: 'run_dragon_team',
    });
    return response(config, {
      ok: true,
      job_id: path.split('/').pop(),
      status: 'completed',
      pipeline_mode: 'standard',
      artifact_count: 3,
      result: {
        knowledge_context: knowledgeContext,
        industry_knowledge_packs: {
          ok: true,
          industry_tag: '餐饮服务_中餐馆',
          matched_industry: '餐饮服务_中餐馆',
          roles_total: 9,
          roles_ready: 9,
          files_expected: 36,
          files_ready: 36,
          missing: [],
          role_packs: {},
        },
        kernel_report: {
          knowledge_context: knowledgeContext,
          industry_knowledge_packs: {
            ok: true,
            industry_tag: '餐饮服务_中餐馆',
            matched_industry: '餐饮服务_中餐馆',
            roles_total: 9,
            roles_ready: 9,
            files_expected: 36,
            files_ready: 36,
            missing: [],
            role_packs: {},
          },
        },
        strategy: {
          summary: '基于行业数据生成同城获客策略，建议先从抖音短视频切入，再结合私信回复收线索。',
          steps: ['制作 3 条短视频内容', '投放同城流量', '设置私信自动回复', '铁网虾识别高意向线索'],
          estimated_leads_per_day: 8,
          risk_level: 'P2',
        },
      },
    });
  }

  if (method === 'post' && path === '/api/v1/ai/pipeline-modes/preview') {
    return response(config, {
      ok: true,
      mode: String(body.mode || 'standard'),
      preview: { steps: 4, estimated_tokens: 3200, risk_level: 'P2' },
    });
  }

  if (method === 'post' && path === '/api/industry-workflow/preview') {
    type IndustryWorkflowPreviewPayload = {
      workflowId?: unknown;
      categoryId?: unknown;
      subIndustryId?: unknown;
      channels?: unknown;
      merchantProfile?: {
        brandName?: unknown;
        tenantId?: unknown;
        bindAccounts?: unknown;
        customerPainPoints?: unknown;
        solvedProblems?: unknown;
        personaBackground?: unknown;
        competitiveAdvantages?: unknown;
      };
    };

    const fallbackRequestPayload: IndustryWorkflowPreviewPayload = {
      workflowId: 'industry-workflow-demo',
      categoryId: 'food_service',
      subIndustryId: 'chinese_restaurant',
      merchantProfile: {
        brandName: '龙虾池行业样板',
        tenantId: 'tenant_demo',
        bindAccounts: [],
        customerPainPoints: [],
        solvedProblems: [],
        personaBackground: '',
        competitiveAdvantages: [],
      },
    };

    const requestPayload: IndustryWorkflowPreviewPayload =
      body.request && typeof body.request === 'object'
        ? (body.request as IndustryWorkflowPreviewPayload)
        : fallbackRequestPayload;
    return response(config, {
      ok: true,
      request: requestPayload,
      blueprint: {
        workflowId: String(requestPayload.workflowId || 'industry-workflow-demo'),
        industry: {
          categoryId: String(requestPayload.categoryId || 'food_service'),
          categoryLabel: '餐饮服务',
          subIndustryId: String(requestPayload.subIndustryId || 'chinese_restaurant'),
          subIndustryLabel: '中餐馆',
        },
        channels: Array.isArray(requestPayload.channels) ? requestPayload.channels : ['douyin', 'wechat'],
        merchantDigest: {
          brandName: String(requestPayload.merchantProfile?.brandName || '龙虾池行业样板'),
          customerPainPoints: Array.isArray(requestPayload.merchantProfile?.customerPainPoints) ? requestPayload.merchantProfile.customerPainPoints : [],
          competitiveAdvantages: Array.isArray(requestPayload.merchantProfile?.competitiveAdvantages) ? requestPayload.merchantProfile.competitiveAdvantages : [],
        },
        businessSteps: [
          {
            stepNumber: 1,
            stepId: 'strategy-01',
            label: '策略拆解',
            goal: '生成同城增长路线',
            ownerRole: 'strategist',
            runtimeAction: { bridgeTarget: 'brain-shadow-runner', operation: 'strategy_plan' },
            approval: { required: false, actions: [] },
          },
        ],
        cloudOutputs: ['StrategyRoute', 'CopyPack'],
        edgeOutputs: ['ExecutionPlan'],
        approvalSummary: [{ stepNumber: 2, stepId: 'content-01', actions: ['publish_external'] }],
        topicScoringRubric: ['同城 relevance', '线索承接'],
      },
      task_description: '基于行业工作流请求生成同城商家增长主线。',
    });
  }

  // ── Agent extensions & LLM provider configs ───────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/agent/extensions') {
    return response(config, {
      ok: true,
      agents: ['commander', 'radar', 'strategist', 'inkwriter', 'visualizer', 'dispatcher', 'echoer', 'catcher', 'abacus', 'followup'].map((id) => ({
        agent_id: id,
        enabled: true,
        custom_prompt: '',
        tool_whitelist: [],
        memory_enabled: true,
      })),
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/agent\/extensions\/[^/]+$/.test(path)) {
    const agentId = path.split('/').pop();
    return response(config, {
      ok: true,
      agent_id: agentId,
      enabled: true,
      custom_prompt: '',
      tool_whitelist: [],
      memory_enabled: true,
    });
  }

  if (method === 'put' && /\/api\/v1\/ai\/agent\/extensions\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'put' && /\/api\/v1\/ai\/llm\/providers\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  // ── Lobster configs & entities ────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/lobster-config') {
    return response(config, { ok: true, configs: [] });
  }

  if (method === 'get' && /\/api\/v1\/lobster-config\/[^/]+$/.test(path)) {
    return response(config, { ok: true, config: { lobster_id: path.split('/').pop(), settings: {} } });
  }

  if (method === 'patch' && /\/api\/v1\/lobster-config\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'get' && path === '/api/v1/lobsters') {
    return response(config, {
      ok: true,
      count: 9,
      items: ['radar', 'strategist', 'inkwriter', 'visualizer', 'dispatcher', 'echoer', 'catcher', 'abacus', 'followup'].map((id) => ({
        id,
        lobster_id: id,
        display_name: id,
        zh_name: id,
        status: 'active',
        lifecycle: 'production',
        created_at: nowIso(),
      })),
    });
  }

  if (method === 'get' && /\/api\/v1\/lobsters\/[^/]+\/lifecycle$/.test(path)) {
    return response(config, { ok: true, lifecycle: 'production' });
  }

  if (method === 'put' && /\/api\/v1\/lobsters\/[^/]+\/lifecycle$/.test(path)) {
    return response(config, { ok: true });
  }

  // ── Workflow & Templates ──────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/workflow/list') {
    return response(config, {
      ok: true,
      count: 2,
      workflows: [
        { id: 'wf_demo_001', name: '同城获客主流程', status: 'active', lifecycle: 'active', step_count: 5, agents: ['strategist', 'catcher'], version: 'v1', created_at: nowIso() },
        { id: 'wf_demo_002', name: '高意向线索跟进', status: 'active', lifecycle: 'active', step_count: 3, agents: ['follower', 'abacus'], version: 'v1', created_at: nowIso() },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/workflows\/[^/]+$/.test(path) && !path.includes('/lifecycle') && !path.includes('/executions') && !path.includes('/webhooks')) {
    const wfId = path.split('/').pop();
    return response(config, {
      ok: true,
      workflow: { id: wfId, name: '演示工作流', status: 'active', lifecycle: 'active', step_count: 4, agents: [], steps: [], version: 'v1', created_at: nowIso() },
    });
  }

  if (method === 'get' && /\/api\/v1\/workflows\/[^/]+\/lifecycle$/.test(path)) {
    return response(config, { ok: true, workflow_id: decodeURIComponent(path.split('/')[4] || ''), lifecycle: 'active' });
  }

  if (method === 'put' && /\/api\/v1\/workflows\/[^/]+\/lifecycle$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'put' && /\/api\/v1\/workflows\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'post' && /\/api\/v1\/ai\/workflow\/run\/[^/]+\/resume$/.test(path)) {
    return response(config, { ok: true, run_id: path.split('/')[6], status: 'running' });
  }

  if (method === 'post' && /\/api\/v1\/ai\/workflow\/run\/[^/]+\/pause$/.test(path)) {
    return response(config, { ok: true, run_id: path.split('/')[6], status: 'paused' });
  }

  if (method === 'post' && /\/api\/v1\/workflows\/executions\/[^/]+\/replay$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'get' && /\/api\/v1\/workflows\/executions\/[^/]+$/.test(path)) {
    return response(config, { ok: true, execution: { execution_id: path.split('/').pop(), status: 'completed' } });
  }

  if (method === 'patch' && /\/api\/v1\/skills\/[^/]+\/status$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'get' && /\/api\/v1\/ai\/skills\/[^/]+\/effectiveness$/.test(path)) {
    return response(config, { ok: true, skill_id: path.split('/')[5], effectiveness_score: 0.82 });
  }

  if (method === 'post' && path === '/api/v1/ai/workflow/run') {
    const runId = `run_${Date.now()}`;
    return response(config, {
      ok: true,
      run_id: runId,
      status: 'running',
      run: { run_id: runId, workflow_id: (body as Record<string, unknown>)?.workflow_id || 'wf_demo_001', task: (body as Record<string, unknown>)?.task || '', status: 'running', run_number: 1, current_step_id: null, updated_at: nowIso() },
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/workflow\/run\/[^/]+$/.test(path)) {
    const runId = path.split('/').pop();
    return response(config, {
      ok: true,
      run_id: runId,
      status: 'completed',
      run: { run_id: runId, workflow_id: 'wf_demo_001', task: '演示任务', status: 'completed', run_number: 1, current_step_id: null, updated_at: nowIso(), steps: [] },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/workflow/runs') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      count: 2,
      runs: [
        { run_id: 'run_demo_001', run_number: 1, tenant_id: 'tenant_demo', workflow_id: 'wf_demo_001', task: '同城获客主流程', status: 'running', trigger_type: 'manual', current_step_id: 'step_1', created_at: nowIso(), updated_at: nowIso() },
        { run_id: 'run_demo_002', run_number: 2, tenant_id: 'tenant_demo', workflow_id: 'wf_demo_002', task: '高意向线索跟进', status: 'paused', trigger_type: 'manual', current_step_id: 'step_2', created_at: nowIso(), updated_at: nowIso() },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/workflows\/[^/]+\/executions$/.test(path)) {
    return response(config, { ok: true, items: [], total: 0 });
  }

  if (method === 'get' && /\/api\/v1\/workflows\/[^/]+\/webhooks$/.test(path)) {
    return response(config, { ok: true, webhooks: [] });
  }

  if (method === 'post' && /\/api\/v1\/workflows\/[^/]+\/webhooks$/.test(path)) {
    return response(config, { ok: true, webhook_id: `wh_${Date.now()}` });
  }

  if (method === 'delete' && /\/api\/v1\/workflows\/[^/]+\/webhooks\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'get' && path === '/api/v1/workflow-templates') {
    return response(config, {
      ok: true,
      count: previewWorkflowTemplates.length,
      templates: previewWorkflowTemplates,
    });
  }

  if (method === 'post' && /\/api\/v1\/workflow-templates\/[^/]+\/use$/.test(path)) {
    const templateId = decodeURIComponent(path.split('/')[4] || '');
    const workflowId = `wf_${Date.now()}`;
    return response(config, { ok: true, workflow_id: workflowId, workflow_path: `/operations/workflows/${workflowId}/edit`, source_template_id: templateId });
  }

  // ── Tenant & tenant registry ──────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/tenant/concurrency-stats') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      plan_tier: 'pro',
      current: { concurrent_workflows: 0, concurrent_steps: 0 },
      limits: { max_concurrent_workflows: 10, max_concurrent_steps: 50, max_queue_depth: 20, workflow_per_minute: 60 },
      usage_pct: { workflows: 0, steps: 0 },
      queue_depth: 0,
    });
  }

  if (method === 'get' && path === '/api/v1/tenant/registry') {
    return response(config, {
      code: 0,
      data: {
        items: [
          {
            id: 'tenant_demo',
            name: '龙虾池示范店',
            quota: 10,
            inactive: false,
            industryType: 'food',
            industryCategoryTag: 'food_chinese_restaurant',
            businessKeywords: ['同城获客', '餐饮', '短视频'],
            leadScoringWords: { highIntent: ['价格', '地址', '预约'], painPoints: ['试试看', '先了解'] },
            nodeWorkflowProgress: { S1: true, S2: true, S3: false, S4: false, S5: false },
            deploymentRegion: 'cn-shanghai',
            storageRegion: 'cn-shanghai',
            dataResidency: 'cn-mainland',
            icpFilingStatus: 'ready',
            createdAt: nowIso(),
            updatedAt: nowIso(),
          },
        ],
      },
    });
  }

  if (method === 'post' && path === '/api/v1/tenant/registry') {
    return response(config, {
      code: 0,
      data: {
        id: `tenant_${Date.now()}`,
        name: String(body.name || '新租户'),
        quota: 5,
        inactive: false,
        businessKeywords: [],
        leadScoringWords: { highIntent: [], painPoints: [] },
        nodeWorkflowProgress: { S1: false, S2: false, S3: false, S4: false, S5: false },
        deploymentRegion: 'cn-shanghai',
        storageRegion: 'cn-shanghai',
        dataResidency: 'cn-mainland',
        icpFilingStatus: 'pending',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    });
  }

  if (method === 'patch' && /\/api\/v1\/tenant\/registry\/[^/]+$/.test(path)) {
    return response(config, {
      code: 0,
      data: { id: decodeURIComponent(path.split('/').pop() || ''), ...body, updatedAt: nowIso() },
    });
  }

  if (method === 'delete' && /\/api\/v1\/tenant\/registry\/[^/]+$/.test(path)) {
    return response(config, {
      code: 0,
      data: { id: decodeURIComponent(path.split('/').pop() || ''), archivedAt: nowIso() },
    });
  }

  if (method === 'get' && path === '/api/v1/tenant') {
    return response(config, { code: 0, data: { tenantId: 'tenant_demo', tenantName: '龙虾池示范店', plan: 'pro' } });
  }

  // ── Edge groups & node group map ─────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/fleet/groups') {
    return response(config, { code: 0, data: { tree: [] } });
  }

  if (method === 'get' && path === '/api/v1/fleet/node-group-map') {
    return response(config, { code: 0, data: {} });
  }

  if (method === 'get' && path === '/api/v1/ai/edge/groups/tree') {
    return response(config, {
      code: 0,
      data: [
        { group_id: 'group_demo_01', name: '主力节点组', node_ids: ['node_demo_01'] },
        { group_id: 'group_demo_02', name: '辅助节点组', node_ids: ['node_demo_02'] },
      ],
    });
  }

  if (method === 'get' && path === '/api/v1/ai/edge/groups/node-map') {
    return response(config, {
      code: 0,
      data: { node_demo_01: 'group_demo_01', node_demo_02: 'group_demo_02' },
    });
  }

  if (method === 'post' && path === '/api/v1/ai/edge/groups') {
    return response(config, { code: 0, data: { group_id: `group_${Date.now()}` } });
  }

  if (method === 'post' && /\/api\/v1\/fleet\/nodes\/[^/]+\/offline$/.test(path)) {
    return response(config, { code: 0, data: { ok: true } });
  }

  if (method === 'post' && path === '/api/v1/fleet/commands') {
    return response(config, { code: 0, data: { command_id: `cmd_${Date.now()}` } });
  }

  // ── Escalations & restore events ─────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/escalations') {
    return response(config, { ok: true, count: 0, items: [] });
  }

  if (method === 'post' && /\/api\/v1\/ai\/escalations\/[^/]+\/resolve$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'get' && path === '/api/v1/ai/restore-events') {
    return response(config, { ok: true, count: 0, items: [] });
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/heartbeat/active-check') {
    return response(config, { ok: true, healthy: true, last_check_at: nowIso() });
  }

  if (method === 'get' && path === '/api/v1/ai/heartbeat/active-check/history') {
    return response(config, { ok: true, items: [] });
  }

  // ── Commander suggested intents ───────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/commander/suggested-intents') {
    return response(config, {
      ok: true,
      intents: [
        { intent: '生成同城获客策略', confidence: 0.92 },
        { intent: '分析竞品爆款公式', confidence: 0.87 },
        { intent: '设置线索跟进提醒', confidence: 0.78 },
      ],
    });
  }

  // ── Competitive intel & CRM graph ────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/tenant/rag-brain-profiles/competitive-intel') {
    return response(config, {
      code: 0,
      data: previewCompetitiveFormulaLibrary,
    });
  }

  if (method === 'post' && path === '/api/v1/tenant/rag-brain-profiles/competitive-intel/analyze') {
    const nextFormula = {
      id: `formula_${Date.now()}`,
      category: '手动拆解',
      title: String(body.sample?.title || '手动拆解样本'),
      hook: String(body.sample?.hook || '新开场钩子'),
      tags: ['manual', String(body.source?.platform || 'other')],
      confidence: 0.88,
      extractedAt: nowIso(),
      source: {
        platform: String(body.source?.platform || 'other'),
        accountId: String(body.source?.accountId || `acct_manual_${Date.now()}`),
        accountName: String(body.source?.accountName || 'manual_input'),
        postUrl: String(body.source?.postUrl || 'https://example.com/post/manual'),
      },
    };
    previewCompetitiveFormulaLibrary.unshift(nextFormula);
    return response(config, {
      code: 0,
      data: { inserted: true, corpusId: `corpus_${Date.now()}`, formula: nextFormula },
    });
  }

  if (method === 'get' && /\/api\/v1\/graph\/[^/]+\/snapshot$/.test(path)) {
    return response(config, previewGraphSnapshot);
  }

  if (method === 'get' && /\/api\/v1\/graph\/[^/]+\/timeline$/.test(path)) {
    return response(config, previewGraphTimeline);
  }

  if (method === 'get' && path === '/api/v1/tenant/cockpit') {
    return response(config, previewTenantCockpit);
  }

  if (method === 'get' && path === '/api/v1/tenant/cockpit/capability-routes') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      total: previewCapabilityRoutes.length,
      items: previewCapabilityRoutes,
    });
  }

  if (method === 'get' && /\/api\/v1\/tenant\/cockpit\/capability-routes\/[^/]+$/.test(path)) {
    const auditId = decodeURIComponent(path.split('/').pop() || '');
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      item: previewCapabilityRoutes.find((item) => item.audit_id === auditId) || previewCapabilityRoutes[0],
    });
  }

  if (method === 'get' && path === '/api/v1/tenant/cockpit/platform-feedback') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      total: previewPlatformFeedback.length,
      items: previewPlatformFeedback,
    });
  }

  if (method === 'get' && /\/api\/v1\/tenant\/cockpit\/platform-feedback\/[^/]+$/.test(path)) {
    const feedbackId = decodeURIComponent(path.split('/').pop() || '');
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      item: previewPlatformFeedback.find((item) => item.feedback_id === feedbackId) || previewPlatformFeedback[0],
    });
  }

  if (method === 'get' && path === '/api/v1/tenant/cockpit/xhs-events') {
    return response(config, {
      code: 0,
      data: {
        items: [
          {
            eventId: 'xhs_evt_001',
            tenantId: 'tenant_demo',
            nodeId: 'edge_xhs_01',
            platform: 'xiaohongshu',
            accountId: 'xhs_brand_demo',
            eventType: 'comment_high_intent',
            createdAt: nowIso(),
            payload: {
              noteId: 'note_demo_001',
              author: '本地美妆用户A',
              content: '怎么买？有体验装吗？',
            },
          },
          {
            eventId: 'xhs_evt_002',
            tenantId: 'tenant_demo',
            nodeId: 'edge_xhs_01',
            platform: 'xiaohongshu',
            accountId: 'xhs_brand_demo',
            eventType: 'comment_risk',
            createdAt: nowIso(),
            payload: {
              noteId: 'note_demo_002',
              author: '本地美妆用户B',
              content: '这个是不是会闷痘？',
            },
          },
        ],
      },
    });
  }

  if (method === 'get' && path === '/api/v1/tenant/cockpit/xhs-events/summary') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      summary: {
        total_events: 2,
        high_intent_comment_count: 1,
        risk_comment_count: 1,
        unread_summary_present: true,
        new_connection_count: 1,
      },
      counts_by_type: {
        comment_high_intent: 1,
        comment_risk: 1,
      },
      high_intent_comments: [],
      risk_comments: [],
      latest_unread_summary: null,
      latest_likes_collects_summary: null,
      latest_new_connections: [],
    });
  }

  if (method === 'get' && path === '/api/v1/tenant/cockpit/xhs-events/echoer-feed') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      role: 'echoer',
      total: 1,
      items: [
        {
          id: 'echoer_feed_001',
          role: 'echoer',
          source_event_id: 'xhs_evt_001',
          event_type: 'comment_high_intent',
          account_id: 'xhs_brand_demo',
          node_id: 'edge_xhs_01',
          created_at: nowIso(),
          priority: 'high',
          route_hint: 'echoer',
          reason: '评论里出现“怎么买、体验装”等高意向词。',
          suggested_action: '先回复购买路径，再引导进入私信。',
          content: '怎么买？有体验装吗？',
          author_name: '本地美妆用户A',
          note_id: 'note_demo_001',
          source_url: 'https://www.xiaohongshu.com/explore/demo-001',
          lead_intent: 'high',
          risk_level: 'low',
          payload: {},
        },
      ],
    });
  }

  if (method === 'get' && path === '/api/v1/tenant/cockpit/xhs-events/catcher-feed') {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      role: 'catcher',
      total: 1,
      items: [
        {
          id: 'catcher_feed_001',
          role: 'catcher',
          source_event_id: 'xhs_evt_002',
          event_type: 'comment_risk',
          account_id: 'xhs_brand_demo',
          node_id: 'edge_xhs_01',
          created_at: nowIso(),
          priority: 'medium',
          route_hint: 'catcher',
          reason: '评论里出现闷痘、风险体验等敏感信号。',
          suggested_action: '先筛查风险，再决定是否转 Followup。',
          content: '这个是不是会闷痘？',
          author_name: '本地美妆用户B',
          note_id: 'note_demo_002',
          source_url: 'https://www.xiaohongshu.com/explore/demo-002',
          lead_intent: 'medium',
          risk_level: 'medium',
          payload: {},
        },
      ],
    });
  }

  // ── Usecases ──────────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/usecases') {
    return response(config, { ok: true, usecases: previewUsecases, count: previewUsecases.length });
  }

  if (method === 'get' && path === '/api/v1/ai/usecases/categories') {
    return response(config, {
      ok: true,
      categories: [
        { category: 'lead_gen', count: 1 },
        { category: 'competitive_intel', count: 1 },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/usecases\/[^/]+$/.test(path)) {
    const usecaseId = decodeURIComponent(path.split('/').pop() || '');
    return response(config, {
      ok: true,
      usecase: previewUsecases.find((item) => item.id === usecaseId) || previewUsecases[0],
    });
  }

  // ── Artifacts ─────────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/artifacts/index') {
    return response(config, { ok: true, count: 0, artifacts: [] });
  }

  if (method === 'get' && /\/api\/v1\/ai\/artifacts\/job\/[^/]+$/.test(path)) {
    return response(config, { ok: true, artifacts: [] });
  }

  if (method === 'get' && /\/api\/v1\/ai\/artifacts\/mission\/[^/]+$/.test(path)) {
    return response(config, { ok: true, artifacts: [] });
  }

  // ── Widget config ─────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/widget/config') {
    return response(config, { ok: true, config: previewWidgetConfig });
  }

  if (method === 'put' && path === '/api/v1/widget/config') {
    previewWidgetConfig = {
      ...previewWidgetConfig,
      tenant_id: String(body.tenant_id || previewWidgetConfig.tenant_id),
      allowed_origins: Array.isArray(body.allowed_domains) ? body.allowed_domains.map((item) => String(item)) : previewWidgetConfig.allowed_origins,
      welcome_message: body.welcome_message ? String(body.welcome_message) : previewWidgetConfig.welcome_message,
      theme_primary: body.theme_color ? String(body.theme_color) : previewWidgetConfig.theme_primary,
      accent_color: body.accent_color ? String(body.accent_color) : previewWidgetConfig.accent_color,
      custom_css: body.custom_css ? String(body.custom_css) : previewWidgetConfig.custom_css,
      call_to_action: body.call_to_action ? String(body.call_to_action) : previewWidgetConfig.call_to_action,
      launcher_label: body.launcher_label ? String(body.launcher_label) : previewWidgetConfig.launcher_label,
      auto_open: typeof body.auto_open === 'boolean' ? body.auto_open : previewWidgetConfig.auto_open,
      launcher_position:
        body.launcher_position === 'top-right' || body.launcher_position === 'bottom-right'
          ? body.launcher_position
          : previewWidgetConfig.launcher_position,
      updated_at: nowIso(),
    };
    return response(config, { ok: true, config: previewWidgetConfig });
  }

  // ── Feature flags ─────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/feature-flags') {
    return response(config, { ok: true, flags: [] });
  }

  if (method === 'get' && path === '/api/v1/feature-flags/changelog') {
    return response(config, { ok: true, changes: [] });
  }

  // ── RBAC / permissions ────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/rbac/permissions') {
    return response(config, { ok: true, tenant_id: 'tenant_demo', permissions: previewRbacPermissions });
  }

  if (method === 'get' && path === '/api/v1/rbac/matrix') {
    return response(config, {
      ok: true,
      matrix: {
        admin: { workflow: ['read', 'write', 'execute', 'admin'] },
        operator: { workflow: ['read', 'execute'], leads: ['read', 'write'] },
        viewer: { workflow: ['read'] },
      },
      roles: previewRbacRoles,
    });
  }

  if (method === 'get' && /\/api\/v1\/rbac\/users\/[^/]+\/permissions$/.test(path)) {
    return response(config, { ok: true, tenant_id: 'tenant_demo', user_id: decodeURIComponent(path.split('/')[5] || ''), permissions: previewRbacPermissions });
  }

  if (method === 'post' && path === '/api/v1/rbac/check') {
    return response(config, { ok: true, allowed: true, matched_rule: previewRbacPermissions[0], reason: 'preview_allow' });
  }

  // ── Audit events ─────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/audit/event-types') {
    return response(config, { ok: true, items: previewAuditEventTypes });
  }

  if (method === 'get' && path === '/api/v1/audit/events') {
    return response(config, { ok: true, tenant_id: 'tenant_demo', items: previewAuditEvents, data: previewAuditEvents, total: previewAuditEvents.length, page: 1, page_size: 50, total_pages: 1 });
  }

  if (method === 'post' && path === '/api/v1/audit/cleanup') {
    return response(config, { ok: true, tenant_id: 'tenant_demo', result: { archived: 0, deleted: 0 } });
  }

  // ── Experiments & prompt experiments ─────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/experiments') {
    return response(config, { ok: true, experiments: [] });
  }

  if (method === 'get' && path === '/api/v1/prompt-experiments') {
    return response(config, { ok: true, experiments: [] });
  }

  // ── Search ────────────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/search') {
    return response(config, {
      ok: true,
      query: String(config.params?.q || ''),
      lobsters: [{ display_name: '脑虫虾', description: '策略规划', href: '/lobsters/strategist' }],
      workflows: [{ name: '同城短视频获客', description: '增长主流程', href: '/operations/workflows' }],
      channels: [{ account_name: '抖音演示账号 A', platform: 'douyin', status: 'enabled', href: '/operations/channels' }],
      audits: [{ title: '审批链路触发', description: '高风险动作进入审批', href: '/settings/audit' }],
      tenants: [{ name: '龙虾池示范店', plan: 'pro', href: '/settings/tenants' }],
    });
  }

  // ── Knowledge bases ───────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/knowledge-bases') {
    return response(config, { ok: true, count: 0, items: [] });
  }

  if (method === 'post' && path === '/api/v1/knowledge-bases') {
    return response(config, { ok: true, kb_id: `kb_${Date.now()}` });
  }

  // ── Activities ────────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/activities') {
    return response(config, { ok: true, count: 0, items: [] });
  }

  // ── White label ───────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/white-label/resolve') {
    return response(config, { ok: true, config: null });
  }

  // ── Alert rules & channels ────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/alerts/rules') {
    return response(config, { ok: true, rules: [] });
  }

  if (method === 'get' && path === '/api/v1/alerts/channels') {
    return response(config, { ok: true, channels: [] });
  }

  if (method === 'get' && path === '/api/v1/alerts/events') {
    return response(config, { ok: true, events: [] });
  }

  // ── Observability ─────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/observability/event-bus/subjects') {
    return response(config, {
      ok: true,
      subjects: [
        {
          subject: 'task.tenant_main.content-campaign-14step.step.step_10_edge_dispatch.completed',
          total_count: 42,
          count_last_minute: 2,
          count_last_hour: 12,
          rate_per_min: 2,
          last_published_at: Math.floor(Date.now() / 1000),
        },
        {
          subject: 'activity.tenant_main.lobster_executed',
          total_count: 18,
          count_last_minute: 1,
          count_last_hour: 6,
          rate_per_min: 1,
          last_published_at: Math.floor(Date.now() / 1000) - 90,
        },
      ],
    });
  }

  if (method === 'get' && path === '/api/observability/event-bus/prefix-summary') {
    return response(config, {
      ok: true,
      prefixes: [
        {
          prefix: 'task.tenant_main.content-campaign-14step',
          total_count: 42,
          count_last_minute: 2,
          count_last_hour: 12,
          subjects: [],
        },
        {
          prefix: 'activity.tenant_main',
          total_count: 18,
          count_last_minute: 1,
          count_last_hour: 6,
          subjects: [],
        },
      ],
    });
  }

  if (method === 'get' && path === '/api/observability/traces') {
    return response(config, {
      total: 2,
      traces: [
        { trace_id: 'obs_trace_001', workflow_name: 'content-campaign-14step', status: 'completed', total_tokens: 12400, spans: [{ span_id: 'sp_dispatch', lobster: 'dispatcher', latency_ms: 312 }] },
        { trace_id: 'obs_trace_002', workflow_name: 'lead-followup', status: 'running', total_tokens: 6800, spans: [{ span_id: 'sp_followup', lobster: 'followup', latency_ms: 198 }] },
      ],
    });
  }

  if (method === 'get' && /\/api\/observability\/traces\/[^/]+$/.test(path)) {
    return response(config, {
      trace_id: path.split('/').pop(),
      tenant_id: 'tenant_main',
      workflow_name: 'content-campaign-14step',
      status: 'completed',
      started_at: nowIso(),
      spans: [
        {
          span_id: 'sp_dispatch',
          lobster: 'dispatcher',
          latency_ms: 312,
          generations: [
            {
              gen_id: 'gen_dispatch_1',
              model: 'qwen-plus',
              provider: 'dashscope',
              prompt_tokens: 320,
              completion_tokens: 120,
              latency_ms: 312,
            },
          ],
        },
      ],
      activities: [
        {
          activity_id: 'act_orla_1',
          tenant_id: 'tenant_main',
          trace_id: path.split('/').pop(),
          activity_type: 'lobster_executed',
          actor_type: 'lobster',
          actor_id: 'dispatcher',
          details: {
            orla_enabled: true,
            orla_stage_id: 'dispatch_plan',
            orla_applied_tier: 'pro',
            orla_reason: 'stage_contract',
            orla_promotion_trigger: 'queue_conflict',
            orla_shared_state_hit: true,
          },
          created_at: nowIso(),
        },
      ],
      dispatcher_orla: {
        event_count: 1,
        latest: { activity_id: 'act_orla_1' },
        events: [
          {
            activity_id: 'act_orla_1',
            actor_id: 'dispatcher',
            created_at: nowIso(),
            details: {
              orla_enabled: true,
              orla_stage_id: 'dispatch_plan',
              orla_applied_tier: 'pro',
              orla_reason: 'stage_contract',
              orla_promotion_trigger: 'queue_conflict',
              orla_shared_state_hit: true,
            },
          },
        ],
        stages: [
          {
            stage_id: 'dispatch_plan',
            applied_tier: 'pro',
            reason: 'stage_contract',
            promotion_trigger: 'queue_conflict',
            shared_state_hit: true,
            created_at: nowIso(),
          },
        ],
      },
    });
  }

  if (method === 'get' && path === '/api/observability/dashboard') {
    return response(config, {
      tenant_id: 'tenant_main',
      days: Number(config.params?.days || 30),
      total_cost_usd: 12.34,
      total_tokens: 456789,
      total_calls: 128,
      avg_latency_ms: 812,
      by_model: [],
      by_lobster: [],
      daily_trend: [],
      orla_dispatcher: {
        tenant_id: 'tenant_main',
        days: Number(config.params?.days || 30),
        dispatcher_total: 14,
        orla_enabled_total: 9,
        success_count: 8,
        shared_state_hit_rate: 0.6667,
        by_stage: { dispatch_plan: 7, dispatch_exception_reasoning: 2 },
        by_tier: { standard: 4, pro: 4, frontier: 1 },
        promotion_triggers: { queue_conflict: 2, edge_retry_exhausted: 1 },
        latest: { activity_id: 'act_orla_1' },
      },
    });
  }

  if (method === 'get' && path === '/api/observability/orla/dispatcher') {
    return response(config, {
      ok: true,
      orla_dispatcher: {
        tenant_id: 'tenant_main',
        days: Number(config.params?.days || 30),
        dispatcher_total: 14,
        orla_enabled_total: 9,
        success_count: 8,
        shared_state_hit_rate: 0.6667,
        by_stage: { dispatch_plan: 7, dispatch_exception_reasoning: 2 },
        by_tier: { standard: 4, pro: 4, frontier: 1 },
        promotion_triggers: { queue_conflict: 2, edge_retry_exhausted: 1 },
        latest: { activity_id: 'act_orla_1' },
      },
    });
  }

  if (method === 'get' && path === '/api/observability/chart/annotations') {
    return response(config, { ok: true, annotations: [] });
  }

  // ── Execution monitor snapshot ────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/execution-monitor/snapshot') {
    return response(config, {
      ok: true,
      tenant_id: String(config.params?.tenant_id || 'tenant_main'),
      nodes: previewFleetNodes.map((node, index) => ({
        node_id: node.nodeId,
        tenant_id: node.tenantId,
        client_name: node.clientName,
        region: Array.isArray(node.platforms) ? node.platforms.join(',') : undefined,
        status: node.status,
        load_percent: Math.max(Number(node.cpuPercent || 0), Number(node.memoryPercent || 0)),
        running_task_id: index === 1 ? 'task_demo_002' : 'task_demo_001',
        last_seen_at: node.lastPingAt,
      })),
      recent_logs: [
        {
          event_id: 'fleetlog_task_demo_002',
          task_id: 'task_demo_002',
          node_id: 'node_demo_02',
          level: 'warn',
          stage: 'edge_publish_dispatch',
          message: '边缘节点正在处理发布窗口检查。',
          created_at: nowIso(),
        },
        {
          event_id: 'fleetlog_task_demo_001',
          task_id: 'task_demo_001',
          node_id: 'node_demo_01',
          level: 'info',
          stage: 'cloud_archive',
          message: '云端归档完成，等待后续信号。',
          created_at: nowIso(),
        },
      ],
      runtime_foreground: [
        {
          task_id: 'run_demo_dispatcher_01',
          lobster_id: 'dispatcher',
          description: '发布账号 A 的早间内容包',
          status: 'running',
          mode: 'foreground',
          elapsed_sec: 8.4,
          is_backgrounded: false,
        },
        {
          task_id: 'run_demo_radar_01',
          lobster_id: 'radar',
          description: '扫描今日行业热点与竞品动态',
          status: 'backgrounded',
          mode: 'background',
          elapsed_sec: 35.2,
          is_backgrounded: true,
        },
      ],
      recent_task_notifications: [
        {
          activity_id: 'act_tasknotif_001',
          task_id: 'run_demo_visualizer_01',
          lobster_id: 'visualizer',
          status: 'completed',
          mode: 'background',
          summary: '封面与分镜生成完成',
          total_tokens: 1860,
          tool_uses: 4,
          duration_ms: 18220,
          created_at: nowIso(),
        },
        {
          activity_id: 'act_tasknotif_002',
          task_id: 'run_demo_echoer_01',
          lobster_id: 'echoer',
          status: 'failed',
          mode: 'background',
          summary: '评论承接任务失败：渠道回复超时',
          total_tokens: 420,
          tool_uses: 2,
          duration_ms: 6430,
          created_at: nowIso(),
        },
      ],
      recent_edge_snapshots: [
        {
          snapshot_id: 'snap_edge_001',
          node_id: 'node_demo_01',
          task_id: 'task_demo_001',
          status: 'failed',
          duration_ms: 2210,
          blocked_steps: 1,
          needs_approval_steps: 1,
          checked_steps: 3,
          created_at: nowIso(),
        },
        {
          snapshot_id: 'snap_edge_002',
          node_id: 'node_demo_02',
          task_id: 'task_demo_002',
          status: 'success',
          duration_ms: 1830,
          blocked_steps: 0,
          needs_approval_steps: 0,
          checked_steps: 2,
          created_at: nowIso(),
        },
      ],
    });
  }

  // ── CRM lead conversion ───────────────────────────────────────────────────

  if (method === 'get' && /\/api\/v1\/leads\/[^/]+\/[^/]+\/conversion-status$/.test(path)) {
    const parts = path.split('/');
    const tenantId = parts[4] || 'tenant_demo';
    const leadId = parts[5] || 'lead_demo_001';
    return response(config, {
      status: 'ok',
      data: {
        tenant_id: tenantId,
        lead_id: leadId,
        status: 'considering',
        confidence: 0.88,
        trigger: '用户主动询价并询问到店方式',
        triggered_by: 'catcher',
        evidence: '用户连续两次追问价格和地址，且点击了地图卡片。',
        updated_at: nowIso(),
      },
    });
  }

  if (method === 'get' && /\/api\/v1\/leads\/[^/]+\/[^/]+\/conversion-history$/.test(path)) {
    const parts = path.split('/');
    const tenantId = parts[4] || 'tenant_demo';
    const leadId = parts[5] || 'lead_demo_001';
    return response(config, {
      status: 'ok',
      data: [
        {
          transition_id: 'conv_001',
          tenant_id: tenantId,
          lead_id: leadId,
          from_status: 'aware',
          to_status: 'interested',
          trigger: '首次私信咨询',
          confidence: 0.62,
          triggered_by: 'echoer',
          evidence: '用户主动发起咨询并回复了产品场景问题。',
          transitioned_at: nowIso(),
        },
        {
          transition_id: 'conv_002',
          tenant_id: tenantId,
          lead_id: leadId,
          from_status: 'interested',
          to_status: 'considering',
          trigger: '意向评分提升',
          confidence: 0.88,
          triggered_by: 'catcher',
          evidence: '用户追问价格、地址和到店方式，出现明显成交信号。',
          transitioned_at: nowIso(),
        },
        {
          transition_id: 'conv_003',
          tenant_id: tenantId,
          lead_id: leadId,
          from_status: 'considering',
          to_status: 'decided',
          trigger: '分配销售跟进',
          confidence: 0.93,
          triggered_by: 'followup',
          evidence: '已确认时间窗口并安排销售回访。',
          transitioned_at: nowIso(),
        },
      ],
    });
  }

  // ── Temporal graph (CRM graph) ────────────────────────────────────────────

  if (method === 'get' && /\/api\/v1\/graph\/[^/]+\/snapshot$/.test(path)) {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      nodes: [
        { id: 'lead_001', type: 'lead', label: '高意向客户 A', properties: { intent_score: 96 } },
        { id: 'campaign_001', type: 'campaign', label: '同城获客任务', properties: { status: 'RUNNING' } },
        { id: 'agent_catcher', type: 'agent', label: '铁网虾', properties: {} },
      ],
      edges: [
        { source: 'campaign_001', target: 'lead_001', relation: 'captured' },
        { source: 'agent_catcher', target: 'lead_001', relation: 'scored' },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/graph\/[^/]+\/timeline$/.test(path)) {
    return response(config, {
      ok: true,
      tenant_id: 'tenant_demo',
      events: [
        { ts: nowIso(), entity: 'lead_001', action: 'created', actor: 'catcher' },
        { ts: nowIso(), entity: 'lead_001', action: 'scored', actor: 'abacus' },
      ],
    });
  }

  // ── Admin control panel ───────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/ai/admin/resources') {
    return response(config, {
      ok: true,
      resources: [
        { name: 'lobsters',        label: '龙虾 (Lobsters)',         operations: ['list', 'get', 'edit'] },
        { name: 'accounts',        label: '账号 (Accounts)',         operations: ['list', 'get', 'create', 'edit', 'delete'] },
        { name: 'sop-templates',   label: 'SOP 模板',                operations: ['list', 'get', 'create', 'edit', 'delete'] },
        { name: 'tenants',         label: '租户 (Tenants)',          operations: ['list', 'get', 'create', 'edit', 'delete'] },
        { name: 'workflows',       label: '工作流 (Workflows)',      operations: ['list', 'get', 'edit'] },
        { name: 'scheduler_tasks', label: '调度任务 (Scheduler)',    operations: ['list', 'get'] },
        { name: 'policies',        label: '策略 (Policies)',         operations: ['list', 'get'] },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/admin\/[^/]+$/.test(path) && !path.includes('/admin/resources')) {
    const resource = path.split('/admin/')[1]?.split('/')[0];
    return response(config, { ok: true, resource, items: [], total: 0 });
  }

  if (method === 'post' && /\/api\/v1\/ai\/admin\/[^/]+$/.test(path)) {
    return response(config, { ok: true, id: `admin_${Date.now()}` });
  }

  if (method === 'put' && /\/api\/v1\/ai\/admin\/[^/]+\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'delete' && /\/api\/v1\/ai\/admin\/[^/]+\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  // ── Policy engine ─────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/policies') {
    return response(config, {
      ok: true,
      count: 2,
      policies: [
        { rule_id: 'policy_001', name: '高风险动作需要审批', condition: 'risk >= P1', action: 'require_approval', enabled: true, created_at: nowIso() },
        { rule_id: 'policy_002', name: '禁止夜间 DLQ 回放', condition: 'hour >= 23 OR hour <= 6', action: 'block', enabled: true, created_at: nowIso() },
      ],
    });
  }

  if (method === 'post' && path === '/api/v1/policies') {
    return response(config, { ok: true, rule_id: `policy_${Date.now()}` });
  }

  if (method === 'put' && /\/api\/v1\/policies\/[^/]+$/.test(path) && !path.includes('/bundle') && !path.includes('/evaluate')) {
    return response(config, { ok: true });
  }

  if (method === 'delete' && /\/api\/v1\/policies\/[^/]+$/.test(path) && !path.includes('/bundle')) {
    return response(config, { ok: true });
  }

  if (method === 'post' && path === '/api/v1/policies/evaluate') {
    return response(config, { ok: true, result: 'allowed', matched_rules: [] });
  }

  if (method === 'get' && path === '/api/v1/policies/bundle/current') {
    return response(config, {
      ok: true,
      bundle: { version: 'v1', published_at: nowIso(), policy_count: 2, active: true },
    });
  }

  if (method === 'post' && path === '/api/v1/policies/bundle/publish') {
    return response(config, { ok: true, version: `v${Date.now()}` });
  }

  // ── Prompt registry ───────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/prompts') {
    return response(config, {
      ok: true,
      prompts: [
        { name: 'strategy_planning_v1', lobster: 'strategist', version: 'v3', updated_at: nowIso() },
        { name: 'content_generation_v1', lobster: 'inkwriter', version: 'v2', updated_at: nowIso() },
        { name: 'intent_classification_v1', lobster: 'catcher', version: 'v4', updated_at: nowIso() },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/prompts\/[^/]+\/versions$/.test(path)) {
    const promptName = decodeURIComponent(path.split('/prompts/')[1]?.replace('/versions', '') || '');
    return response(config, {
      ok: true,
      prompt_name: promptName,
      versions: [
        { version: 'v4', published_at: nowIso(), author: 'demo_admin', is_current: true },
        { version: 'v3', published_at: nowIso(), author: 'demo_admin', is_current: false },
        { version: 'v2', published_at: nowIso(), author: 'system', is_current: false },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/ai\/prompts\/[^/]+\/diff$/.test(path)) {
    return response(config, {
      ok: true,
      diff: [
        { type: 'removed', content: '旧版提示词行' },
        { type: 'added', content: '新版提示词行' },
      ],
    });
  }

  // ── Kanban tasks ──────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/tasks/kanban') {
    return response(config, {
      ok: true,
      columns: {
        todo: [
          { task_id: 'kanban_001', title: '分析本周竞品爆款', assignee: 'radar', priority: 'high', created_at: nowIso() },
        ],
        in_progress: [
          { task_id: 'kanban_002', title: '同城获客内容生产', assignee: 'inkwriter', priority: 'high', created_at: nowIso() },
          { task_id: 'kanban_003', title: '高意向线索跟进', assignee: 'followup', priority: 'medium', created_at: nowIso() },
        ],
        done: [
          { task_id: 'kanban_004', title: '策略规划完成', assignee: 'strategist', priority: 'high', created_at: nowIso() },
        ],
      },
    });
  }

  // ── Experiments ───────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/prompt-experiments') {
    return response(config, { ok: true, experiments: [] });
  }

  if (method === 'post' && path === '/api/v1/prompt-experiments') {
    return response(config, { ok: true, flag_name: `exp_${Date.now()}` });
  }

  if (method === 'get' && /\/api\/v1\/prompt-experiments\/[^/]+\/report$/.test(path)) {
    return response(config, { ok: true, report: { winner: null, significance: 0 } });
  }

  if (method === 'post' && /\/api\/v1\/prompt-experiments\/[^/]+\/promote$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'post' && /\/api\/v1\/prompt-experiments\/[^/]+\/stop$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'get' && path === '/api/v1/ai/experiments/compare') {
    return response(config, { ok: true, comparison: {} });
  }

  // ── Feature flags (extended) ──────────────────────────────────────────────

  if (method === 'post' && path === '/api/v1/feature-flags') {
    return response(config, { ok: true, name: String(body.name || `flag_${Date.now()}`) });
  }

  if (method === 'put' && /\/api\/v1\/feature-flags\/[^/]+$/.test(path) && !path.includes('/enable') && !path.includes('/disable') && !path.includes('/strategies') && !path.includes('/variants')) {
    return response(config, { ok: true });
  }

  if (method === 'post' && /\/api\/v1\/feature-flags\/[^/]+\/enable$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'post' && /\/api\/v1\/feature-flags\/[^/]+\/disable$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'post' && /\/api\/v1\/feature-flags\/[^/]+\/strategies$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'post' && /\/api\/v1\/feature-flags\/[^/]+\/variants$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'delete' && /\/api\/v1\/feature-flags\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'post' && path === '/api/v1/feature-flags/check') {
    return response(config, { ok: true, enabled: true, variant: null });
  }

  if (method === 'post' && path === '/api/v1/feature-flags/export') {
    return response(config, { ok: true, flags: [] });
  }

  if (method === 'post' && path === '/api/v1/feature-flags/import') {
    return response(config, { ok: true, imported: 0 });
  }

  // ── Widget script ─────────────────────────────────────────────────────────

  if (method === 'get' && /\/api\/v1\/widget\/script\/[^/]+$/.test(path)) {
    const widgetId = path.split('/').pop();
    return response(config, {
      ok: true,
      script: {
        widgetId: String(widgetId || 'widget_demo'),
        script: `window.__OPENCLAW_WIDGET__ = { widgetId: '${String(widgetId || 'widget_demo')}' };`,
        language: 'zh-CN',
        updatedAt: nowIso(),
      },
    });
  }

  // ── Feedbacks ─────────────────────────────────────────────────────────────

  if (method === 'post' && path === '/api/v1/feedbacks') {
    const feedbackId = `fb_${Date.now()}`;
    const hasRevision = Boolean(String(body.revised_output || '').trim());
    return response(config, {
      ok: true,
      feedback_id: feedbackId,
      status: 'accepted',
      skill_improvement_signal: hasRevision ? {
        created: true,
        reason: 'created',
        resolved_skill_id: String(body.skill_id || `${String(body.lobster_id || 'inkwriter')}_skill_1`),
        proposal: { proposal_id: `sip_feedback_${Date.now()}`, status: 'scanned' },
      } : null,
    });
  }

  if (method === 'get' && /\/api\/v1\/feedbacks\/[^/]+$/.test(path)) {
    return response(config, { ok: true, feedback: null });
  }

  // ── Knowledge base extended ───────────────────────────────────────────────

  if (method === 'get' && /\/api\/v1\/knowledge-bases\/[^/]+$/.test(path) && !path.includes('/search') && !path.includes('/documents')) {
    return response(config, {
      ok: true,
      kb: { kb_id: path.split('/').pop(), name: '演示知识库', document_count: 2, created_at: nowIso() },
    });
  }

  if (method === 'get' && /\/api\/v1\/knowledge-bases\/[^/]+\/search$/.test(path)) {
    return response(config, { ok: true, results: [] });
  }

  if (method === 'post' && /\/api\/v1\/knowledge-bases\/[^/]+\/documents$/.test(path)) {
    return response(config, { ok: true, doc_id: `doc_${Date.now()}` });
  }

  if (method === 'post' && /\/api\/v1\/knowledge-bases\/[^/]+\/bind\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  // ── Security / white-label ────────────────────────────────────────────────

  if (method === 'get' && /\/api\/v1\/white-label\/[^/]+$/.test(path) && !path.endsWith('/preview')) {
    return response(config, { ok: true, config: null });
  }

  if (method === 'get' && /\/api\/v1\/white-label\/[^/]+\/preview$/.test(path)) {
    return response(config, { ok: true, preview: null });
  }

  if (method === 'put' && /\/api\/v1\/white-label\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'delete' && /\/api\/v1\/white-label\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'post' && /\/api\/v1\/white-label\/[^/]+\/logo$/.test(path)) {
    return response(config, { ok: true, logo_url: 'https://demo.openclaw.ai/logo.png' });
  }

  // ── RBAC create/delete ────────────────────────────────────────────────────

  if (method === 'post' && path === '/api/v1/rbac/permissions') {
    return response(config, { ok: true, permission_id: `perm_${Date.now()}` });
  }

  if (method === 'delete' && /\/api\/v1\/rbac\/permissions\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  // ── Alert rules create/update ─────────────────────────────────────────────

  if (method === 'post' && path === '/api/v1/alerts/rules') {
    return response(config, { ok: true, rule_id: `rule_${Date.now()}` });
  }

  if (method === 'put' && /\/api\/v1\/alerts\/rules\/[^/]+$/.test(path)) {
    return response(config, { ok: true });
  }

  if (method === 'post' && path === '/api/v1/alerts/evaluate') {
    return response(config, { ok: true, fired: [] });
  }

  if (method === 'post' && path === '/api/v1/alerts/channels') {
    return response(config, { ok: true, channel_id: `ch_${Date.now()}` });
  }

  // ── Lobster runs & stats ──────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/lobsters/runs') {
    return response(config, { ok: true, tenant_id: 'tenant_demo', items: [], data: [], total: 0, page: 1, page_size: 20, total_pages: 1 });
  }

  if (method === 'get' && /\/api\/v1\/lobsters\/[^/]+\/runs$/.test(path)) {
    return response(config, { ok: true, items: [], data: [], total: 0, page: 1, page_size: 20, total_pages: 1 });
  }

  if (method === 'get' && /\/api\/v1\/lobsters\/[^/]+\/stats$/.test(path)) {
    return response(config, { ok: true, stats: { weekly_runs: 12, avg_quality_score: 8.4, p95_latency_ms: 620, active_edge_nodes: 2 } });
  }

  if (method === 'get' && /\/api\/v1\/lobsters\/[^/]+\/docs$/.test(path)) {
    return response(config, { ok: true, lobster_id: decodeURIComponent(path.split('/')[4] || ''), path: '/docs/lobster.md', content: '# 演示知识\n\n这里是龙虾知识内容示例。' });
  }

  if (method === 'get' && /\/api\/v1\/lobsters\/[^/]+\/skills$/.test(path)) {
    return response(config, { ok: true, items: [{ id: 'skill_demo_001', name: '基础技能', category: 'demo', effectiveness_rating: 8.1, enabled: true, gotchas: ['需要人工复核价格承诺'] }] });
  }

  if (method === 'get' && /\/api\/v1\/lobsters\/[^/]+$/.test(path) && !path.includes('/lifecycle') && !path.includes('/runs') && !path.includes('/stats') && !path.includes('/docs') && !path.includes('/skills') && !path.includes('/execute')) {
    const lobsterId = path.split('/lobsters/')[1];
    return response(config, {
      ok: true,
      lobster: {
        id: lobsterId,
        lobster_id: lobsterId,
        name: lobsterId,
        display_name: lobsterId,
        zh_name: lobsterId,
        status: 'active',
        lifecycle: 'production',
        description: '演示龙虾实体',
        created_at: nowIso(),
      },
      recent_runs: [],
      hourly_usage: [],
    });
  }

  if (method === 'post' && /\/api\/v1\/lobsters\/[^/]+\/execute$/.test(path)) {
    return response(config, { ok: true, run_id: `run_${Date.now()}`, status: 'running' });
  }

  if (method === 'get' && /\/api\/v1\/ai\/metrics\/lobster\/[^/]+\/history$/.test(path)) {
    return response(config, { ok: true, history: [] });
  }

  // ── Cost ─────────────────────────────────────────────────────────────────

  if (method === 'get' && path === '/api/v1/cost/lobsters') {
    return response(config, {
      ok: true,
      lobsters: [
        { lobster_id: 'strategist', total_cost_cny: 28.4, run_count: 18, avg_cost_per_run: 1.58 },
        { lobster_id: 'inkwriter', total_cost_cny: 19.5, run_count: 27, avg_cost_per_run: 0.72 },
        { lobster_id: 'catcher', total_cost_cny: 13.1, run_count: 14, avg_cost_per_run: 0.94 },
      ],
    });
  }

  if (method === 'get' && /\/api\/v1\/cost\/lobsters\/[^/]+$/.test(path) && !path.endsWith('/timeseries')) {
    const lobsterId = path.split('/').pop();
    return response(config, {
      ok: true,
      lobster_id: lobsterId,
      total_cost_cny: 28.4,
      run_count: 18,
      avg_cost_per_run: 1.58,
      period_days: 30,
    });
  }

  if (method === 'get' && /\/api\/v1\/cost\/lobsters\/[^/]+\/timeseries$/.test(path)) {
    return response(config, {
      ok: true,
      timeseries: Array.from({ length: 7 }).map((_, i) => ({
        date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
        cost_cny: Number((Math.random() * 5 + 1).toFixed(2)),
        run_count: Math.floor(Math.random() * 8 + 2),
      })),
    });
  }

  // ── Lobster quality stats & partner portal ────────────────────────────────

  if (method === 'get' && /\/api\/v1\/lobsters\/[^/]+\/quality-stats$/.test(path)) {
    return response(config, {
      ok: true,
      stats: {
        lobster_id: path.split('/lobsters/')[1]?.replace('/quality-stats', ''),
        avg_output_quality: 0.82,
        hallucination_rate: 0.04,
        task_completion_rate: 0.91,
        avg_user_satisfaction: 4.2,
        period_days: 30,
        sample_count: 48,
      },
    });
  }

  if (method === 'get' && path === '/api/v1/ai/partner/dashboard') {
    return response(config, {
      ok: true,
      dashboard: previewPartnerDashboard,
    });
  }

  if (method === 'get' && path === '/api/v1/ai/partner/seats') {
    return response(config, {
      ok: true,
      items: previewPartnerSeats,
    });
  }

  if (method === 'post' && path === '/api/v1/ai/partner/seats/assign') {
    return response(config, { ok: true, seat: { seat_id: `seat_${Date.now()}` } });
  }

  if (method === 'get' && path === '/api/v1/ai/partner/sub-agents/tree') {
    return response(config, {
      ok: true,
      tree: {
        agent: { agent_id: 'partner_demo', company_name: '龙虾池代理商示范' },
        children: [
          { sub_agent_id: 'sub_001', parent_agent_id: 'partner_demo', company_name: '子代理商 A', contact_name: '张三', region: '华东', allocated_seats: 4, status: 'active' },
          { sub_agent_id: 'sub_002', parent_agent_id: 'partner_demo', company_name: '子代理商 B', contact_name: '李四', region: '华南', allocated_seats: 4, status: 'active' },
        ],
      },
    });
  }

  if (method === 'post' && path === '/api/v1/ai/partner/sub-agents') {
    return response(config, { ok: true, sub_agent: { sub_agent_id: `sub_${Date.now()}`, ...body } });
  }

  if (method === 'get' && path === '/api/v1/ai/partner/statements') {
    return response(config, {
      ok: true,
      items: previewPartnerStatements,
    });
  }

  if (method === 'post' && path === '/api/v1/ai/partner/statements/confirm') {
    return response(config, { ok: true, statement: { status: 'confirmed' } });
  }

  if (method === 'post' && path === '/api/v1/ai/partner/statements/dispute') {
    return response(config, { ok: true, statement: { status: 'disputed' } });
  }

  if (method === 'put' && path === '/api/v1/ai/partner/white-label') {
    return response(config, { ok: true, config: body });
  }

  return null;
}
