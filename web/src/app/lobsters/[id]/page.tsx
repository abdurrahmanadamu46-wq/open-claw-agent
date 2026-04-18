'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import {
  BookOpenText,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coins,
  Cpu,
  ScrollText,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { ArtifactRenderer } from '@/components/ArtifactRenderer';
import { DangerActionGuard } from '@/components/DangerActionGuard';
import {
  KnowledgeContextEvidence,
  resolveKnowledgeContext,
} from '@/components/knowledge/KnowledgeContextEvidence';
import { LobsterRadarChart } from '@/components/charts/LobsterRadarChart';
import { QualityScoreChart } from '@/components/charts/QualityScoreChart';
import { SupervisorCapabilityTree } from '@/components/lobster/SupervisorCapabilityTree';
import { useTenant } from '@/contexts/TenantContext';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { LobsterConfigForm, type LobsterConfigValues } from '@/components/lobster/forms/LobsterConfigForm';
import { LobsterEntityHeader } from '@/components/lobster/LobsterEntityHeader';
import { StatusCard } from '@/components/lobster/StatusCard';
import { getLobsterCapabilityProfile } from '@/lib/lobster-capability-tree';
import {
  fetchLobsterEntity,
  fetchLobsterEntityDocs,
  fetchLobsterEntityRuns,
  fetchLobsterEntitySkills,
  fetchLobsterEntityStats,
  fetchLobsterMetricsHistory,
  fetchLobsterQualityStats,
  submitLobsterFeedback,
  type LobsterEntityRow,
  updateLobsterLifecycle,
} from '@/services/endpoints/ai-subservice';
import {
  fetchControlPlaneTenantPrivateKnowledgeSummaries,
} from '@/services/endpoints/control-plane-overview';
import { triggerSuccessToast } from '@/services/api';
import type { ControlPlaneCollabSummaryEntry as GroupCollabTenantPrivateSummaryEntry } from '@/types/control-plane-overview';
import type { Lifecycle, LobsterEntity, LobsterRun, LobsterSkill } from '@/types/lobster';

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'skills', label: '技能' },
  { id: 'runs', label: '任务历史' },
  { id: 'knowledge', label: '知识内容' },
  { id: 'config', label: '配置' },
  { id: 'feedback', label: '反馈' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value)) return '-';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDuration(value?: number | null) {
  if (!Number.isFinite(Number(value))) return '-';
  const duration = Number(value);
  if (duration >= 1000) return `${(duration / 1000).toFixed(1)}s`;
  return `${Math.round(duration)}ms`;
}

function formatCurrency(value?: number | null) {
  if (!Number.isFinite(Number(value))) return '-';
  return `¥${Number(value).toFixed(2)}`;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeLifecycle(value: unknown): Lifecycle {
  return value === 'experimental' || value === 'deprecated' || value === 'production'
    ? value
    : 'production';
}

function getRunStatusTone(status?: string) {
  const normalized = String(status || '').toLowerCase();
  if (['success', 'completed', 'done', 'healthy'].includes(normalized)) {
    return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200';
  }
  if (['running', 'pending', 'queued', 'processing'].includes(normalized)) {
    return 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100';
  }
  if (['failed', 'error', 'timeout', 'cancelled'].includes(normalized)) {
    return 'border-rose-400/30 bg-rose-500/10 text-rose-200';
  }
  return 'border-slate-600 bg-slate-800/70 text-slate-200';
}

function getRatingTone(value?: number | null) {
  if (!Number.isFinite(Number(value))) return 'bg-slate-700 text-slate-300';
  const rating = Number(value);
  if (rating >= 8) return 'bg-emerald-500/15 text-emerald-200';
  if (rating >= 6) return 'bg-cyan-500/15 text-cyan-100';
  if (rating >= 4) return 'bg-amber-500/15 text-amber-200';
  return 'bg-rose-500/15 text-rose-200';
}

function EmptyPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 p-6 text-center">
      <div className="text-sm font-medium text-slate-200">{title}</div>
      <div className="mt-2 text-sm text-slate-400">{description}</div>
    </div>
  );
}

function SectionPanel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {subtitle ? <div className="mt-1 text-sm text-slate-400">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MetaPill({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 text-cyan-200">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</div>
        <div className="truncate text-sm font-medium text-white">{value}</div>
      </div>
    </div>
  );
}

function SkillCard({ skill }: { skill: LobsterSkill }) {
  const rating = Number(skill.effectiveness_rating || 0);
  const progress = Math.max(0, Math.min(100, rating * 10));

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-white">{skill.name || skill.id}</div>
        <span className={`rounded-full px-2.5 py-1 text-xs ${getRatingTone(rating)}`}>
          效能 {Number.isFinite(rating) ? rating.toFixed(1) : '-'}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-xs ${
            skill.enabled === false
              ? 'bg-rose-500/15 text-rose-200'
              : 'bg-emerald-500/15 text-emerald-200'
          }`}
        >
          {skill.enabled === false ? '已停用' : '已启用'}
        </span>
      </div>
      <div className="mt-2 text-xs text-slate-400">{skill.category || '未分类'}</div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function CollabKnowledgeEvidenceCard({ item }: { item: GroupCollabTenantPrivateSummaryEntry }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white">{item.sourceType}</div>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300">
          {item.objectType}
        </span>
      </div>
      <div className="mt-3 text-sm leading-7 text-slate-300">{item.insight}</div>
      <div className="mt-3 text-xs text-slate-500">
        refs: {item.evidenceRefs.map((ref) => ref.recordId).join(', ') || 'none'}
      </div>
    </div>
  );
}

export default function LobsterEntityPage() {
  const params = useParams<{ id: string }>();
  const lobsterId = String(params?.id || 'radar');
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [expandedRunId, setExpandedRunId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [rating, setRating] = useState('thumbs_up');
  const [tags, setTags] = useState('');
  const [comment, setComment] = useState('');
  const [revisedOutput, setRevisedOutput] = useState('');

  const detailQuery = useQuery({
    queryKey: ['lobster-entity', lobsterId],
    queryFn: () => fetchLobsterEntity(lobsterId),
  });
  const statsQuery = useQuery({
    queryKey: ['lobster-entity', 'stats', lobsterId],
    queryFn: () => fetchLobsterEntityStats(lobsterId),
  });
  const metricsHistoryQuery = useQuery({
    queryKey: ['lobster-entity', 'metrics-history', lobsterId],
    queryFn: () => fetchLobsterMetricsHistory(lobsterId, 30),
  });
  const skillsQuery = useQuery({
    queryKey: ['lobster-entity', 'skills', lobsterId],
    queryFn: () => fetchLobsterEntitySkills(lobsterId),
  });
  const runsQuery = useQuery({
    queryKey: ['lobster-entity', 'runs', lobsterId],
    queryFn: () => fetchLobsterEntityRuns(lobsterId, 20),
  });
  const docsQuery = useQuery({
    queryKey: ['lobster-entity', 'docs', lobsterId],
    queryFn: () => fetchLobsterEntityDocs(lobsterId),
  });
  const feedbackStatsQuery = useQuery({
    queryKey: ['lobster-entity', 'quality-stats', lobsterId],
    queryFn: () => fetchLobsterQualityStats(lobsterId, 30),
  });
  const collabKnowledgeQuery = useQuery({
    queryKey: ['lobster-entity', 'tenant-private-collab', tenantId, lobsterId],
    queryFn: () => fetchControlPlaneTenantPrivateKnowledgeSummaries({ tenant_id: tenantId, limit: 4 }),
  });

  const lobster = useMemo<LobsterEntity | null>(() => {
    const detail = detailQuery.data;
    const stats = statsQuery.data?.stats;
    if (!detail?.lobster) return null;
    const row: LobsterEntityRow = detail.lobster;
    const annotations = row.annotations ?? {};
    const detailSkills = Array.isArray(row.skills) ? row.skills : [];
    return {
      id: row.id,
      name: row.name,
      display_name: row.display_name,
      zh_name: row.zh_name,
      description: row.description,
      lifecycle: normalizeLifecycle(row.lifecycle),
      status: row.status as LobsterEntity['status'],
      system: row.system,
      skill_count: (skillsQuery.data?.items || detailSkills).length,
      weekly_runs: Number(stats?.weekly_runs || row.run_count_24h || 0),
      avg_quality_score: Number(stats?.avg_quality_score || row.score || 0),
      p95_latency_ms: Number(stats?.p95_latency_ms || row.avg_latency_ms || 0),
      active_edge_nodes: Number(stats?.active_edge_nodes || 0),
      tags: row.tags ?? [],
      annotations,
      skills: skillsQuery.data?.items || detailSkills,
      recent_runs: runsQuery.data?.items || detail.recent_runs || [],
      icon: row.icon,
      role: row.role,
      default_model_tier: row.default_model_tier,
      active_experiment:
        typeof annotations['openclaw/ab-experiment'] === 'string'
          ? {
              flag_name: String(annotations['openclaw/ab-experiment']),
              rollout: 10,
            }
          : undefined,
    };
  }, [detailQuery.data, runsQuery.data, skillsQuery.data, statsQuery.data]);

  const feedbackMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTaskId) throw new Error('请选择一条任务记录后再提交反馈');
      return submitLobsterFeedback({
        task_id: selectedTaskId,
        lobster_id: lobsterId,
        rating,
        tags: tags.split(',').map((item) => item.trim()).filter(Boolean),
        comment: comment.trim(),
        revised_output: revisedOutput.trim(),
      });
    },
    onSuccess: async () => {
      triggerSuccessToast('反馈已提交');
      setComment('');
      setRevisedOutput('');
      await queryClient.invalidateQueries({ queryKey: ['lobster-entity', 'quality-stats', lobsterId] });
    },
  });

  const recentRuns = useMemo(() => lobster?.recent_runs ?? [], [lobster?.recent_runs]);
  const skills = useMemo(() => lobster?.skills ?? [], [lobster?.skills]);
  const capabilityProfile = useMemo(() => getLobsterCapabilityProfile(lobster?.id ?? lobsterId), [lobster?.id, lobsterId]);

  const qualityTrend = recentRuns
    .slice()
    .reverse()
    .map((run, index) => ({
      date: String(run.created_at || `Run ${index + 1}`).slice(5, 16),
      score: typeof run.score === 'number' ? run.score : lobster?.avg_quality_score || 0,
    }));

  const feedbackTimeline = (feedbackStatsQuery.data?.stats.timeline || [])
    .slice()
    .reverse()
    .map((item, index) => ({
      date: String(item.created_at || `Feedback ${index + 1}`).slice(5, 16),
      score:
        item.rating === 'thumbs_up'
          ? 9
          : item.rating === 'thumbs_down'
            ? 3
            : item.rating.startsWith('star_')
              ? Number(item.rating.split('_')[1] || 0) * 2
              : 5,
    }));

  const metricsTrend = (metricsHistoryQuery.data?.items || []).map((item) => ({
    date: String(item.date).slice(5),
    tasks: Number(item.task_count || 0),
    success: Number(item.success_count || 0),
    latency: Math.round(Number(item.avg_latency_ms || 0)),
    errorRate: Math.round(Number(item.error_rate || 0) * 100),
    cost: Number(item.cost_usd || 0),
  }));

  const latestMetricsPoint = metricsHistoryQuery.data?.items?.length
    ? metricsHistoryQuery.data.items[metricsHistoryQuery.data.items.length - 1]
    : null;

  const skillStats = useMemo(() => {
    const enabledCount = skills.filter((item) => item.enabled !== false).length;
    const ratedSkills = skills.filter((item) => Number.isFinite(Number(item.effectiveness_rating)));
    const gotchaSkills = skills.filter((item) => (item.gotchas || []).length > 0).length;
    const avgRating = ratedSkills.length
      ? ratedSkills.reduce((sum, item) => sum + Number(item.effectiveness_rating || 0), 0) / ratedSkills.length
      : 0;
    return {
      enabledCount,
      ratedCount: ratedSkills.length,
      avgRating,
      gotchaCoverage: skills.length ? Math.round((gotchaSkills / skills.length) * 100) : 0,
    };
  }, [skills]);

  const runStats = useMemo(() => {
    const completed = recentRuns.filter((item) =>
      ['success', 'completed', 'done'].includes(String(item.status || '').toLowerCase()),
    ).length;
    const failed = recentRuns.filter((item) =>
      ['failed', 'error', 'timeout', 'cancelled'].includes(String(item.status || '').toLowerCase()),
    ).length;
    const totalTokens = recentRuns.reduce((sum, item) => sum + Number(item.total_tokens || 0), 0);
    return {
      completed,
      failed,
      totalTokens,
      successRate: recentRuns.length ? Math.round((completed / recentRuns.length) * 100) : 0,
    };
  }, [recentRuns]);

  const skillRadar = skills.map((skill) => ({
    skill_name: skill.name || skill.id,
    score: Number(skill.effectiveness_rating || 0),
    target: Math.max(Number(skill.effectiveness_rating || 0), 5),
  }));

  const knowledgeContent = String(docsQuery.data?.content || '').trim();
  const knowledgeMeta = {
    path: docsQuery.data?.path || '-',
    lineCount: knowledgeContent ? knowledgeContent.split(/\r?\n/).length : 0,
    sectionCount: (knowledgeContent.match(/^#{1,6}\s+/gm) || []).length,
  };

  const handleSaveConfig = async (values: LobsterConfigValues) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`clawcommerce.lobster-config.${lobsterId}`, JSON.stringify(values));
    }
    triggerSuccessToast(`已保存 ${lobster?.display_name || lobsterId} 的本地配置草稿`);
  };

  if (detailQuery.isLoading && !lobster) {
    return <div className="p-6 text-sm text-slate-400">正在加载龙虾详情...</div>;
  }

  if (detailQuery.isError && !lobster) {
    return (
      <div className="p-6">
        <EmptyPanel
          title="龙虾详情加载失败"
          description={String((detailQuery.error as Error)?.message || '请稍后刷新重试。')}
        />
      </div>
    );
  }

  if (!lobster) {
    return <div className="p-6 text-sm text-slate-400">未找到龙虾详情。</div>;
  }

  return (
    <div className="space-y-6 bg-[#0F172A] p-6 text-slate-100">
      <LobsterEntityHeader lobster={lobster} />

      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-2xl border px-4 py-2 text-sm transition ${
              activeTab === tab.id
                ? 'border-cyan-400/35 bg-cyan-400/10 text-cyan-100'
                : 'border-white/10 bg-white/[0.03] text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatusCard title="本周执行" value={formatNumber(lobster.weekly_runs)} />
            <StatusCard title="平均质量评分" value={Number(lobster.avg_quality_score || 0).toFixed(1)} subtitle="满分 10" />
            <StatusCard title="P95 响应时间" value={formatDuration(lobster.p95_latency_ms)} />
            <StatusCard title="在线边缘节点" value={formatNumber(lobster.active_edge_nodes)} />
          </div>

          <SectionPanel
            title="运行姿态"
            subtitle="把角色、模型、实验与标签放在一个操作视图里，便于排查当前这只龙虾的真实状态。"
          >
            <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-semibold text-white">角色定位</div>
                  <div className="mt-2 text-sm leading-7 text-slate-300">
                    {lobster.description || lobster.role || '暂无角色描述。'}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <MetaPill icon={<Cpu className="h-4 w-4" />} label="默认模型层级" value={lobster.default_model_tier || '-'} />
                  <MetaPill icon={<ShieldCheck className="h-4 w-4" />} label="生命周期" value={lobster.lifecycle} />
                  <MetaPill icon={<Sparkles className="h-4 w-4" />} label="系统模式" value={lobster.system || '-'} />
                  <MetaPill icon={<ScrollText className="h-4 w-4" />} label="活跃实验" value={lobster.active_experiment?.flag_name || '未参与实验'} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">标签与注解</div>
                    <span className="text-xs text-slate-500">{lobster.tags.length} 个标签</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {lobster.tags.length ? (
                      lobster.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100"
                        >
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-slate-400">当前没有标签。</span>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-semibold text-white">最近运行摘要</div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <StatusCard title="成功率" value={`${runStats.successRate}%`} />
                    <StatusCard title="失败数" value={formatNumber(runStats.failed)} />
                    <StatusCard title="累计 Tokens" value={formatNumber(runStats.totalTokens)} />
                  </div>
                </div>
              </div>
            </div>
          </SectionPanel>

          <SupervisorCapabilityTree profile={capabilityProfile} compact />

          <SectionPanel
            title="Tenant-private collaboration summaries"
            subtitle="主管详情页只消费脱敏后的 tenant-private 协作摘要，不直接消费原始审批、提醒或回执正文。"
          >
            {collabKnowledgeQuery.isLoading ? (
              <EmptyPanel title="正在加载协作摘要" description="加载完成后，这里会展示当前租户已沉淀的协作摘要证据。" />
            ) : (collabKnowledgeQuery.data?.items ?? []).length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {(collabKnowledgeQuery.data?.items ?? []).map((item) => (
                  <CollabKnowledgeEvidenceCard key={item.captureId} item={item} />
                ))}
              </div>
            ) : (
              <EmptyPanel title="暂无协作摘要" description="当前还没有可供主管消费的 tenant-private 协作摘要。" />
            )}
          </SectionPanel>

          <SectionPanel
            title="近 30 天指标趋势"
            subtitle="同时展示任务量、成功量，以及最新延迟、错误率和成本快照。"
            action={
              latestMetricsPoint ? (
                <div className="text-right text-xs text-slate-400">最近快照：{latestMetricsPoint.date}</div>
              ) : null
            }
          >
            {metricsTrend.length > 0 ? (
              <div className="space-y-4">
                <ChartContainer
                  className="h-[260px]"
                  config={{
                    tasks: { label: '任务数', color: '#22d3ee' },
                    success: { label: '成功数', color: '#34d399' },
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={metricsTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                      <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line type="monotone" dataKey="tasks" name="任务数" stroke="var(--color-tasks)" strokeWidth={2.5} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="success" name="成功数" stroke="var(--color-success)" strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>

                <div className="grid gap-4 md:grid-cols-3">
                  <StatusCard title="平均延迟" value={formatDuration(Number(latestMetricsPoint?.avg_latency_ms || 0))} />
                  <StatusCard title="错误率" value={`${Math.round(Number(latestMetricsPoint?.error_rate || 0) * 100)}%`} />
                  <StatusCard title="成本 (USD)" value={Number(latestMetricsPoint?.cost_usd || 0).toFixed(2)} />
                </div>
              </div>
            ) : (
              <EmptyPanel title="暂无历史指标数据" description="后端写入指标后，这里会自动显示近 30 天趋势。" />
            )}
          </SectionPanel>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            {qualityTrend.length > 0 ? (
              <QualityScoreChart data={qualityTrend} title="最近运行质量趋势" lobsterId={lobster.id} />
            ) : (
              <EmptyPanel title="暂无质量趋势" description="最近运行还没有足够的质量评分样本。" />
            )}

            <SectionPanel
              title="技能快照"
              subtitle="快速判断当前技能池的质量结构，而不是只看数量。"
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <StatusCard title="已启用技能" value={formatNumber(skillStats.enabledCount)} />
                <StatusCard title="平均效能" value={skillStats.avgRating ? skillStats.avgRating.toFixed(1) : '-'} />
                <StatusCard title="注意事项覆盖" value={`${skillStats.gotchaCoverage}%`} />
              </div>
              <div className="mt-4 space-y-3">
                {skills.slice(0, 5).map((skill) => (
                  <SkillCard key={skill.id} skill={skill} />
                ))}
                {skills.length === 0 ? (
                  <EmptyPanel title="暂无技能数据" description="当前龙虾还没有可展示的技能记录。" />
                ) : null}
              </div>
            </SectionPanel>
          </div>
        </div>
      )}

      {activeTab === 'skills' && (
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          {skillRadar.length > 0 ? (
            <LobsterRadarChart skills={skillRadar} />
          ) : (
            <EmptyPanel title="暂无技能雷达图" description="后端返回技能效能评分后，这里会自动展示雷达图。" />
          )}

          <SectionPanel
            title="技能详情"
            subtitle="每个技能同时给出启用状态、效能评分和已知 gotchas。"
          >
            <div className="grid gap-3 md:grid-cols-3">
              <StatusCard title="技能总数" value={formatNumber(skills.length)} />
              <StatusCard title="有效评分" value={formatNumber(skillStats.ratedCount)} />
              <StatusCard title="Gotchas 覆盖率" value={`${skillStats.gotchaCoverage}%`} />
            </div>
            <div className="mt-4 space-y-3">
              {skills.length ? (
                skills.map((skill) => (
                  <div key={skill.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <SkillCard skill={skill} />
                    {(skill.gotchas || []).length ? (
                      <div className="mt-4 space-y-2">
                        {skill.gotchas?.map((item, index) => (
                          <div
                            key={`${skill.id}-${index}`}
                            className="rounded-xl border border-amber-400/15 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
                          >
                            {item}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-2 text-sm text-slate-400">
                        暂无该技能的已知注意事项。
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <EmptyPanel title="暂无技能详情" description="该龙虾暂时还没有技能列表。" />
              )}
            </div>
          </SectionPanel>
        </div>
      )}

      {activeTab === 'runs' && (
        <SectionPanel
          title="最近 20 次任务历史"
          subtitle="每条记录都可以展开，查看运行元数据和原始返回结构，方便定位异常。"
        >
          <div className="grid gap-3 md:grid-cols-4">
            <StatusCard title="总记录数" value={formatNumber(recentRuns.length)} />
            <StatusCard title="成功" value={formatNumber(runStats.completed)} />
            <StatusCard title="失败" value={formatNumber(runStats.failed)} />
            <StatusCard title="成功率" value={`${runStats.successRate}%`} />
          </div>

          <div className="mt-4 space-y-3">
            {recentRuns.length ? (
              recentRuns.map((run, index) => {
                const runId = String(run.run_id || run.id || `run_${index}`);
                const expanded = expandedRunId === runId;
                const outputText =
                  typeof run.output === 'string'
                    ? run.output
                    : typeof run.summary === 'string'
                      ? run.summary
                      : typeof run.result === 'string'
                        ? run.result
                        : '';

                return (
                  <div key={runId} className="rounded-2xl border border-white/10 bg-black/20">
                    <button
                      type="button"
                      onClick={() => setExpandedRunId(expanded ? '' : runId)}
                      className="flex w-full items-center gap-3 px-4 py-4 text-left"
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-cyan-300" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                      )}
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-white">{runId}</div>
                          <span className={`rounded-full border px-2.5 py-1 text-xs ${getRunStatusTone(run.status)}`}>
                            {run.status}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatDate(run.created_at)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Cpu className="h-3.5 w-3.5" />
                            {run.model_used || '-'}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Coins className="h-3.5 w-3.5" />
                            {formatCurrency(run.cost_cny || run.estimated_cost_cny)}
                          </span>
                          <span>{formatDuration(run.duration_ms)}</span>
                          <span>Tokens {formatNumber(Number(run.total_tokens || 0))}</span>
                        </div>
                      </div>
                    </button>

                    {expanded ? (
                      <div className="border-t border-white/10 px-4 py-4">
                        <div className="grid gap-3 md:grid-cols-4">
                          <StatusCard title="输入 Tokens" value={formatNumber(Number(run.input_tokens || 0))} />
                          <StatusCard title="输出 Tokens" value={formatNumber(Number(run.output_tokens || 0))} />
                          <StatusCard title="总 Tokens" value={formatNumber(Number(run.total_tokens || 0))} />
                          <StatusCard
                            title="质量评分"
                            value={typeof run.score === 'number' ? run.score.toFixed(1) : '-'}
                          />
                        </div>

                        {run.error ? (
                          <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-rose-100">
                              <TriangleAlert className="h-4 w-4" />
                              运行异常
                            </div>
                            <div className="mt-2 text-sm text-rose-100/90">{String(run.error)}</div>
                          </div>
                        ) : null}

                        <div className="mt-4">
                          <KnowledgeContextEvidence
                            context={
                              resolveKnowledgeContext(run.knowledge_context)
                              ?? resolveKnowledgeContext(run.result)
                              ?? resolveKnowledgeContext(run.output)
                              ?? resolveKnowledgeContext(run.input)
                            }
                            compact
                          />
                        </div>

                        {outputText ? (
                          <div className="mt-4">
                            <div className="mb-2 text-sm font-semibold text-white">输出预览</div>
                            <ArtifactRenderer content={outputText} />
                          </div>
                        ) : null}

                        <div className="mt-4">
                          <div className="mb-2 text-sm font-semibold text-white">原始记录</div>
                          <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-xs text-slate-300">
                            {JSON.stringify(run, null, 2)}
                          </pre>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <EmptyPanel title="暂无任务历史" description="该龙虾暂时还没有最近运行记录。" />
            )}
          </div>
        </SectionPanel>
      )}

      {activeTab === 'knowledge' && (
        <SectionPanel
          title="知识内容"
          subtitle="当前展示的是后端为该龙虾返回的文档内容，可直接用于核对知识是否真正落到了执行面。"
          action={
            <div className="text-right text-xs text-slate-400">
              <div>路径：{knowledgeMeta.path}</div>
              <div className="mt-1">
                {knowledgeMeta.lineCount} 行 · {knowledgeMeta.sectionCount} 个段落标题
              </div>
            </div>
          }
        >
          {knowledgeContent ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <MetaPill icon={<BookOpenText className="h-4 w-4" />} label="文档行数" value={String(knowledgeMeta.lineCount)} />
                <MetaPill icon={<ScrollText className="h-4 w-4" />} label="标题段落" value={String(knowledgeMeta.sectionCount)} />
                <MetaPill icon={<Sparkles className="h-4 w-4" />} label="数据来源" value="GET /api/v1/lobsters/{id}/docs" />
              </div>
              <ArtifactRenderer content={knowledgeContent} />
            </div>
          ) : (
            <EmptyPanel title="暂无知识内容" description="后端暂时没有返回该龙虾的文档内容。" />
          )}
        </SectionPanel>
      )}

      {activeTab === 'config' && (
        <div className="space-y-4">
          <SectionPanel title="配置中心" subtitle="保留现有本地草稿能力，并继续支持生命周期变更。">
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
              <LobsterConfigForm lobster={lobster} onSave={handleSaveConfig} />
            </div>
          </SectionPanel>

          <SectionPanel title="生命周期控制" subtitle="涉及下线操作时，仍然通过保护确认框执行。">
            {lobster.lifecycle !== 'deprecated' ? (
              <DangerActionGuard
                trigger={
                  <button
                    type="button"
                    className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"
                  >
                    废弃这只龙虾
                  </button>
                }
                title={`废弃龙虾：${lobster.zh_name || lobster.display_name}`}
                description="该操作会让新任务停止调度这只龙虾。请先确认已有替代方案，再执行废弃。"
                confirmText="DEPRECATE"
                confirmLabel="确认废弃"
                successMessage="龙虾生命周期已更新为 deprecated"
                onConfirm={async () => {
                  await updateLobsterLifecycle(lobster.id, {
                    new_lifecycle: 'deprecated',
                    reason: 'entity_config_deprecate',
                  });
                  await Promise.all([
                    detailQuery.refetch(),
                    statsQuery.refetch(),
                    skillsQuery.refetch(),
                    runsQuery.refetch(),
                  ]);
                }}
              />
            ) : (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                当前生命周期已经是 deprecated，新执行入口不会再调度这只龙虾。
              </div>
            )}

            <pre className="mt-4 overflow-x-auto rounded-2xl bg-black/20 p-4 text-sm text-slate-300">
              {JSON.stringify(
                {
                  lifecycle: lobster.lifecycle,
                  system: lobster.system,
                  annotations: lobster.annotations,
                },
                null,
                2,
              )}
            </pre>
          </SectionPanel>
        </div>
      )}

      {activeTab === 'feedback' && (
        <div className="space-y-4">
          <SectionPanel title="人工反馈与质量统计" subtitle="把运营反馈直接沉淀成可回放的质量信号。">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatusCard title="反馈总数" value={feedbackStatsQuery.data?.stats.total_feedbacks || 0} />
              <StatusCard title="点赞" value={feedbackStatsQuery.data?.stats.thumbs_up || 0} />
              <StatusCard title="点踩" value={feedbackStatsQuery.data?.stats.thumbs_down || 0} />
              <StatusCard title="满意率" value={feedbackStatsQuery.data?.stats.satisfaction_rate ?? '-'} subtitle="%" />
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              {feedbackTimeline.length || qualityTrend.length ? (
                <QualityScoreChart
                  data={feedbackTimeline.length ? feedbackTimeline : qualityTrend}
                  title="反馈评分趋势"
                  lobsterId={lobster.id}
                />
              ) : (
                <EmptyPanel title="暂无反馈趋势" description="当前还没有足够的反馈样本。" />
              )}

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-sm font-semibold text-white">常见反馈标签</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(feedbackStatsQuery.data?.stats.top_tags || []).length ? (
                    feedbackStatsQuery.data?.stats.top_tags.map((item) => (
                      <span
                        key={item.tag}
                        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100"
                      >
                        {item.tag} · {item.count}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-slate-400">还没有人工标签反馈。</span>
                  )}
                </div>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel title="提交反馈" subtitle="先选任务，再提交评分、标签和修订版本。">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-xs text-slate-400">
                选择 run / task
                <select
                  value={selectedTaskId}
                  onChange={(event) => setSelectedTaskId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                >
                  <option value="">请选择</option>
                  {recentRuns.map((run, index) => {
                    const taskId = String(run.run_id || run.id || `run_${index}`);
                    return (
                      <option key={taskId} value={taskId}>
                        {taskId}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="text-xs text-slate-400">
                评分
                <select
                  value={rating}
                  onChange={(event) => setRating(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                >
                  <option value="thumbs_up">thumbs_up</option>
                  <option value="thumbs_down">thumbs_down</option>
                  <option value="star_1">star_1</option>
                  <option value="star_2">star_2</option>
                  <option value="star_3">star_3</option>
                  <option value="star_4">star_4</option>
                  <option value="star_5">star_5</option>
                </select>
              </label>
            </div>

            <label className="mt-4 block text-xs text-slate-400">
              标签（逗号分隔）
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                placeholder="accurate, creative, needs_revision"
              />
            </label>

            <label className="mt-4 block text-xs text-slate-400">
              反馈备注
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
              />
            </label>

            <label className="mt-4 block text-xs text-slate-400">
              修订版本（可选，会进入 golden dataset）
              <textarea
                value={revisedOutput}
                onChange={(event) => setRevisedOutput(event.target.value)}
                rows={5}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
              />
            </label>

            <button
              type="button"
              onClick={() => feedbackMutation.mutate()}
              disabled={feedbackMutation.isPending}
              className="mt-4 rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 disabled:opacity-60"
            >
              {feedbackMutation.isPending ? '提交中...' : '提交反馈'}
            </button>

            {feedbackMutation.error ? (
              <div className="mt-3 text-sm text-rose-300">
                {String((feedbackMutation.error as Error).message || '提交失败')}
              </div>
            ) : null}
          </SectionPanel>
        </div>
      )}
    </div>
  );
}
