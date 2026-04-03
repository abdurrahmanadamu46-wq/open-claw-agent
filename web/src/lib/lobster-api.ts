'use client';

import api from '@/services/api';

export type LobsterHealthState = 'healthy' | 'degraded' | 'critical' | 'idle';
export type LobsterTier = 'simple' | 'standard' | 'complex' | 'reasoning';

export interface LobsterOverviewRow {
  id: string;
  name: string;
  icon: string;
  role: string;
  tier: LobsterTier;
  status: LobsterHealthState;
  run_count_24h: number;
  total_tokens_24h: number;
  total_cost_24h: number;
  avg_latency_ms: number;
  skills?: string[];
  default_bridge_target?: string | null;
}

export interface LobsterPoolOverviewResponse {
  ok: boolean;
  summary: {
    lobster_count: number;
    healthy: number;
    degraded: number;
    critical: number;
    idle: number;
    total_runs_24h: number;
    total_tokens_24h: number;
    total_cost_cny_24h: number;
    error_count_24h: number;
    error_rate_24h: number;
  };
  lobsters: LobsterOverviewRow[];
  token_usage: Array<{
    hour: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
    message_count: number;
  }>;
  cost_by_model: Array<{
    model: string;
    tokens: number;
    estimated_cost: number;
    run_count: number;
  }>;
  tier_map: Record<LobsterTier, { label: string; color: string }>;
}

export interface LobsterPoolMetricsResponse {
  ok: boolean;
  token_usage: Array<{
    hour: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  }>;
  cost_usage: Array<{
    hour: string;
    cost: number;
  }>;
  message_usage: Array<{
    hour: string;
    message_count: number;
  }>;
  by_lobster: Array<{
    lobster_id: string;
    hour: string;
    tokens: number;
    cost: number;
  }>;
  by_tier: Array<{
    tier: LobsterTier;
    hour: string;
    run_count: number;
    cost: number;
  }>;
}

export interface LobsterRegistryItem {
  id: string;
  name: string;
  icon: string;
  role: string;
  tier: LobsterTier;
  zh_name: string;
  default_bridge_target?: string | null;
  starter_skills?: string[];
}

export interface LobsterRegistryResponse {
  ok: boolean;
  lobsters: LobsterRegistryItem[];
  tier_map: Record<LobsterTier, { label: string; color: string }>;
}

export interface LobsterRecentRun {
  run_id: string;
  created_at: string;
  model_used: string;
  tier: LobsterTier;
  input_tokens: number;
  output_tokens: number;
  cost_cny: number;
  latency_ms: number;
  status: 'success' | 'failed' | 'running';
}

export interface LobsterDetailResponse {
  ok: boolean;
  lobster: {
    id: string;
    name: string;
    icon: string;
    role: string;
    tier: LobsterTier;
    status: LobsterHealthState;
    skills: string[];
    default_bridge_target?: string | null;
    total_runs_24h: number;
    total_tokens_24h: number;
    total_cost_cny_24h: number;
    avg_latency_ms: number;
  };
  hourly_usage: Array<{
    hour: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost: number;
  }>;
  recent_runs: LobsterRecentRun[];
}

export interface LobsterScoringDimension {
  key: string;
  label: string;
  score: number;
}

export interface LobsterScoringResponse {
  ok: boolean;
  tier: LobsterTier;
  raw_score: number;
  confidence: number;
  dimensions: LobsterScoringDimension[];
  routed_lobster: {
    id: string;
    name: string;
    icon: string;
    role: string;
    tier: LobsterTier;
    reason: string;
  };
}

export interface LobsterRoutingHistoryResponse {
  ok: boolean;
  items: Array<{
    history_id: string;
    lobster_id: string;
    lobster_name: string;
    tier: LobsterTier;
    task_description: string;
    raw_score: number;
    confidence: number;
    routed_at: string;
  }>;
}

export interface LobsterRunRecordPayload {
  lobster_id: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  cost_cny: number;
  status: 'success' | 'failed' | 'running';
  tier: LobsterTier;
  task_description?: string;
}

const TIER_MAP: Record<LobsterTier, { label: string; color: string }> = {
  simple: { label: '简单任务', color: '#22c55e' },
  standard: { label: '标准任务', color: '#3b82f6' },
  complex: { label: '复杂任务', color: '#f59e0b' },
  reasoning: { label: '推理任务', color: '#ef4444' },
};

const REGISTRY: LobsterRegistryItem[] = [
  { id: 'radar', name: '触须虾 Radar', zh_name: '触须虾', icon: '📡', role: '情报侦察', tier: 'standard', default_bridge_target: 'brain-shadow-runner', starter_skills: ['signal-scan', 'competitor-watch'] },
  { id: 'strategist', name: '脑虫虾 Strategist', zh_name: '脑虫虾', icon: '🧠', role: '策略规划', tier: 'reasoning', default_bridge_target: 'brain-shadow-runner', starter_skills: ['strategy-planning', 'industry-kb'] },
  { id: 'inkwriter', name: '吐墨虾 InkWriter', zh_name: '吐墨虾', icon: '✒️', role: '文案生产', tier: 'standard', default_bridge_target: 'brain-shadow-runner', starter_skills: ['copywriting', 'policy-guard'] },
  { id: 'visualizer', name: '幻影虾 Visualizer', zh_name: '幻影虾', icon: '🎬', role: '视觉分镜', tier: 'complex', default_bridge_target: 'execute-campaign', starter_skills: ['storyboard', 'visual-prompt'] },
  { id: 'dispatcher', name: '点兵虾 Dispatcher', zh_name: '点兵虾', icon: '📦', role: '任务编排', tier: 'standard', default_bridge_target: 'execute-campaign', starter_skills: ['dispatch-routing', 'edge-control'] },
  { id: 'echoer', name: '回声虾 Echoer', zh_name: '回声虾', icon: '💬', role: '互动回复', tier: 'simple', default_bridge_target: 'brain-shadow-runner', starter_skills: ['comment-reply', 'tone-control'] },
  { id: 'catcher', name: '铁网虾 Catcher', zh_name: '铁网虾', icon: '🎯', role: '线索识别', tier: 'standard', default_bridge_target: 'lead-ops-runner', starter_skills: ['intent-gate', 'lead-routing'] },
  { id: 'abacus', name: '金算虾 Abacus', zh_name: '金算虾', icon: '🧮', role: '评分归因', tier: 'reasoning', default_bridge_target: 'lead-ops-runner', starter_skills: ['lead-score', 'crm-writeback'] },
  { id: 'followup', name: '回访虾 FollowUp', zh_name: '回访虾', icon: '🔄', role: '高意向跟进', tier: 'complex', default_bridge_target: 'orchestrator-control', starter_skills: ['voice-call', 'sales-followup'] },
];

const MOCK_OVERVIEW: LobsterPoolOverviewResponse = {
  ok: true,
  summary: {
    lobster_count: 9,
    healthy: 5,
    degraded: 1,
    critical: 0,
    idle: 3,
    total_runs_24h: 142,
    total_tokens_24h: 580000,
    total_cost_cny_24h: 12.35,
    error_count_24h: 3,
    error_rate_24h: 0.0211,
  },
  lobsters: [
    { ...REGISTRY[0], status: 'healthy', run_count_24h: 22, total_tokens_24h: 45000, total_cost_24h: 1.2, avg_latency_ms: 320.5 },
    { ...REGISTRY[1], status: 'healthy', run_count_24h: 18, total_tokens_24h: 98000, total_cost_24h: 2.8, avg_latency_ms: 640.2 },
    { ...REGISTRY[2], status: 'degraded', run_count_24h: 27, total_tokens_24h: 82000, total_cost_24h: 1.95, avg_latency_ms: 712.3 },
    { ...REGISTRY[3], status: 'healthy', run_count_24h: 12, total_tokens_24h: 74000, total_cost_24h: 2.14, avg_latency_ms: 980.4 },
    { ...REGISTRY[4], status: 'healthy', run_count_24h: 16, total_tokens_24h: 51000, total_cost_24h: 1.08, avg_latency_ms: 410.8 },
    { ...REGISTRY[5], status: 'idle', run_count_24h: 8, total_tokens_24h: 28000, total_cost_24h: 0.46, avg_latency_ms: 190.4 },
    { ...REGISTRY[6], status: 'healthy', run_count_24h: 14, total_tokens_24h: 61000, total_cost_24h: 1.31, avg_latency_ms: 280.7 },
    { ...REGISTRY[7], status: 'idle', run_count_24h: 9, total_tokens_24h: 79000, total_cost_24h: 1.76, avg_latency_ms: 530.2 },
    { ...REGISTRY[8], status: 'idle', run_count_24h: 16, total_tokens_24h: 62000, total_cost_24h: 1.65, avg_latency_ms: 860.1 },
  ],
  token_usage: Array.from({ length: 24 }).map((_, index) => ({
    hour: `2026-03-30T${String(index).padStart(2, '0')}:00:00Z`,
    input_tokens: 9000 + index * 420,
    output_tokens: 6000 + index * 280,
    cost: Number((0.22 + index * 0.015).toFixed(2)),
    message_count: 4 + (index % 6),
  })),
  cost_by_model: [
    { model: 'gpt-4.1', tokens: 200000, estimated_cost: 5.2, run_count: 40 },
    { model: 'deepseek-chat', tokens: 230000, estimated_cost: 3.6, run_count: 73 },
    { model: 'qwen-max', tokens: 100000, estimated_cost: 2.1, run_count: 21 },
    { model: 'glm-4.7-flash', tokens: 50000, estimated_cost: 1.45, run_count: 8 },
  ],
  tier_map: TIER_MAP,
};

const MOCK_METRICS: LobsterPoolMetricsResponse = {
  ok: true,
  token_usage: MOCK_OVERVIEW.token_usage.map((row) => ({
    hour: row.hour,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    total_tokens: row.input_tokens + row.output_tokens,
  })),
  cost_usage: MOCK_OVERVIEW.token_usage.map((row) => ({ hour: row.hour, cost: row.cost })),
  message_usage: MOCK_OVERVIEW.token_usage.map((row) => ({ hour: row.hour, message_count: row.message_count })),
  by_lobster: MOCK_OVERVIEW.lobsters.flatMap((lobster, idx) =>
    MOCK_OVERVIEW.token_usage.slice(0, 6).map((row, offset) => ({
      lobster_id: lobster.id,
      hour: row.hour,
      tokens: Math.round((lobster.total_tokens_24h / 24) * (0.8 + offset * 0.06)),
      cost: Number(((lobster.total_cost_24h / 24) * (0.8 + offset * 0.06)).toFixed(2)),
    })),
  ),
  by_tier: [
    { tier: 'simple', hour: '2026-03-30T08:00:00Z', run_count: 8, cost: 0.22 },
    { tier: 'standard', hour: '2026-03-30T08:00:00Z', run_count: 22, cost: 0.54 },
    { tier: 'complex', hour: '2026-03-30T08:00:00Z', run_count: 7, cost: 0.73 },
    { tier: 'reasoning', hour: '2026-03-30T08:00:00Z', run_count: 4, cost: 0.92 },
  ],
};

const MOCK_ROUTING_HISTORY: LobsterRoutingHistoryResponse = {
  ok: true,
  items: [
    {
      history_id: 'hist_001',
      lobster_id: 'strategist',
      lobster_name: '脑虫虾 Strategist',
      tier: 'reasoning',
      task_description: '帮我批量分析 10 个竞品账号的爆款公式',
      raw_score: 0.91,
      confidence: 0.88,
      routed_at: '2026-03-30T09:15:00Z',
    },
    {
      history_id: 'hist_002',
      lobster_id: 'catcher',
      lobster_name: '铁网虾 Catcher',
      tier: 'standard',
      task_description: '把评论区高意向客户抓出来并打标签',
      raw_score: 0.74,
      confidence: 0.81,
      routed_at: '2026-03-30T11:40:00Z',
    },
    {
      history_id: 'hist_003',
      lobster_id: 'followup',
      lobster_name: '回访虾 FollowUp',
      tier: 'complex',
      task_description: '对高意向客户安排外呼和预约动作',
      raw_score: 0.84,
      confidence: 0.79,
      routed_at: '2026-03-30T15:05:00Z',
    },
  ],
};

function createDetail(id: string): LobsterDetailResponse {
  const lobster = MOCK_OVERVIEW.lobsters.find((item) => item.id === id) || MOCK_OVERVIEW.lobsters[0];
  return {
    ok: true,
    lobster: {
      id: lobster.id,
      name: lobster.name,
      icon: lobster.icon,
      role: lobster.role,
      tier: lobster.tier,
      status: lobster.status,
      skills: lobster.skills || REGISTRY.find((item) => item.id === lobster.id)?.starter_skills || [],
      default_bridge_target: lobster.default_bridge_target || REGISTRY.find((item) => item.id === lobster.id)?.default_bridge_target || null,
      total_runs_24h: lobster.run_count_24h,
      total_tokens_24h: lobster.total_tokens_24h,
      total_cost_cny_24h: lobster.total_cost_24h,
      avg_latency_ms: lobster.avg_latency_ms,
    },
    hourly_usage: MOCK_METRICS.token_usage.slice(0, 12).map((row, idx) => ({
      hour: row.hour,
      input_tokens: Math.round((lobster.total_tokens_24h / 30) * (0.9 + idx * 0.03)),
      output_tokens: Math.round((lobster.total_tokens_24h / 45) * (0.9 + idx * 0.03)),
      total_tokens: Math.round((lobster.total_tokens_24h / 18) * (0.9 + idx * 0.03)),
      cost: Number(((lobster.total_cost_24h / 18) * (0.9 + idx * 0.03)).toFixed(2)),
    })),
    recent_runs: Array.from({ length: 8 }).map((_, idx) => ({
      run_id: `${lobster.id}_run_${idx + 1}`,
      created_at: `2026-03-30T${String(8 + idx).padStart(2, '0')}:15:00Z`,
      model_used: idx % 2 === 0 ? 'gpt-4.1' : 'deepseek-chat',
      tier: lobster.tier,
      input_tokens: 400 + idx * 120,
      output_tokens: 260 + idx * 90,
      cost_cny: Number((0.08 + idx * 0.04).toFixed(2)),
      latency_ms: Number((lobster.avg_latency_ms * (0.85 + idx * 0.04)).toFixed(1)),
      status: idx === 5 ? 'failed' : 'success',
    })),
  };
}

const MOCK_SCORING: LobsterScoringResponse = {
  ok: true,
  tier: 'reasoning',
  raw_score: 0.89,
  confidence: 0.84,
  dimensions: [
    { key: 'multi_step_depth', label: '多步深度', score: 0.94 },
    { key: 'competitor_load', label: '竞品负载', score: 0.91 },
    { key: 'tool_complexity', label: '工具复杂度', score: 0.76 },
    { key: 'risk_sensitivity', label: '风险敏感度', score: 0.81 },
    { key: 'edge_coordination', label: '边缘协同', score: 0.73 },
    { key: 'content_variation', label: '内容变化度', score: 0.68 },
    { key: 'lead_followup', label: '线索后续性', score: 0.77 },
    { key: 'memory_need', label: '记忆依赖', score: 0.88 },
    { key: 'latency_tolerance', label: '时延容忍度', score: 0.71 },
    { key: 'operator_review', label: '人工复核需求', score: 0.85 },
  ],
  routed_lobster: {
    id: 'strategist',
    name: '脑虫虾 Strategist',
    icon: '🧠',
    role: '策略规划',
    tier: 'reasoning',
    reason: '任务涉及多竞品分析、跨步骤规划和较高风险判断，适合交给脑虫虾主导。',
  },
};

function shouldUseMock() {
  if (typeof window === 'undefined') return false;
  const { hostname, port } = window.location;
  return (hostname === '127.0.0.1' || hostname === 'localhost') && ['3000', '3001', '3002', '3003', '3005'].includes(port || '');
}

function withMockFallback<T>(factory: () => Promise<T>, fallback: T | (() => T)): Promise<T> {
  if (shouldUseMock()) {
    return Promise.resolve(typeof fallback === 'function' ? (fallback as () => T)() : fallback);
  }
  return factory().catch(() => (typeof fallback === 'function' ? (fallback as () => T)() : fallback));
}

export async function fetchLobsterPoolOverview(tenantId = 'tenant_main') {
  return withMockFallback(
    async () => {
      const { data } = await api.get<LobsterPoolOverviewResponse>('/lobster/pool/overview', {
        params: { tenant_id: tenantId },
      });
      return data;
    },
    MOCK_OVERVIEW,
  );
}

export async function fetchLobsterPoolMetrics(rangeHours = 24, granularity: 'hour' | 'day' = 'hour') {
  return withMockFallback(
    async () => {
      const { data } = await api.get<LobsterPoolMetricsResponse>('/lobster/pool/metrics', {
        params: { range_hours: rangeHours, granularity },
      });
      return data;
    },
    MOCK_METRICS,
  );
}

export async function fetchLobsterRegistry() {
  return withMockFallback(
    async () => {
      const { data } = await api.get<LobsterRegistryResponse>('/lobster/pool/registry');
      return data;
    },
    {
      ok: true,
      lobsters: REGISTRY,
      tier_map: TIER_MAP,
    },
  );
}

export async function fetchLobsterDetail(lobsterId: string, limit = 50) {
  return withMockFallback(
    async () => {
      const { data } = await api.get<LobsterDetailResponse>(`/lobster/${encodeURIComponent(lobsterId)}/detail`, {
        params: { limit },
      });
      return data;
    },
    () => createDetail(lobsterId),
  );
}

export async function simulateLobsterScoring(payload: {
  task_description: string;
  competitor_count?: number;
  edge_target_count?: number;
  risk_level?: string;
  tool_count?: number;
}) {
  return withMockFallback(
    async () => {
      const { data } = await api.post<LobsterScoringResponse>('/lobster/scoring/simulate', payload);
      return data;
    },
    MOCK_SCORING,
  );
}

export async function fetchLobsterRoutingHistory(params?: {
  limit?: number;
  lobster_id?: string;
  tier?: LobsterTier;
}) {
  return withMockFallback(
    async () => {
      const { data } = await api.get<LobsterRoutingHistoryResponse>('/lobster/routing/history', {
        params: params || {},
      });
      return data;
    },
    {
      ...MOCK_ROUTING_HISTORY,
      items: MOCK_ROUTING_HISTORY.items.filter((item) => {
        if (params?.lobster_id && item.lobster_id !== params.lobster_id) return false;
        if (params?.tier && item.tier !== params.tier) return false;
        return true;
      }).slice(0, params?.limit || 50),
    },
  );
}

export async function recordLobsterRun(payload: LobsterRunRecordPayload) {
  return withMockFallback(
    async () => {
      const { data } = await api.post('/lobster/run/record', payload);
      return data as { ok: boolean };
    },
    { ok: true },
  );
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatCurrencyCny(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(value);
}

export function tierLabel(tier: LobsterTier) {
  return TIER_MAP[tier]?.label || tier;
}

export function tierColor(tier: LobsterTier) {
  return TIER_MAP[tier]?.color || '#94a3b8';
}
