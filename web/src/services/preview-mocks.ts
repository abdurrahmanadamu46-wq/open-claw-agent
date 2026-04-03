import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { TenantIntegrations } from '@/types/integrations';

type MockResponse = AxiosResponse;

const PREVIEW_PORTS = new Set(['3000', '3001', '3002', '3003', '3005']);

function nowIso() {
  return new Date().toISOString();
}

export function shouldUsePreviewMocks(): boolean {
  if (typeof window === 'undefined') return false;
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

function parseData(config: InternalAxiosRequestConfig): Record<string, unknown> {
  const raw = config.data;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
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

  return null;
}
