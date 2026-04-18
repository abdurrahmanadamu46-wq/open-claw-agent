'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, RefreshCw, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/contexts/TenantContext';
import { SkillPublishStatusBadge } from '@/components/business/SkillPublishStatusBadge';
import {
  approveSkill,
  fetchSkills,
  fetchAiSkillsPoolOverview,
  rescanSkill,
  updateSkillStatus,
  updateAiAgentExtensionProfile,
  type AgentExtensionNode,
  type AgentExtensionProfile,
  type AgentExtensionSkill,
} from '@/services/endpoints/ai-subservice';
import type { LobsterSkill } from '@/types/lobster';
import { getCurrentUser } from '@/services/endpoints/user';
import {
  downloadGovernanceExport,
  formatGovernanceExportNotice,
  GOVERNANCE_COPY_REPORT_LABEL,
  GOVERNANCE_ISSUES_FILTER_LABEL,
  GOVERNANCE_VIEW_REPORT_LABEL,
} from '@/lib/governance';
import { getLobsterRoleMeta, orderAgentIds } from '@/lib/lobster-skills';
import { isDemoMode } from '@/services/demo-mode';

type SkillPoolOverview = Awaited<ReturnType<typeof fetchAiSkillsPoolOverview>>['overview'];

type DraftByAgent = Record<string, AgentExtensionProfile>;

function getAgentLabel(agentId?: string): string {
  if (!agentId) return '未绑定';
  const sharedLabel = getLobsterRoleMeta(agentId).zhName;
  return sharedLabel || agentId;
}

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

function skillScanTone(status?: string): string {
  switch (status) {
    case 'block':
      return 'bg-rose-500/15 text-rose-200';
    case 'warn':
      return 'bg-amber-400/15 text-amber-200';
    case 'safe':
      return 'bg-emerald-500/15 text-emerald-200';
    default:
      return 'bg-slate-700 text-slate-300';
  }
}

function roleLabelFromSkill(skill: LobsterSkill): string {
  const owner = skill.bound_lobsters?.[0];
  return getAgentLabel(owner);
}

function skillConditionSummary(skill: LobsterSkill): string {
  const applies = skill.applies_when || {};
  const taskTypes = Array.isArray(applies.task_types) ? applies.task_types.slice(0, 2) : [];
  const channels = Array.isArray(applies.channels) ? applies.channels.slice(0, 2) : [];
  const segments = [];
  if (taskTypes.length) segments.push(`task ${taskTypes.join('/')}`);
  if (channels.length) segments.push(`channel ${channels.join('/')}`);
  return segments.join(' | ');
}

function formatEffectiveConditionEntries(skill: LobsterSkill): Array<{ label: string; value: string }> {
  const conditions = skill.effective_conditions || {};
  return Object.entries(conditions)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .map(([key, value]) => ({
      label: key.replace(/_/g, ' '),
      value: String(value),
    }));
}

function summarizeScanResult(payload?: {
  scan_status?: string;
  scan_report?: { issues?: string[]; confidence?: number };
}): string {
  const status = String(payload?.scan_status || 'not_scanned');
  const issueCount = payload?.scan_report?.issues?.length ?? 0;
  const confidence =
    typeof payload?.scan_report?.confidence === 'number'
      ? `，置信度 ${(payload.scan_report.confidence * 100).toFixed(0)}%`
      : '';
  return `scan=${status}，问题 ${issueCount} 个${confidence}`;
}

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
  const [registrySkills, setRegistrySkills] = useState<LobsterSkill[]>([]);
  const [draft, setDraft] = useState<DraftByAgent>({});
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [expandedRegistrySkillId, setExpandedRegistrySkillId] = useState<string | null>(null);
  const [selectedRegistryRole, setSelectedRegistryRole] = useState<string>('all');
  const [selectedPublishStatus, setSelectedPublishStatus] = useState<string>('all');
  const [selectedScanStatus, setSelectedScanStatus] = useState<string>('all');
  const [activeScanSkill, setActiveScanSkill] = useState<LobsterSkill | null>(null);
  const [errorText, setErrorText] = useState('');

  const refresh = async () => {
    if (isDemoMode()) {
      setOverview(null);
      setRegistrySkills([]);
      setDraft({});
      setExpandedAgentId(null);
      setErrorText('');
      setNotice('当前处于演示壳模式，技能池不会主动请求真实 skills 接口；真实联调环境会在这里展示角色技能、发布状态和扫描报告。');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorText('');
    try {
      const [data, registryData] = await Promise.all([
        fetchAiSkillsPoolOverview(currentTenantId),
        fetchSkills({ enabled_only: false }),
      ]);
      const rows = data?.overview?.profiles ?? [];
      const nextDraft: DraftByAgent = {};
      rows.forEach((row) => {
        nextDraft[row.agent_id] = cloneProfile(row);
      });
      setOverview(data.overview);
      setRegistrySkills(registryData.skills || []);
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
  const filteredRegistrySkills = useMemo(() => {
    return registrySkills.filter((skill) => {
      const roleOk = selectedRegistryRole === 'all' || skill.bound_lobsters?.includes(selectedRegistryRole);
      const publishOk = selectedPublishStatus === 'all' || String(skill.publish_status || 'draft') === selectedPublishStatus;
      const scanStatus = String(skill.scan_status || 'not_scanned');
      const scanOk =
        selectedScanStatus === 'all'
          ? true
          : selectedScanStatus === 'issues'
            ? scanStatus === 'warn' || scanStatus === 'block'
            : scanStatus === selectedScanStatus;
      return Boolean(roleOk && publishOk && scanOk);
    });
  }, [registrySkills, selectedRegistryRole, selectedPublishStatus, selectedScanStatus]);
  const filteredReviewQueue = useMemo(() => {
    return filteredRegistrySkills.filter((skill) => skill.publish_status === 'review');
  }, [filteredRegistrySkills]);
  const filteredRiskQueue = useMemo(() => {
    return filteredRegistrySkills.filter((skill) => skill.scan_status === 'warn' || skill.scan_status === 'block');
  }, [filteredRegistrySkills]);
  const availableRegistryRoleIds = useMemo(
    () =>
      orderAgentIds(
        Array.from(
          new Set([
            ...profileRows.map((row) => row.agent_id),
            ...registrySkills.flatMap((skill) => skill.bound_lobsters || []),
          ]),
        ),
      ),
    [profileRows, registrySkills],
  );

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
      setNotice(`已保存 ${getAgentLabel(agentId)} 的扩展配置。`);
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
      const result = await approveSkill(skillId);
      setNotice(`已审批技能 ${skillId}，${summarizeScanResult(result)}。`);
      await refresh();
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setApproving((prev) => ({ ...prev, [skillId]: false }));
    }
  };

  const handleSkillStatusChange = async (
    skillId: string,
    status: 'draft' | 'review' | 'approved' | 'deprecated',
    successText: string,
  ) => {
    if (!skillId.trim()) return;
    setApproving((prev) => ({ ...prev, [skillId]: true }));
    setErrorText('');
    try {
      await updateSkillStatus(skillId, status);
      setNotice(successText);
      await refresh();
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setApproving((prev) => ({ ...prev, [skillId]: false }));
    }
  };

  const handleSkillRescan = async (skillId: string) => {
    if (!skillId.trim()) return;
    setApproving((prev) => ({ ...prev, [skillId]: true }));
    setErrorText('');
    try {
      const result = await rescanSkill(skillId);
      setNotice(`已重新扫描技能 ${skillId}，${summarizeScanResult(result)}。`);
      await refresh();
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setApproving((prev) => ({ ...prev, [skillId]: false }));
    }
  };

  const handleCopyScanIssues = async (skill: LobsterSkill) => {
    const issues = (skill.scan_report?.issues || []).filter(Boolean);
    if (issues.length === 0) {
      setNotice(`技能 ${skill.id} 当前没有可复制的 scan 问题。`);
      return;
    }
    const content = [`${skill.name} (${skill.id})`, ...issues.map((issue, index) => `${index + 1}. ${issue}`)].join('\n');
    try {
      await navigator.clipboard.writeText(content);
      setNotice(`已复制技能 ${skill.id} 的 ${issues.length} 条 scan 问题。`);
    } catch {
      setErrorText(`复制技能 ${skill.id} 的 scan 问题失败，请检查浏览器剪贴板权限。`);
    }
  };

  const handleCopyScanJson = async (skill: LobsterSkill) => {
    const report = skill.scan_report || {};
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setNotice('已复制技能 ' + skill.id + ' 的 scan JSON。');
    } catch {
      setErrorText('复制技能 ' + skill.id + ' 的 scan JSON 失败，请检查浏览器剪贴板权限。');
    }
  };

  const handleCopyFullScanReport = async (skill: LobsterSkill) => {
    const report = skill.scan_report || {};
    const issues = Array.isArray(report.issues) ? report.issues : [];
    const content = [
      '技能: ' + skill.name,
      'ID: ' + skill.id,
      '角色: ' + roleLabelFromSkill(skill),
      'publish_status: ' + (skill.publish_status || 'draft'),
      'scan_status: ' + (skill.scan_status || 'not_scanned'),
      typeof report.confidence === 'number' ? 'confidence: ' + (report.confidence * 100).toFixed(0) + '%' : null,
      '',
      'Issues:',
      ...(issues.length ? issues.map((issue, index) => `${index + 1}. ${issue}`) : ['(none)']),
      '',
      'Raw JSON:',
      JSON.stringify(report, null, 2),
    ]
      .filter((line) => line !== null)
      .join('\n');
    try {
      await navigator.clipboard.writeText(content);
      setNotice('已复制技能 ' + skill.id + ' 的完整 scan 报告。');
    } catch {
      setErrorText('复制技能 ' + skill.id + ' 的完整 scan 报告失败，请检查浏览器剪贴板权限。');
    }
  };

  const handleExportFilteredSkills = () => {
    downloadGovernanceExport({
      filename: `skills-pool-${selectedRegistryRole}-${selectedPublishStatus}-${selectedScanStatus}.json`,
      surface: 'skills_pool',
      filters: {
        tenant_id: currentTenantId,
        role: selectedRegistryRole,
        publish_status: selectedPublishStatus,
        scan_status: selectedScanStatus,
      },
      items: filteredRegistrySkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        role: roleLabelFromSkill(skill),
        publish_status: skill.publish_status || 'draft',
        scan_status: skill.scan_status || 'not_scanned',
        priority: skill.priority || '',
        stability: skill.stability || '',
        core_brain_version: skill.core_brain_version || '',
        rollback_to: skill.rollback_to || '',
        voice_profile_ref: skill.voice_profile_ref || '',
        applies_when: skill.applies_when || {},
        effective_conditions: skill.effective_conditions || {},
        gotchas: skill.gotchas || [],
        scan_report: skill.scan_report || {},
      })),
    });
    setNotice(formatGovernanceExportNotice(filteredRegistrySkills.length));
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

          <div className="mt-2 text-xs text-slate-400">{loading ? '同步中...' : notice || ['租户：', currentTenantId].join('')}</div>

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
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <MetricCard label="真实技能总数" value={filteredRegistrySkills.length} />
            <MetricCard label="待审批技能" value={filteredReviewQueue.length} />
            <MetricCard label="风险技能" value={filteredRiskQueue.length} />
            <MetricCard label="已接 voice profile" value={filteredRegistrySkills.filter((skill) => Boolean(skill.voice_profile_ref)).length} />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-3">
            <h2 className="mb-2 text-lg font-semibold text-slate-100">总脑 + 9 元老扩展配置（列表 + 单项下拉编辑）</h2>
            <div className="space-y-2">
              {profileRows.map((row) => {
                const profile = draft[row.agent_id];
                if (!profile) return null;
                const expanded = expandedAgentId === row.agent_id;
                const friendly = getAgentLabel(row.agent_id);
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
                          {profile.enabled ? '已启用' : '未启用'} | {runtimeModeLabel(profile.runtime_mode)} | 技能 {row.skills_count} | 节点{' '}
                          {row.nodes_count} | 知识包 {ragPackMap[row.agent_id] ?? 0}
                          {llmBinding ? ' | 模型 ' + llmBinding.provider_id + '/' + (llmBinding.model_name || '-') : ''}
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
                              <div key={row.agent_id + '-skill-' + index} className="grid gap-1 md:grid-cols-5">
                                <div className="md:col-span-5 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700/60 bg-slate-950/60 px-3 py-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-medium text-slate-100">
                                      {skill.name || skill.skill_id || 'Skill ' + (index + 1)}
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
                              <div key={row.agent_id + '-node-' + index} className="grid gap-1 md:grid-cols-5">
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
              <h3 className="text-sm font-semibold text-slate-100">真实技能注册表</h3>
              <p className="mt-1 text-xs text-slate-400">这里显示 lobster_skill_registry 的真实技能对象，scan 与审批都以这一层为准。</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500">当前过滤：{selectedRegistryRole === 'all' ? '全部角色' : getAgentLabel(selectedRegistryRole)}</div>
                <label className="text-xs text-slate-300">
                  角色过滤
                  <select
                    value={selectedRegistryRole}
                    onChange={(e) => setSelectedRegistryRole(e.target.value)}
                    className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="all">全部角色</option>
                    {availableRegistryRoleIds
                      .filter((key) => key !== 'feedback')
                      .map((key) => (
                        <option key={key} value={key}>
                          {getAgentLabel(key)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-xs text-slate-300">
                  发布状态
                  <select
                    value={selectedPublishStatus}
                    onChange={(e) => setSelectedPublishStatus(e.target.value)}
                    className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="all">全部</option>
                    <option value="draft">draft</option>
                    <option value="review">review</option>
                    <option value="approved">approved</option>
                    <option value="deprecated">deprecated</option>
                  </select>
                </label>
                <label className="text-xs text-slate-300">
                  扫描状态
                  <select
                    value={selectedScanStatus}
                    onChange={(e) => setSelectedScanStatus(e.target.value)}
                    className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="all">全部</option>
                    <option value="issues">{GOVERNANCE_ISSUES_FILTER_LABEL}</option>
                    <option value="not_scanned">not_scanned</option>
                    <option value="safe">safe</option>
                    <option value="warn">warn</option>
                    <option value="block">block</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setSelectedScanStatus('issues')}
                  className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-100 hover:bg-amber-500/15"
                >
                  只看有问题技能
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRegistryRole('all');
                    setSelectedPublishStatus('all');
                    setSelectedScanStatus('all');
                  }}
                  className="rounded border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-200 hover:bg-white/10"
                >
                  清空过滤
                </button>
                <button
                  type="button"
                  onClick={handleExportFilteredSkills}
                  className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100 hover:bg-cyan-500/15"
                >
                  导出当前结果
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {filteredRegistrySkills.length === 0 ? (
                  <div className="text-xs text-slate-500">暂无技能注册数据</div>
                ) : (
                  filteredRegistrySkills.slice(0, 10).map((skill) => (
                    <div key={skill.id} className="rounded-xl border border-slate-700/50 bg-slate-950/60 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-slate-100">{skill.name}</div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {skill.id} 路 {roleLabelFromSkill(skill)}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <SkillPublishStatusBadge status={skill.publish_status} />
                          <span className={'rounded-full px-3 py-1 text-xs ' + skillScanTone(skill.scan_status)}>
                            scan {skill.scan_status || 'not_scanned'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-3">
              <h3 className="text-sm font-semibold text-slate-100">待审批与高风险技能</h3>
              <div className="mt-3 space-y-2">
                {[...filteredReviewQueue, ...filteredRiskQueue.filter((skill) => skill.publish_status !== 'review')]
                  .slice(0, 12)
                  .map((skill) => (
                    <div key={skill.id} className="rounded-xl border border-slate-700/50 bg-slate-950/60 px-3 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-slate-100">{skill.name}</div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {skill.id} 路 {roleLabelFromSkill(skill)}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <SkillPublishStatusBadge status={skill.publish_status} />
                          <span className={'rounded-full px-3 py-1 text-xs ' + skillScanTone(skill.scan_status)}>
                            scan {skill.scan_status || 'not_scanned'}
                          </span>
                        </div>
                      </div>
                      {skill.scan_report?.issues?.length ? (
                        <div className="mt-2 space-y-1">
                          {skill.scan_report.issues.slice(0, 2).map((issue) => (
                            <div key={issue} className="rounded-lg bg-slate-900 px-2 py-1 text-xs text-amber-200">{issue}</div>
                          ))}
                        </div>
                      ) : null}
                      {skill.publish_status === 'review' && isAdmin ? (
                        <button
                          type="button"
                          onClick={() => void handleApproveSkill(skill.id)}
                          disabled={approving[skill.id]}
                          className="mt-3 inline-flex items-center gap-1 rounded-xl bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60"
                        >
                          <CheckCircle className="h-3 w-3" />
                          {approving[skill.id] ? '审批中...' : '审批通过并触发扫描'}
                        </button>
                      ) : null}
                      {skill.scan_report?.issues?.length ? (
                        <button
                          type="button"
                          onClick={() => void handleCopyScanIssues(skill)}
                          className="mt-3 ml-2 inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/15"
                        >
                          复制问题
                        </button>
                      ) : null}
                      {skill.scan_report ? (
                        <button
                          type="button"
                          onClick={() => setActiveScanSkill(skill)}
                          className="mt-3 ml-2 inline-flex items-center gap-1 rounded-xl bg-violet-500/15 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/25"
                        >
                          {GOVERNANCE_VIEW_REPORT_LABEL}
                        </button>
                      ) : null}
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => void handleSkillRescan(skill.id)}
                          disabled={approving[skill.id]}
                          className="mt-3 ml-2 inline-flex items-center gap-1 rounded-xl bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-60"
                        >
                          {approving[skill.id] ? '处理中...' : '重新扫描'}
                        </button>
                      ) : null}
                      {isAdmin && skill.publish_status === 'draft' ? (
                        <button
                          type="button"
                          onClick={() => void handleSkillStatusChange(skill.id, 'review', '已将技能 ' + skill.id + ' 送入审核。')}
                          disabled={approving[skill.id]}
                          className="mt-3 ml-2 inline-flex items-center gap-1 rounded-xl bg-amber-500/15 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/25 disabled:opacity-60"
                        >
                          {approving[skill.id] ? '处理中...' : '送审'}
                        </button>
                      ) : null}
                      {isAdmin && skill.publish_status === 'approved' ? (
                        <button
                          type="button"
                          onClick={() => void handleSkillStatusChange(skill.id, 'deprecated', '已将技能 ' + skill.id + ' 标记为废弃。')}
                          disabled={approving[skill.id]}
                          className="mt-3 ml-2 inline-flex items-center gap-1 rounded-xl bg-rose-500/15 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/25 disabled:opacity-60"
                        >
                          {approving[skill.id] ? '处理中...' : '下线'}
                        </button>
                      ) : null}
                      {isAdmin && skill.publish_status === 'deprecated' ? (
                        <button
                          type="button"
                          onClick={() => void handleSkillStatusChange(skill.id, 'draft', '已将技能 ' + skill.id + ' 回退到草稿。')}
                          disabled={approving[skill.id]}
                          className="mt-3 ml-2 inline-flex items-center gap-1 rounded-xl bg-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-60"
                        >
                          {approving[skill.id] ? '处理中...' : '回到草稿'}
                        </button>
                      ) : null}
                    </div>
                  ))}
                {filteredReviewQueue.length === 0 && filteredRiskQueue.length === 0 ? (
                  <div className="text-xs text-slate-500">当前没有待审批或高风险技能。</div>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-3">
              <h3 className="text-sm font-semibold text-slate-100">真实技能详情</h3>
              <p className="mt-1 text-xs text-slate-400">展开查看稳定性、回退版本、voice profile、适用条件与 gotchas。</p>
              <div className="mt-3 space-y-2">
                {filteredRegistrySkills.slice(0, 6).map((skill) => (
                  <div key={'detail-' + skill.id} className="rounded-xl border border-slate-700/50 bg-slate-950/60">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                      onClick={() => setExpandedRegistrySkillId(expandedRegistrySkillId === skill.id ? null : skill.id)}
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-100">{skill.name}</div>
                        <div className="mt-1 text-[11px] text-slate-400">
                          {skill.id} / {roleLabelFromSkill(skill)}
                          {skillConditionSummary(skill) ? ' / ' + skillConditionSummary(skill) : ''}
                        </div>
                      </div>
                      {expandedRegistrySkillId === skill.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {expandedRegistrySkillId === skill.id ? (
                      <div className="space-y-2 border-t border-slate-700/50 px-3 py-3 text-xs text-slate-300">
                        <div className="flex flex-wrap gap-2">
                          <SkillPublishStatusBadge status={skill.publish_status} />
                          <span className={'rounded-full px-3 py-1 ' + skillScanTone(skill.scan_status)}>
                            scan {skill.scan_status || 'not_scanned'}
                          </span>
                          {skill.priority ? <span className="rounded-full bg-white/10 px-2 py-1">priority {skill.priority}</span> : null}
                          {skill.stability ? <span className="rounded-full bg-white/10 px-2 py-1">stability {skill.stability}</span> : null}
                        </div>
                        {skill.core_brain_version ? <div>core brain：{skill.core_brain_version}</div> : null}
                        {skill.rollback_to ? <div>rollback：{skill.rollback_to}</div> : null}
                        {skill.voice_profile_ref ? <div>voice profile：{skill.voice_profile_ref}</div> : null}
                        {isAdmin ? (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => void handleSkillRescan(skill.id)}
                              disabled={approving[skill.id]}
                              className="inline-flex items-center gap-1 rounded-xl bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-60"
                            >
                              {approving[skill.id] ? '处理中...' : '重新扫描'}
                            </button>
                          </div>
                        ) : null}
                        {skill.applies_when ? (
                          <div className="space-y-1">
                            <div className="text-slate-400">applies when</div>
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(skill.applies_when)
                                .filter(([, values]) => Array.isArray(values) && values.length > 0)
                                .flatMap(([key, values]) =>
                                  values.slice(0, 4).map((value) => (
                                    <span key={skill.id + '-' + key + '-' + value} className="rounded-full bg-cyan-500/10 px-2 py-1 text-cyan-200">
                                      {key}: {value}
                                    </span>
                                  )),
                                )}
                            </div>
                          </div>
                        ) : null}
                        {formatEffectiveConditionEntries(skill).length ? (
                          <div className="space-y-1">
                            <div className="text-slate-400">effective conditions</div>
                            <div className="flex flex-wrap gap-2">
                              {formatEffectiveConditionEntries(skill).map((item) => (
                                <span key={skill.id + '-' + item.label + '-' + item.value} className="rounded-full bg-fuchsia-500/10 px-2 py-1 text-fuchsia-200">
                                  {item.label}: {item.value}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {skill.gotchas?.length ? (
                          <div className="space-y-1">
                            {skill.gotchas.slice(0, 2).map((item) => (
                              <div key={item} className="rounded-lg bg-slate-900 px-2 py-1 text-amber-200">{item}</div>
                            ))}
                          </div>
                        ) : null}
                        {skill.scan_report?.issues?.length ? (
                          <div className="space-y-1">
                            {skill.scan_report.issues.slice(0, 2).map((issue) => (
                              <div key={issue} className="rounded-lg bg-slate-900 px-2 py-1 text-rose-200">{issue}</div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-slate-500">未发现明显 scan 风险。</div>
                        )}
                        {skill.scan_report?.issues?.length ? (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => void handleCopyScanIssues(skill)}
                              className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/15"
                            >
                              复制问题
                            </button>
                          </div>
                        ) : null}
                        {skill.scan_report ? (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => setActiveScanSkill(skill)}
                              className="inline-flex items-center gap-1 rounded-xl bg-violet-500/15 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/25"
                            >
                              {GOVERNANCE_VIEW_REPORT_LABEL}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

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
      {activeScanSkill ? (
        <ScanReportDialog
          skill={activeScanSkill}
          onClose={() => setActiveScanSkill(null)}
          onCopyIssues={() => void handleCopyScanIssues(activeScanSkill)}
          onCopyJson={() => void handleCopyScanJson(activeScanSkill)}
          onCopyFullReport={() => void handleCopyFullScanReport(activeScanSkill)}
        />
      ) : null}
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

function ScanReportDialog({
  skill,
  onClose,
  onCopyIssues,
  onCopyJson,
  onCopyFullReport,
}: {
  skill: LobsterSkill;
  onClose: () => void;
  onCopyIssues: () => void;
  onCopyJson: () => void;
  onCopyFullReport: () => void;
}) {
  const report = skill.scan_report || {};
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const confidence = typeof report.confidence === 'number' ? report.confidence : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-[#0f172a] p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-violet-300">Scan Report</div>
            <div className="mt-2 text-xl font-semibold text-white">{skill.name}</div>
            <div className="mt-1 text-xs text-slate-400">
              {skill.id} / {roleLabelFromSkill(skill)} / {skill.scan_status || 'not_scanned'}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCopyJson}
              className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200"
            >
              复制 JSON
            </button>
            <button
              type="button"
              onClick={onCopyFullReport}
              className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200"
            >
              {GOVERNANCE_COPY_REPORT_LABEL}
            </button>
            {issues.length ? (
              <button
                type="button"
                onClick={onCopyIssues}
                className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200"
              >
                复制问题
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <SkillPublishStatusBadge status={skill.publish_status} />
          <span className={'rounded-full px-3 py-1 ' + skillScanTone(skill.scan_status)}>{skill.scan_status || 'not_scanned'}</span>
          {confidence !== null ? (
            <span className="rounded-full bg-white/10 px-3 py-1 text-slate-300">confidence {(confidence * 100).toFixed(0)}%</span>
          ) : null}
          <span className="rounded-full bg-white/10 px-3 py-1 text-slate-300">issues {issues.length}</span>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.95fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Issues</div>
            <div className="mt-3 space-y-2">
              {issues.length ? (
                issues.map((issue) => (
                  <div key={issue} className="rounded-xl bg-slate-950/40 px-3 py-2 text-sm text-slate-200">{issue}</div>
                ))
              ) : (
                <div className="text-sm text-slate-500">当前没有 scan issues。</div>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Raw JSON</div>
            <pre className="mt-3 max-h-[360px] overflow-auto rounded-xl bg-slate-950/40 p-3 text-xs text-slate-300">
              {JSON.stringify(report, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
