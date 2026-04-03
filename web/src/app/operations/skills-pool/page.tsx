'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, RefreshCw, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/contexts/TenantContext';
import { SkillPublishStatusBadge } from '@/components/business/SkillPublishStatusBadge';
import {
  approveSkill,
  fetchAiSkillsPoolOverview,
  updateAiAgentExtensionProfile,
  type AgentExtensionNode,
  type AgentExtensionProfile,
  type AgentExtensionSkill,
} from '@/services/endpoints/ai-subservice';
import { getCurrentUser } from '@/services/endpoints/user';

type SkillPoolOverview = Awaited<ReturnType<typeof fetchAiSkillsPoolOverview>>['overview'];

type DraftByAgent = Record<string, AgentExtensionProfile>;

const AGENT_LABELS: Record<string, string> = {
  commander: '元老院总脑',
  radar: '触须虾',
  strategist: '策士虾',
  inkwriter: '吐墨虾',
  visualizer: '幻影虾',
  dispatcher: '点兵虾',
  echoer: '回声虾',
  catcher: '铁网虾',
  abacus: '算盘虾',
  feedback: '反馈内核',
  followup: '回访虾',
};

function runtimeModeLabel(mode?: string): string {
  switch (mode) {
    case 'hybrid':
      return '混合';
    case 'local':
      return '本地';
    case 'cloud':
      return '云端';
    default:
      return mode || '-';
  }
}

const CARD_BORDER = 'rgba(71,85,105,0.4)';

function cloneProfile(profile: AgentExtensionProfile): AgentExtensionProfile {
  return JSON.parse(JSON.stringify(profile)) as AgentExtensionProfile;
}

function normalizeAxiosError(error: unknown): string {
  const maybe = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
  const status = maybe?.response?.status;
  if (status === 401) return '鉴权失效，请退出后重新登录。';
  if (status === 403) return '权限不足，需要管理员角色。';
  if (status === 404) return '后端接口不存在（404），请先重启 backend 与 ai-subservice。';
  if (status && maybe?.response?.data?.message) return `请求失败 (${status}): ${maybe.response.data.message}`;
  if (status) return `请求失败 (${status})`;
  return maybe?.message || '请求失败';
}

export default function SkillsPoolPage() {
  const t = useTranslations('skillsPool');
  const { currentTenantId } = useTenant();
  const currentUserQuery = useQuery({
    queryKey: ['skills-pool', 'current-user'],
    queryFn: getCurrentUser,
    staleTime: 5 * 60 * 1000,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [approving, setApproving] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState('');
  const [overview, setOverview] = useState<SkillPoolOverview | null>(null);
  const [draft, setDraft] = useState<DraftByAgent>({});
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState('');

  const refresh = async () => {
    setLoading(true);
    setErrorText('');
    try {
      const data = await fetchAiSkillsPoolOverview(currentTenantId);
      const rows = data?.overview?.agent_profiles ?? [];
      const nextDraft: DraftByAgent = {};
      rows.forEach((row) => {
        nextDraft[row.agent_id] = cloneProfile(row);
      });
      setOverview(data.overview);
      setDraft(nextDraft);
      setNotice(`已同步租户 ${data.tenant_id} 的龙虾技能沉淀池。`);
      if (!expandedAgentId && rows.length > 0) {
        setExpandedAgentId(rows[0].agent_id);
      }
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTenantId]);

  const summary = overview?.summary;
  const profileRows = useMemo(() => overview?.profiles ?? [], [overview]);
  const isAdmin = Boolean(
    currentUserQuery.data?.isAdmin ||
      currentUserQuery.data?.roles?.some((role) => String(role).toLowerCase() === 'admin'),
  );
  const ragPackMap = useMemo(() => {
    const rows = overview?.agent_rag_pack_summary ?? [];
    const map: Record<string, number> = {};
    rows.forEach((item) => {
      map[item.agent_id] = item.pack_count || 0;
    });
    return map;
  }, [overview]);

  const patchDraft = (agentId: string, patch: Partial<AgentExtensionProfile>) => {
    setDraft((prev) => {
      const current = prev[agentId];
      if (!current) return prev;
      return {
        ...prev,
        [agentId]: {
          ...current,
          ...patch,
        },
      };
    });
  };

  const patchSkill = (agentId: string, skillIndex: number, patch: Partial<AgentExtensionSkill>) => {
    setDraft((prev) => {
      const current = prev[agentId];
      if (!current) return prev;
      const skills = [...(current.skills || [])];
      skills[skillIndex] = { ...skills[skillIndex], ...patch };
      return { ...prev, [agentId]: { ...current, skills } };
    });
  };

  const patchNode = (agentId: string, nodeIndex: number, patch: Partial<AgentExtensionNode>) => {
    setDraft((prev) => {
      const current = prev[agentId];
      if (!current) return prev;
      const nodes = [...(current.nodes || [])];
      nodes[nodeIndex] = { ...nodes[nodeIndex], ...patch };
      return { ...prev, [agentId]: { ...current, nodes } };
    });
  };

  const addSkill = (agentId: string) => {
    setDraft((prev) => {
      const current = prev[agentId];
      if (!current) return prev;
      return {
        ...prev,
        [agentId]: {
          ...current,
          skills: [
            ...(current.skills || []),
            {
              skill_id: '',
              name: '',
              capability: '',
              node_id: '',
              enabled: true,
              runtime: 'python',
              required: false,
              entrypoint: '',
              description: '',
              config: {},
            },
          ],
        },
      };
    });
  };

  const addNode = (agentId: string) => {
    setDraft((prev) => {
      const current = prev[agentId];
      if (!current) return prev;
      return {
        ...prev,
        [agentId]: {
          ...current,
          nodes: [
            ...(current.nodes || []),
            {
              node_id: '',
              type: 'transform',
              title: '',
              enabled: true,
              timeout_sec: 120,
              retry_limit: 2,
              config: {},
            },
          ],
        },
      };
    });
  };

  const saveAgentProfile = async (agentId: string) => {
    const row = draft[agentId];
    if (!row) return;
    setSaving((prev) => ({ ...prev, [agentId]: true }));
    try {
      const payload = {
        tenant_id: currentTenantId,
        enabled: row.enabled,
        profile_version: row.profile_version || 'openclaw-native-v1',
        runtime_mode: row.runtime_mode || 'hybrid',
        role_prompt: row.role_prompt || '',
        run_contract: row.run_contract || {},
        skills: (row.skills || []).map((item) => ({
          ...item,
          skill_id: String(item.skill_id || '').trim(),
          name: String(item.name || '').trim(),
          capability: String(item.capability || '').trim(),
          node_id: String(item.node_id || '').trim(),
        })),
        nodes: (row.nodes || []).map((item) => ({
          ...item,
          node_id: String(item.node_id || '').trim(),
          type: String(item.type || '').trim(),
          title: String(item.title || '').trim(),
        })),
        hooks: row.hooks || {},
        limits: row.limits || {},
        tags: (row.tags || []).map((item) => String(item || '').trim()).filter(Boolean),
      };
      await updateAiAgentExtensionProfile(agentId, payload);
      setNotice(`已保存 ${AGENT_LABELS[agentId] || agentId} 的扩展配置。`);
      await refresh();
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setSaving((prev) => ({ ...prev, [agentId]: false }));
    }
  };

  const resetToDefault = (agentId: string) => {
    const defaults = overview?.catalog?.default_profiles ?? [];
    const target = defaults.find((item) => item.agent_id === agentId);
    if (!target) return;
    setDraft((prev) => ({ ...prev, [agentId]: cloneProfile(target) }));
  };

  const handleApproveSkill = async (skillId: string) => {
    if (!skillId.trim()) return;
    setApproving((prev) => ({ ...prev, [skillId]: true }));
    setErrorText('');
    try {
      await approveSkill(skillId);
      setNotice(`已审批技能 ${skillId}。`);
      await refresh();
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setApproving((prev) => ({ ...prev, [skillId]: false }));
    }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-slate-950 p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-100">{t('title')}</h1>
              <p className="mt-1 text-sm text-slate-400">
                {t('description')}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-slate-500/60 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800"
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} />
              {t('buttons.refresh')}
            </button>
          </div>

          <div className="mt-2 text-xs text-slate-400">{loading ? '同步中…' : notice || `租户：${currentTenantId}`}</div>

          {errorText ? (
            <div className="mt-3 flex items-start gap-2 rounded border border-amber-500/50 bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{errorText}</span>
            </div>
          ) : null}

          {summary ? (
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-7">
              <MetricCard label="元老总数" value={summary.agents_total} />
              <MetricCard label="启用元老" value={summary.agents_enabled} />
              <MetricCard label="技能总数" value={summary.skills_total} />
              <MetricCard label="节点总数" value={summary.nodes_total} />
              <MetricCard label="行业知识库" value={summary.kb_profiles_total} />
              <MetricCard label="RAG 知识包" value={summary.rag_packs_total} />
              <MetricCard label="工作流模板" value={summary.workflow_templates_total} />
            </div>
          ) : null}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-3">
            <h2 className="mb-2 text-lg font-semibold text-slate-100">总脑 + 9 元老扩展配置（列表 + 单项下拉编辑）</h2>
            <div className="space-y-2">
              {profileRows.map((row) => {
                const profile = draft[row.agent_id];
                if (!profile) return null;
                const expanded = expandedAgentId === row.agent_id;
                const friendly = AGENT_LABELS[row.agent_id] || row.agent_id;
                const llmBinding = overview?.llm_bindings?.find((item) => item.agent_id === row.agent_id);
                return (
                  <div key={row.agent_id} className="rounded-xl border border-slate-700/40 bg-slate-950/70">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                      onClick={() => setExpandedAgentId(expanded ? null : row.agent_id)}
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-100">
                          {friendly}
                          <span className="ml-2 text-xs text-slate-400">({row.agent_id})</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {profile.enabled ? '已启用' : '未启用'} · {runtimeModeLabel(profile.runtime_mode)} · 技能 {row.skills_count} · 节点{' '}
                          {row.nodes_count} · 知识包 {ragPackMap[row.agent_id] ?? 0}
                          {llmBinding ? ` · 模型 ${llmBinding.provider_id}/${llmBinding.model_name || '-'}` : ''}
                        </div>
                      </div>
                      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {expanded ? (
                      <div className="space-y-3 border-t border-slate-700/40 px-3 pb-3 pt-3">
                        <div className="grid gap-2 md:grid-cols-3">
                          <label className="text-xs text-slate-300">
                            启用
                            <div className="mt-1">
                              <input
                                type="checkbox"
                                checked={profile.enabled}
                                onChange={(e) => patchDraft(row.agent_id, { enabled: e.target.checked })}
                              />
                            </div>
                          </label>
                          <label className="text-xs text-slate-300">
                            运行模式
                            <select
                              value={profile.runtime_mode}
                              onChange={(e) =>
                                patchDraft(row.agent_id, {
                                  runtime_mode: e.target.value as AgentExtensionProfile['runtime_mode'],
                                })
                              }
                              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                            >
                              <option value="hybrid">混合</option>
                              <option value="local">本地</option>
                              <option value="cloud">云端</option>
                            </select>
                          </label>
                          <label className="text-xs text-slate-300">
                            策略版本
                            <input
                              value={profile.profile_version}
                              onChange={(e) => patchDraft(row.agent_id, { profile_version: e.target.value })}
                              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                            />
                          </label>
                        </div>

                        <label className="block text-xs text-slate-300">
                          角色提示词（可扩展）
                          <textarea
                            value={profile.role_prompt || ''}
                            onChange={(e) => patchDraft(row.agent_id, { role_prompt: e.target.value })}
                            rows={3}
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                          />
                        </label>

                        <label className="block text-xs text-slate-300">
                          标签（逗号分隔）
                          <input
                            value={(profile.tags || []).join(', ')}
                            onChange={(e) =>
                              patchDraft(row.agent_id, {
                                tags: e.target.value
                                  .split(',')
                                  .map((item) => item.trim())
                                  .filter(Boolean),
                              })
                            }
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                          />
                        </label>

                        <label className="block text-xs text-slate-300">
                          运行契约（JSON）
                          <textarea
                            value={JSON.stringify(profile.run_contract || {}, null, 2)}
                            onChange={(e) => {
                              try {
                                patchDraft(row.agent_id, { run_contract: JSON.parse(e.target.value) });
                              } catch {
                                patchDraft(row.agent_id, { run_contract: profile.run_contract || {} });
                              }
                            }}
                            rows={10}
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
                          />
                        </label>

                        <div>
                          <div className="mb-1 flex items-center justify-between">
                            <p className="text-xs font-semibold text-cyan-200">技能清单</p>
                            <button
                              type="button"
                              className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-200"
                              onClick={() => addSkill(row.agent_id)}
                            >
                              {t('buttons.addSkill')}
                            </button>
                          </div>
                          <div className="space-y-1">
                            {(profile.skills || []).map((skill, index) => (
                              <div key={`${row.agent_id}-skill-${index}`} className="grid gap-1 md:grid-cols-5">
                                <div className="md:col-span-5 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700/60 bg-slate-950/60 px-3 py-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-medium text-slate-100">
                                      {skill.name || skill.skill_id || `Skill ${index + 1}`}
                                    </div>
                                    <SkillPublishStatusBadge status={skill.publish_status} />
                                  </div>
                                  {skill.publish_status === 'review' && isAdmin ? (
                                    <button
                                      type="button"
                                      onClick={() => void handleApproveSkill(skill.skill_id)}
                                      disabled={approving[skill.skill_id]}
                                      className="inline-flex items-center gap-1 rounded-xl bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60"
                                    >
                                      <CheckCircle className="h-3 w-3" />
                                      {approving[skill.skill_id] ? '审批中...' : '审批通过'}
                                    </button>
                                  ) : null}
                                </div>
                                <input
                                  value={skill.skill_id || ''}
                                  onChange={(e) => patchSkill(row.agent_id, index, { skill_id: e.target.value })}
                                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                  placeholder="技能 ID"
                                />
                                <input
                                  value={skill.name || ''}
                                  onChange={(e) => patchSkill(row.agent_id, index, { name: e.target.value })}
                                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                  placeholder="技能名称"
                                />
                                <input
                                  value={skill.capability || ''}
                                  onChange={(e) => patchSkill(row.agent_id, index, { capability: e.target.value })}
                                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                  placeholder="能力说明"
                                />
                                <input
                                  value={skill.node_id || ''}
                                  onChange={(e) => patchSkill(row.agent_id, index, { node_id: e.target.value })}
                                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                  placeholder="节点 ID"
                                />
                                <label className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-200">
                                  <input
                                    type="checkbox"
                                    checked={skill.enabled !== false}
                                    onChange={(e) => patchSkill(row.agent_id, index, { enabled: e.target.checked })}
                                  />
                                  启用
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="mb-1 flex items-center justify-between">
                            <p className="text-xs font-semibold text-fuchsia-200">节点清单</p>
                            <button
                              type="button"
                              className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-200"
                              onClick={() => addNode(row.agent_id)}
                            >
                              {t('buttons.addNode')}
                            </button>
                          </div>
                          <div className="space-y-1">
                            {(profile.nodes || []).map((node, index) => (
                              <div key={`${row.agent_id}-node-${index}`} className="grid gap-1 md:grid-cols-5">
                                <input
                                  value={node.node_id || ''}
                                  onChange={(e) => patchNode(row.agent_id, index, { node_id: e.target.value })}
                                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                  placeholder="节点 ID"
                                />
                                <input
                                  value={node.type || ''}
                                  onChange={(e) => patchNode(row.agent_id, index, { type: e.target.value })}
                                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                  placeholder="节点类型"
                                />
                                <input
                                  value={node.title || ''}
                                  onChange={(e) => patchNode(row.agent_id, index, { title: e.target.value })}
                                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                  placeholder="节点标题"
                                />
                                <input
                                  type="number"
                                  value={node.timeout_sec ?? 120}
                                  onChange={(e) => patchNode(row.agent_id, index, { timeout_sec: Number(e.target.value) || 120 })}
                                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                  placeholder="超时时间"
                                />
                                <label className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-200">
                                  <input
                                    type="checkbox"
                                    checked={node.enabled !== false}
                                    onChange={(e) => patchNode(row.agent_id, index, { enabled: e.target.checked })}
                                  />
                                  启用
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void saveAgentProfile(row.agent_id)}
                            disabled={saving[row.agent_id]}
                            className="inline-flex items-center gap-1 rounded border border-cyan-500/70 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60"
                          >
                            <Save size={14} />
                            {saving[row.agent_id] ? t('buttons.saving') : t('buttons.save')}
                          </button>
                          <button
                            type="button"
                            onClick={() => resetToDefault(row.agent_id)}
                            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                          >
                            {t('buttons.reset')}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <section className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-3">
              <h3 className="text-sm font-semibold text-slate-100">行业知识概览</h3>
              <p className="mt-1 text-xs text-slate-400">已将行业知识库与元老扩展配置聚合，便于统一调用与审计。</p>
              <div className="mt-2 text-xs text-slate-200">知识库数量：{summary?.kb_profiles_total ?? 0}</div>
              <div className="mt-1 text-xs text-slate-200">RAG 包总量：{summary?.rag_packs_total ?? 0}</div>
            </section>

            <section className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-3">
              <h3 className="text-sm font-semibold text-slate-100">模板分布</h3>
              <div className="mt-2 space-y-1 text-xs text-slate-300">
                {Object.keys(overview?.workflow_templates_by_industry || {}).length === 0 ? (
                  <p className="text-slate-500">暂无模板</p>
                ) : (
                  Object.entries(overview?.workflow_templates_by_industry || {}).map(([tag, count]) => (
                    <div key={tag} className="flex items-center justify-between rounded border border-slate-700/40 px-2 py-1">
                      <span>{tag}</span>
                      <span>{count}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/70 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-slate-100">{value}</div>
    </div>
  );
}
