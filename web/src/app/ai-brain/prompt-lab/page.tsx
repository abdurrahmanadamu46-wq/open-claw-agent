'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import {
  fetchAiAgentRagCatalog,
  fetchAiAgentRagPacks,
  type AgentRagPackItem,
  type AgentRagPackPayload,
} from '@/services/endpoints/ai-subservice';
import { getKnowledgeLayerTerm } from '@/lib/knowledge-layer-language';

type AgentInfo = {
  id: string;
  name: string;
  duty: string;
};

const DEFAULT_PROFILE = 'commander';

const SENATE_AGENTS: AgentInfo[] = [
  { id: 'commander', name: '元老院总脑', duty: '目标解释、编队、裁决与止损' },
  { id: 'radar', name: '触须虾', duty: '竞品扫描与外部信号提取' },
  { id: 'strategist', name: '策士虾', duty: '策略拆解与路线设计' },
  { id: 'inkwriter', name: '吐墨虾', duty: '文案与脚本生成' },
  { id: 'visualizer', name: '幻影虾', duty: '分镜与视觉提示' },
  { id: 'dispatcher', name: '点兵虾', duty: '任务拆包与分发' },
  { id: 'echoer', name: '回声虾', duty: '互动承接与回复' },
  { id: 'catcher', name: '铁网虾', duty: '意向识别与线索放行' },
  { id: 'abacus', name: '算盘虾', duty: '评分、归因与价值判断' },
  { id: 'followup', name: '回访虾', duty: '高意向跟进与成交推进' },
];

const SUPPORT_KERNELS: AgentInfo[] = [
  { id: 'feedback', name: '反馈内核', duty: '复盘、进化与经验回写' },
];

function normalizeError(error: unknown): string {
  const maybe = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
  const status = maybe?.response?.status;
  if (status === 401) return '鉴权失效，请重新登录。';
  if (status === 403) return '权限不足，需要管理员角色。';
  if (status === 404) return '后端 AI 接口不存在（404）。';
  if (status && maybe?.response?.data?.message) return `请求失败 (${status}): ${maybe.response.data.message}`;
  if (status) return `请求失败 (${status})`;
  return maybe?.message || '请求失败';
}

function formatTime(value?: string): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readPackSummary(payload: AgentRagPackPayload) {
  const summary = String(payload.summary ?? payload.brief ?? payload.description ?? '').trim();
  return summary || '该知识包已入库，可用于策略推理与内容生成。';
}

function readPackTags(payload: AgentRagPackPayload) {
  const direct = Array.isArray(payload.tags) ? payload.tags : [];
  const tags = direct.map((item) => String(item).trim()).filter(Boolean);
  if (tags.length > 0) return tags.slice(0, 4);
  const keywords = Array.isArray(payload.keywords) ? payload.keywords : [];
  return keywords.map((item) => String(item).trim()).filter(Boolean).slice(0, 4);
}

function profileLabel(profile: string): string {
  if (profile === 'commander') return '总脑档案';
  if (profile === 'tenant') return '租户档案';
  return profile;
}

export default function PromptLabPage() {
  const { currentTenantId } = useTenant();
  const roleActivationTerm = getKnowledgeLayerTerm('role_activation');

  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [profileOptions, setProfileOptions] = useState<string[]>([DEFAULT_PROFILE]);
  const [selectedAgentId, setSelectedAgentId] = useState(SENATE_AGENTS[0]?.id || 'commander');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState('');
  const [ragPacksByAgent, setRagPacksByAgent] = useState<Record<string, AgentRagPackItem[]>>({});
  const [ragCountByAgent, setRagCountByAgent] = useState<Record<string, number>>({});

  const selectedAgent = useMemo(
    () => [...SENATE_AGENTS, ...SUPPORT_KERNELS].find((agent) => agent.id === selectedAgentId) ?? SENATE_AGENTS[0],
    [selectedAgentId],
  );
  const selectedAgentPacks = useMemo(() => ragPacksByAgent[selectedAgentId] ?? [], [ragPacksByAgent, selectedAgentId]);

  const coverage = useMemo(() => {
    const total = SENATE_AGENTS.length;
    const ready = SENATE_AGENTS.filter((item) => (ragCountByAgent[item.id] ?? 0) > 0).length;
    return {
      ready,
      total,
      percent: total > 0 ? Math.round((ready / total) * 100) : 0,
    };
  }, [ragCountByAgent]);

  const refresh = async (targetProfile?: string) => {
    const finalProfile = (targetProfile || profile || DEFAULT_PROFILE).trim() || DEFAULT_PROFILE;
    setLoading(true);
    setError('');
    try {
      const [catalogRes, packsRes] = await Promise.all([
        fetchAiAgentRagCatalog(currentTenantId),
        fetchAiAgentRagPacks(currentTenantId, finalProfile),
      ]);

      const catalogProfiles = Array.from(
        new Set([catalogRes?.catalog?.profile, finalProfile].map((item) => String(item || '').trim()).filter(Boolean)),
      );
      if (catalogProfiles.length > 0) setProfileOptions(catalogProfiles);

      const nextCountMap: Record<string, number> = {};
      const nextPackMap: Record<string, AgentRagPackItem[]> = {};
      [...SENATE_AGENTS, ...SUPPORT_KERNELS].forEach((agent) => {
        nextCountMap[agent.id] = 0;
        nextPackMap[agent.id] = [];
      });

      (packsRes.summary || []).forEach((item) => {
        const key = String(item.agent_id || '').trim();
        if (!key) return;
        nextCountMap[key] = Number(item.pack_count || 0);
      });
      (packsRes.items || []).forEach((item) => {
        const key = String(item.agent_id || '').trim();
        if (!key) return;
        if (!nextPackMap[key]) nextPackMap[key] = [];
        nextPackMap[key].push(item);
      });

      Object.keys(nextPackMap).forEach((agentId) => {
        nextPackMap[agentId] = nextPackMap[agentId].sort((a, b) => {
          const ta = new Date(a.updated_at || a.created_at || 0).getTime();
          const tb = new Date(b.updated_at || b.created_at || 0).getTime();
          return tb - ta;
        });
      });

      setProfile(finalProfile);
      setRagCountByAgent(nextCountMap);
      setRagPacksByAgent(nextPackMap);
      setLastSyncAt(formatTime(new Date().toISOString()));
    } catch (e) {
      setError(normalizeError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTenantId]);

  return (
    <div className="relative text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(245,158,11,0.12),transparent_22%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative space-y-5 p-6">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="inline-flex rounded-full border border-fuchsia-400/25 bg-fuchsia-400/10 px-4 py-2 text-xs text-fuchsia-100">
                {roleActivationTerm.title} · {roleActivationTerm.scopeLabel}
              </div>
              <h1 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-5xl">把知识挂到具体主管角色上，而不是再造一个知识归属层</h1>
              <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">
                {roleActivationTerm.description} 这页用来确认元老院总脑、9 个元老和反馈内核的知识包覆盖情况。重点不是看数据库有多少条，而是看哪个岗位已经站在足够厚的知识上工作。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={profile}
                onChange={(e) => void refresh(e.target.value)}
                className="rounded-2xl border border-slate-600 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none"
              >
                {profileOptions.map((item) => (
                  <option key={item} value={item}>
                    {profileLabel(item)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void refresh()}
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                刷新
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <SummaryCard title="当前配置档" value={profileLabel(profile)} subtitle={`最近同步：${lastSyncAt || '-'}`} />
            <SummaryCard title="元老院覆盖" value={`${coverage.ready}/${coverage.total}`} subtitle={`覆盖率 ${coverage.percent}%`} />
            <SummaryCard title="当前查看岗位" value={selectedAgent?.name || '-'} subtitle={selectedAgent?.duty || '-'} />
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm leading-7 text-slate-300">
            这页只表达“角色如何消费知识”。知识归属仍然要回到平台通用知识、平台行业知识和租户私有知识三层，不能把 RAG 包当成新的知识所有权层。
          </div>

          {error ? <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div> : null}
        </section>

        <section className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
            <div className="text-sm font-semibold text-slate-100">云端大脑岗位列表</div>
            <div className="mt-4 space-y-2">
              {[...SENATE_AGENTS, ...SUPPORT_KERNELS].map((agent) => {
                const count = ragCountByAgent[agent.id] ?? 0;
                const active = selectedAgentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      active ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/8 bg-slate-950/40 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-100">{agent.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{agent.duty}</div>
                      </div>
                      <div className="rounded-full border border-slate-600 px-2 py-0.5 text-xs text-slate-300">{count}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">{selectedAgent?.name || '-'}</div>
                <div className="mt-1 text-xs text-slate-500">{selectedAgent?.duty || '-'}</div>
              </div>
              <div className="text-xs text-slate-500">知识包：{selectedAgentPacks.length}</div>
            </div>

            <div className="mt-4 space-y-3">
              {selectedAgentPacks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
                  当前角色还没有可见知识包。
                </div>
              ) : (
                selectedAgentPacks.map((item) => {
                  const payload = item.payload_json || item.payload;
                  const tags = readPackTags(payload);
                  const packId = item.pack_id || item.knowledge_pack_id;
                  const packName = item.title || item.knowledge_pack_name || packId;
                  const scope = item.scope || item.profile || 'tenant';
                  const scopeLabel = scope === 'tenant' ? '租户级' : scope === 'profile' ? '配置档级' : scope;

                  return (
                    <article key={packId} className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-100">{packName}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {packId} · 更新时间 {formatTime(item.updated_at || item.created_at)}
                          </div>
                        </div>
                        <div className="text-xs text-slate-400">{scopeLabel}</div>
                      </div>

                      <p className="mt-3 text-sm leading-6 text-slate-300">{readPackSummary(payload)}</p>

                      {tags.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {tags.map((tag) => (
                            <span key={tag} className="rounded-full border border-slate-600 px-2 py-0.5 text-xs text-slate-300">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className="mt-2 text-xl font-semibold text-slate-100">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
    </div>
  );
}
