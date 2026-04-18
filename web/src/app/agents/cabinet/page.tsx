'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Brain, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { AgentPodIcon } from './AgentPodSvgs';
import { CUSTOM_LOBSTER_AGENTS, type CustomLobsterAgentId } from '@/data/custom-lobster-agents';
import { useTenant } from '@/contexts/TenantContext';
import {
  fetchControlPlaneSupervisorsOverview,
  getAiSubserviceStatus,
  type AiSubserviceStatusResponse,
  updateAiLlmAgentBinding,
  type LlmAgentBindingRow,
  type LlmProviderConfigRow,
} from '@/services/endpoints/ai-subservice';
import type { ControlPlaneSupervisorsOverviewResponse } from '@/types/control-plane-overview';

const AGENT_UI_TO_BACKEND: Record<CustomLobsterAgentId, string> = {
  radar: 'radar',
  strategist: 'strategist',
  inkwriter: 'inkwriter',
  visualizer: 'visualizer',
  dispatcher: 'dispatcher',
  echoer: 'echoer',
  catcher: 'catcher',
  abacus: 'abacus',
  followup: 'followup',
};

const DEFAULT_TASK_TYPE: Record<string, string> = {
  radar: 'radar_enrichment',
  strategist: 'strategy_planning',
  inkwriter: 'content_generation',
  visualizer: 'visual_prompting',
  dispatcher: 'dispatch_routing',
  echoer: 'engagement_copy',
  catcher: 'intent_classification',
  abacus: 'lead_scoring',
  followup: 'sales_followup',
};

const AGENT_ACCENT: Record<CustomLobsterAgentId, string> = {
  radar: '#14b8a6',
  strategist: '#f59e0b',
  inkwriter: '#8b5cf6',
  visualizer: '#3b82f6',
  dispatcher: '#0ea5e9',
  echoer: '#ef4444',
  catcher: '#f97316',
  abacus: '#fb923c',
  followup: '#10b981',
};

const AGENT_COPY: Record<string, { name: string; mission: string; capability: string; operatorHint: string }> = {
  radar: {
    name: '触须虾',
    mission: '负责捕捉竞品、热点、评论情报和外部信号。',
    capability: '先知道市场发生了什么，再决定后续动作。',
    operatorHint: '适合挂研究雷达、热词源和竞品信号源。',
  },
  strategist: {
    name: '策士虾',
    mission: '负责目标拆解、增长路线和策略判断。',
    capability: '把零散动作收束成真正可执行的增长计划。',
    operatorHint: '适合挂行业知识包、策略模板和治理边界。',
  },
  inkwriter: {
    name: '吐墨虾',
    mission: '负责脚本、文案、开场钩子和转化话术。',
    capability: '把策略翻译成能发出去、能转化的表达。',
    operatorHint: '适合挂文案模板、禁用词库和成交话术库。',
  },
  visualizer: {
    name: '幻影虾',
    mission: '负责分镜、画面结构、提示词和视觉路线。',
    capability: '让内容不仅会说，更看起来像能赢。',
    operatorHint: '适合挂分镜模板、视觉风格包和素材规则。',
  },
  dispatcher: {
    name: '点兵虾',
    mission: '负责任务拆包、顺序编排和边缘下发。',
    capability: '决定什么先执行、什么并行、什么要等审批。',
    operatorHint: '适合挂执行规则、边缘约束和回执策略。',
  },
  echoer: {
    name: '回声虾',
    mission: '负责互动回复、评论承接和对话气质。',
    capability: '让系统在真实触点里更像成熟运营，而不是回复机器人。',
    operatorHint: '适合挂口吻模板和评论策略。',
  },
  catcher: {
    name: '捕手虾',
    mission: '负责意向识别、线索过滤和放行。',
    capability: '保证进入线索池的是值得继续跟进的人，而不是噪音。',
    operatorHint: '适合挂高意向词、风险词和过滤规则。',
  },
  abacus: {
    name: '算盘虾',
    mission: '负责线索评分、价值判断和归因。',
    capability: '把“感觉不错”变成“值得优先投入”的量化判断。',
    operatorHint: '适合挂评分规则和 CRM 回推逻辑。',
  },
  followup: {
    name: '回访虾',
    mission: '负责高意向跟进、预约推进与成交闭环。',
    capability: '把线索真正推进到结果，不停在回收联系方式。',
    operatorHint: '适合挂电话脚本、节奏和回执规则。',
  },
};

function normalizeError(error: unknown): string {
  const maybe = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
  const status = maybe?.response?.status;
  if (status === 401) return '鉴权失效，请重新登录。';
  if (status === 403) return '权限不足，需要管理员角色。';
  if (status === 404) return 'AI 子服务接口不存在。';
  if (status && maybe?.response?.data?.message) return `请求失败（${status}）：${maybe.response.data.message}`;
  if (status) return `请求失败（${status}）`;
  return maybe?.message || '请求失败';
}

function fmtTime(value?: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function safeText(value: string | undefined | null): string {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : '-';
}

function serviceStatusLabel(status?: string): string {
  return status ? '链路在线' : '暂不可用';
}

export default function AgentsCabinetPage() {
  const { currentTenantId } = useTenant();
  const [providers, setProviders] = useState<LlmProviderConfigRow[]>([]);
  const [bindings, setBindings] = useState<Record<string, LlmAgentBindingRow>>({});
  const [statusPayload, setStatusPayload] = useState<AiSubserviceStatusResponse>({});
  const [ragCountByAgent, setRagCountByAgent] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [syncText, setSyncText] = useState('');

  const providerMap = useMemo(() => {
    const map: Record<string, LlmProviderConfigRow> = {};
    providers.forEach((item) => {
      map[item.provider_id] = item;
    });
    return map;
  }, [providers]);

  const enabledProviderOptions = useMemo(() => {
    return providers
      .filter((item) => item.enabled)
      .map((item) => ({
        value: item.provider_id,
        label: `${item.label || item.provider_id} · ${item.default_model || '-'}`,
      }));
  }, [providers]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setErrorText('');
    try {
      const [overviewRes, statusRes] = await Promise.all([
        fetchControlPlaneSupervisorsOverview(currentTenantId),
        getAiSubserviceStatus(),
      ]);
      const providerRows = (overviewRes.providers?.providers || []).map<LlmProviderConfigRow>((row) => ({
        provider_id: row.provider_id,
        label: row.label,
        enabled: Boolean(row.enabled),
        route: row.route === 'local' ? 'local' : 'cloud',
        base_url: row.base_url || '',
        default_model: row.default_model || '',
        api_key_masked: row.api_key_masked,
        api_key_configured: row.api_key_configured,
        source: row.source === 'env_default' || row.source === 'tenant_override' ? row.source : undefined,
        updated_at: row.updated_at,
        updated_by: row.updated_by,
        note: row.note,
      }));
      const bindingRows = (overviewRes.bindings?.bindings || []).map<LlmAgentBindingRow>((row) => ({
        agent_id: row.agent_id,
        enabled: Boolean(row.enabled),
        task_type: row.task_type || DEFAULT_TASK_TYPE[row.agent_id] || 'strategy_planning',
        provider_id: row.provider_id || '',
        model_name: row.model_name || '',
        temperature: typeof row.temperature === 'number' ? row.temperature : 0.3,
        max_tokens: typeof row.max_tokens === 'number' ? row.max_tokens : 0,
        note: row.note,
        updated_by: row.updated_by,
        updated_at: row.updated_at,
        source: row.source === 'default' || row.source === 'tenant_override' ? row.source : undefined,
      }));
      const skillsRes = overviewRes.skills_pool as ControlPlaneSupervisorsOverviewResponse['skills_pool'];

      const bindingMap: Record<string, LlmAgentBindingRow> = {};
      bindingRows.forEach((row) => {
        bindingMap[row.agent_id] = row;
      });

      const ragMap: Record<string, number> = {};
      (skillsRes?.overview?.agent_rag_pack_summary || []).forEach((row) => {
        ragMap[row.agent_id] = Number(row.pack_count || 0);
      });

      setProviders(providerRows);
      setBindings(bindingMap);
      setRagCountByAgent(ragMap);
      setStatusPayload({
        status: typeof statusRes?.status === 'string' ? statusRes.status : '',
        registered_edges: Array.isArray(statusRes?.registered_edges) ? statusRes.registered_edges : [],
        known_edge_skills: Array.isArray(statusRes?.known_edge_skills) ? statusRes.known_edge_skills : [],
      });
      setSyncText(`同步完成 · 租户=${overviewRes.tenant_id}`);
    } catch (error) {
      setErrorText(normalizeError(error));
      setSyncText('同步失败');
    } finally {
      setLoading(false);
    }
  }, [currentTenantId]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleProviderChange = async (backendAgentId: string, providerId: string) => {
    const provider = providers.find((item) => item.provider_id === providerId);
    if (!provider) return;
    const current = bindings[backendAgentId];
    const payload = {
      tenant_id: currentTenantId,
      enabled: true,
      task_type: current?.task_type || DEFAULT_TASK_TYPE[backendAgentId] || 'strategy_planning',
      provider_id: providerId,
      model_name: provider.default_model || current?.model_name || '',
      temperature: typeof current?.temperature === 'number' ? current.temperature : 0.3,
      max_tokens: typeof current?.max_tokens === 'number' ? current.max_tokens : 0,
      note: current?.note || '',
    };

    try {
      const updated = await updateAiLlmAgentBinding(backendAgentId, payload);
      setBindings((prev) => ({ ...prev, [backendAgentId]: updated.binding }));
      setErrorText('');
      setSyncText(`已更新 ${backendAgentId} 的模型绑定`);
    } catch (error) {
      setErrorText(normalizeError(error));
    }
  };

  const edgeCount = (statusPayload.registered_edges || []).length;
  const skillCount = (statusPayload.known_edge_skills || []).length;
  const activeAgents = Object.values(bindings).filter((binding) => binding.enabled).length;

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Sparkles className="h-4 w-4" />
              主管龙虾总览
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-5xl">
              这里展示的是主管龙虾组织，
              <br />
              而不是一堆孤立的 AI 节点。
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">
              每位主管龙虾都有自己的职责、默认模型、知识包、执行边界和下辖能力池。前端要表达的是“主管如何组织细化岗位”，而不是只把技术参数平铺在一页里。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/lobsters/capability-tree"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15"
            >
              能力树地图
            </Link>
            <Link
              href="/dashboard/lobster-pool"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15"
            >
              龙虾池看板
            </Link>
            <Link
              href="/settings/model-providers"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]"
            >
              <Settings2 className="h-4 w-4" />
              模型设置
            </Link>
            <button
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950 transition disabled:opacity-50"
              onClick={() => void refreshAll()}
              type="button"
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        </div>
        {syncText ? <div className="mt-4 text-xs text-slate-400">{syncText}</div> : null}
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="边缘节点" value={edgeCount} helper="当前注册到执行网络的节点数量" />
        <MetricCard label="边缘技能" value={skillCount} helper="当前可调用的边缘技能数量" />
        <MetricCard label="启用龙虾" value={activeAgents} helper="当前启用且有模型绑定的岗位数" />
        <MetricCard label="服务状态" value={serviceStatusLabel(statusPayload.status)} helper={statusPayload.status ? '主服务在线，可继续配置与调度' : '主服务暂不可用'} />
      </section>

      {errorText ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {errorText}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {CUSTOM_LOBSTER_AGENTS.map((agent) => {
          const backendAgentId = AGENT_UI_TO_BACKEND[agent.id];
          const binding = bindings[backendAgentId];
          const selectedProviderId = binding?.provider_id || enabledProviderOptions[0]?.value || '';
          const accent = AGENT_ACCENT[agent.id];
          const copy = AGENT_COPY[backendAgentId];
          const ragCount = ragCountByAgent[backendAgentId] || 0;

          return (
            <article
              key={agent.id}
              className="group relative overflow-hidden rounded-[28px] border bg-[#111b2d]/90 p-6 shadow-[0_18px_60px_-30px_rgba(2,6,23,0.65)] transition-all duration-300 hover:translate-y-[-2px]"
              style={{ borderColor: `${accent}55` }}
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-20 transition-opacity duration-300 group-hover:opacity-30"
                style={{ background: `radial-gradient(900px circle at 0% 0%, ${accent}33 0%, transparent 35%)` }}
              />

              <div className="relative z-10">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-12 w-12 items-center justify-center rounded-2xl border shadow-inner"
                      style={{ borderColor: `${accent}88`, color: accent, background: `${accent}20` }}
                    >
                      <AgentPodIcon agentId={agent.id} color={accent} size={22} />
                    </span>
                    <div>
                      <div className="text-lg font-semibold text-white">{copy?.name || backendAgentId}</div>
                      <div className="text-xs text-slate-400">{agent.codename}</div>
                    </div>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                    知识包 {ragCount}
                  </div>
                </div>

                <div className="mt-5 space-y-3 text-sm">
                  <InfoBlock label="岗位职责" value={copy?.mission || safeText(agent.description)} />
                  <InfoBlock label="核心价值" value={copy?.capability || safeText(agent.personality)} />
                  <InfoBlock label="运营提示" value={copy?.operatorHint || '当前未配置说明'} />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <MiniStat label="任务类型" value={safeText(binding?.task_type)} />
                  <MiniStat label="最近更新" value={fmtTime(binding?.updated_at)} />
                </div>

                <div className="mt-5">
                  <label className="mb-2 block text-[11px] uppercase tracking-[0.18em] text-slate-500">服务商 / 模型</label>
                  <select
                    className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
                    value={selectedProviderId}
                    onChange={(event) => void handleProviderChange(backendAgentId, event.target.value)}
                    disabled={enabledProviderOptions.length === 0}
                  >
                    {enabledProviderOptions.length === 0 ? (
                      <option value="">暂无可用服务商</option>
                    ) : (
                      enabledProviderOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="mt-5 flex items-center gap-2 text-xs text-slate-400">
                  <Brain className="h-3.5 w-3.5" />
                  当前模型：{safeText(binding?.model_name)}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                  <Bot className="h-3.5 w-3.5" />
                  服务商：{safeText(providerMap[selectedProviderId]?.label || selectedProviderId)}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: number | string;
  helper: string;
}) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.04] px-6 py-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm text-slate-300">{helper}</div>
    </section>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm leading-7 text-slate-200">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}
