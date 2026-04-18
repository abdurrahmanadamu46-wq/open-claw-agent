'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { ArrowRight, Layers3, Rocket, ShieldCheck, Sparkles, Waypoints } from 'lucide-react';
import {
  fetchAutonomyPolicy,
  deescalateStrategyIntensity,
  escalateStrategyIntensity,
  fetchIndustryList,
  fetchIndustryKnowledgePackReadiness,
  type PipelineModePreview,
  type RunDragonTeamSyncResult,
  fetchRunDragonTeamAsyncStatus,
  fetchStrategyIntensity,
  fetchStrategyIntensityHistory,
  previewPipelineMode,
  runDragonTeam,
  runDragonTeamAsync,
} from '@/services/endpoints/ai-subservice';
import { getCurrentUser } from '@/services/endpoints/user';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import { IndustrySelector } from '@/components/business/IndustrySelector';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';
import {
  KnowledgeContextEvidence,
  resolveKnowledgeContext,
} from '@/components/knowledge/KnowledgeContextEvidence';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { AnalyticsEvent, trackEvent } from '@/lib/analytics';
import {
  clearIndustryWorkflowHandoff,
  readIndustryWorkflowHandoff,
  type IndustryWorkflowHandoff,
} from '@/lib/industry-workflow';

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatHistoryTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

type HistoryRow = {
  id: string;
  label: string;
  previousLevel: number;
  nextLevel: number;
  changedBy: string;
};

export default function StrategyPage() {
  const currentUserQuery = useQuery({
    queryKey: ['strategy-page', 'current-user'],
    queryFn: getCurrentUser,
    staleTime: 5 * 60 * 1000,
  });
  const currentUser = currentUserQuery.data;

  const intensityQuery = useQuery({
    queryKey: ['strategy-page', 'strategy-intensity', currentUser?.tenantId],
    queryFn: () => fetchStrategyIntensity(currentUser?.tenantId),
    staleTime: 30 * 1000,
  });
  const intensityHistoryQuery = useQuery({
    queryKey: ['strategy-page', 'strategy-intensity-history', currentUser?.tenantId],
    queryFn: () => fetchStrategyIntensityHistory(currentUser?.tenantId, 8),
    staleTime: 30 * 1000,
    retry: false,
    enabled: Boolean(currentUser?.tenantId),
  });
  const autonomyPolicyQuery = useQuery({
    queryKey: ['strategy-page', 'autonomy-policy', currentUser?.tenantId],
    queryFn: () => fetchAutonomyPolicy(currentUser?.tenantId),
    staleTime: 30 * 1000,
    retry: false,
    enabled: Boolean(currentUser?.tenantId),
  });
  const industryListQuery = useQuery({
    queryKey: ['strategy-page', 'industry-list'],
    queryFn: fetchIndustryList,
    staleTime: Infinity,
  });

  const [taskDescription, setTaskDescription] = useState('围绕本地商家增长目标，制定一条可执行、可审计、可复盘的增长策略。');
  const [industryTag, setIndustryTag] = useState('');
  const [competitorHandlesText, setCompetitorHandlesText] = useState('openalex\ngithub_projects');
  const [activeJobId, setActiveJobId] = useState('');
  const [syncResult, setSyncResult] = useState<RunDragonTeamSyncResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PipelineModePreview | null>(null);
  const [selectedSubmitPath, setSelectedSubmitPath] = useState<'sync' | 'async'>('async');
  const [intensityAction, setIntensityAction] = useState<'escalate' | 'deescalate' | null>(null);
  const [industryWorkflowContext, setIndustryWorkflowContext] = useState<IndustryWorkflowHandoff | null>(null);
  const [industryHandoffSummary, setIndustryHandoffSummary] = useState<{
    workflowId: string;
    industryLabel: string;
    approvalSteps: number;
  } | null>(null);

  const statusQuery = useQuery({
    queryKey: ['strategy-page', 'run-dragon-team-async', activeJobId],
    queryFn: () => fetchRunDragonTeamAsyncStatus(activeJobId),
    enabled: activeJobId.trim().length > 0,
    refetchInterval: ({ state }) => {
      const status = String(state.data?.status ?? '');
      return status === 'completed' || status === 'failed' ? false : 2000;
    },
  });

  const competitorHandles = useMemo(() => splitLines(competitorHandlesText), [competitorHandlesText]);
  const normalizedIndustryTag = industryTag.trim();
  const knowledgePackReadinessQuery = useQuery({
    queryKey: ['strategy-page', 'industry-knowledge-pack-readiness', normalizedIndustryTag],
    queryFn: () => fetchIndustryKnowledgePackReadiness(normalizedIndustryTag),
    enabled: normalizedIndustryTag.length > 0,
    staleTime: 60 * 1000,
    retry: false,
  });
  const industryOptions = industryListQuery.data?.items ?? [];
  const industryCategories = industryListQuery.data?.categories ?? [];
  const intensity = intensityQuery.data;
  const autonomyPolicy = autonomyPolicyQuery.data;
  const knowledgePackReadiness = knowledgePackReadinessQuery.data?.readiness;
  const knowledgePackReady = Boolean(knowledgePackReadiness?.ok);
  const knowledgePackFilesReady = Number(knowledgePackReadiness?.files_ready ?? 0);
  const knowledgePackFilesExpected = Number(knowledgePackReadiness?.files_expected ?? 0);
  const knowledgePackRolesReady = Number(knowledgePackReadiness?.roles_ready ?? 0);
  const knowledgePackRolesTotal = Number(knowledgePackReadiness?.roles_total ?? 9);
  const autonomyOverrideCount = Array.isArray(autonomyPolicy?.per_lobster_overrides)
    ? autonomyPolicy.per_lobster_overrides.length
    : Object.keys(autonomyPolicy?.per_lobster_overrides || {}).length;
  const canManageIntensity = Boolean(
    currentUser?.isAdmin || currentUser?.roles?.some((role) => String(role).toLowerCase() === 'admin'),
  );
  const intensityHistoryChartData = useMemo<HistoryRow[]>(() => {
    const rows = intensityHistoryQuery.data?.history ?? [];
    return rows
      .map((item, index) => {
        const ts = String(item.changed_at ?? item.updated_at ?? '');
        const previousLevel = Number(item.previous_level ?? item.current_level ?? 0);
        const nextLevel = Number(item.next_level ?? item.current_level ?? 0);
        const changedBy = String(item.changed_by ?? item.updated_by ?? '-');
        return {
          id: String(item.id ?? `${ts || 'history'}-${index}`),
          label: formatHistoryTime(ts),
          previousLevel,
          nextLevel,
          changedBy,
        };
      })
      .filter((item) => Number.isFinite(item.nextLevel) && item.nextLevel > 0);
  }, [intensityHistoryQuery.data?.history]);

  useEffect(() => {
    const handoff = readIndustryWorkflowHandoff();
    if (!handoff) return;
    setTaskDescription(handoff.taskDescription);
    setIndustryTag(`${handoff.request.categoryId}.${handoff.request.subIndustryId}`);
    setCompetitorHandlesText((handoff.request.merchantProfile.bindAccounts ?? []).join('\n'));
    setPreview(null);
    setSyncResult(null);
    setActiveJobId('');
    setIndustryWorkflowContext(handoff);
    setIndustryHandoffSummary({
      workflowId: handoff.request.workflowId,
      industryLabel: `${handoff.blueprint.industry.categoryLabel} / ${handoff.blueprint.industry.subIndustryLabel}`,
      approvalSteps: handoff.blueprint.approvalSummary.length,
    });
    clearIndustryWorkflowHandoff();
    triggerSuccessToast('已从 Industry Workflow Intake 带入主线策略页。');
  }, []);

  async function submitAsyncJob() {
    if (!taskDescription.trim()) {
      triggerErrorToast('请先填写任务描述。');
      return;
    }

    setSubmitting(true);
    try {
      setSyncResult(null);
      const accepted = await runDragonTeamAsync({
        task_description: taskDescription.trim(),
        industry_tag: normalizedIndustryTag || undefined,
        industry: normalizedIndustryTag || undefined,
        competitor_handles: competitorHandles,
        client_preview: preview ?? undefined,
        industry_workflow_context: industryWorkflowContext ?? undefined,
        meta: normalizedIndustryTag ? { industry: normalizedIndustryTag } : undefined,
      });
      setActiveJobId(String(accepted.job_id));
      trackEvent(AnalyticsEvent.STRATEGY_SUBMITTED, {
        submit_path: 'async',
        tenant_id: currentUser?.tenantId,
        industry_tag: normalizedIndustryTag || undefined,
      });
      triggerSuccessToast(`异步任务已提交：${accepted.job_id}`);
      await statusQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '异步提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSyncJob() {
    if (!taskDescription.trim()) {
      triggerErrorToast('请先填写任务描述。');
      return;
    }

    setSubmitting(true);
    try {
      setActiveJobId('');
      const result = await runDragonTeam({
        task_description: taskDescription.trim(),
        industry_tag: normalizedIndustryTag || undefined,
        industry: normalizedIndustryTag || undefined,
        competitor_handles: competitorHandles,
        client_preview: preview ?? undefined,
        industry_workflow_context: industryWorkflowContext ?? undefined,
        meta: normalizedIndustryTag ? { industry: normalizedIndustryTag } : undefined,
      });
      setSyncResult(result);
      trackEvent(AnalyticsEvent.STRATEGY_SUBMITTED, {
        submit_path: 'sync',
        tenant_id: currentUser?.tenantId,
        industry_tag: normalizedIndustryTag || undefined,
      });
      triggerSuccessToast('同步策略任务已完成。');
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '同步提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePreview() {
    if (!taskDescription.trim()) {
      triggerErrorToast('请先填写任务描述。');
      return;
    }

    setPreviewLoading(true);
    try {
      const data = await previewPipelineMode({
        task_description: taskDescription.trim(),
        industry_tag: normalizedIndustryTag || undefined,
        industry: normalizedIndustryTag || undefined,
        competitor_handles: competitorHandles,
        edge_targets: [],
        meta: normalizedIndustryTag ? { industry: normalizedIndustryTag } : undefined,
      });
      setPreview(data.preview ?? null);
      setSelectedSubmitPath(data.preview?.recommended_submit_path === 'sync' ? 'sync' : 'async');
      setPreviewOpen(true);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '预览失败');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleIntensityAdjust(direction: 'escalate' | 'deescalate') {
    if (!canManageIntensity) {
      triggerErrorToast('Only admin operators can change strategy intensity.');
      return;
    }

    setIntensityAction(direction);
    try {
      if (direction === 'escalate') {
        await escalateStrategyIntensity({
          tenant_id: currentUser?.tenantId,
          reason: 'strategy_panel_manual_escalate',
        });
        trackEvent(AnalyticsEvent.STRATEGY_INTENSITY_ADJUSTED, {
          direction: 'escalate',
          tenant_id: currentUser?.tenantId,
        });
        triggerSuccessToast('Strategy intensity upgraded.');
      } else {
        await deescalateStrategyIntensity({
          tenant_id: currentUser?.tenantId,
          reason: 'strategy_panel_manual_deescalate',
        });
        trackEvent(AnalyticsEvent.STRATEGY_INTENSITY_ADJUSTED, {
          direction: 'deescalate',
          tenant_id: currentUser?.tenantId,
        });
        triggerSuccessToast('Strategy intensity downgraded.');
      }
      await Promise.all([intensityQuery.refetch(), intensityHistoryQuery.refetch()]);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : 'Failed to update strategy intensity');
    } finally {
      setIntensityAction(null);
    }
  }

  const status = statusQuery.data;
  const runtimeKnowledgeContext = useMemo(
    () =>
      resolveKnowledgeContext(syncResult)
      ?? resolveKnowledgeContext(status?.result)
      ?? resolveKnowledgeContext(status?.result?.kernel_report),
    [status?.result, syncResult],
  );

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="strategy"
        step="主线第 2 步 · 策略"
        title="先把方向讲清楚，再交给总脑"
        description="策略页负责定义目标、行业和外部信号，并决定使用同步还是异步执行链路。"
        previous={{ href: '/onboard', label: '回到首启流程' }}
        next={{ href: '/campaigns', label: '前往任务列表' }}
        actions={
          <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            当前操作者：{currentUser?.name || currentUser?.id || '未识别'}
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <HintCard title="先定目标" description="先说清楚你要达成的结果，而不是把动作列表一股脑塞给系统。" icon={<Sparkles className="h-4 w-4" />} />
        <HintCard title="再看治理" description="先判断是否可能触发审批，再决定如何推进到执行链。" icon={<ShieldCheck className="h-4 w-4" />} />
        <HintCard title="最后选通道" description="能异步就异步，让控制台像指挥台，而不是同步阻塞的大表单。" icon={<Waypoints className="h-4 w-4" />} />
      </section>

      <section className="rounded-[28px] border border-white/10 bg-slate-950/45 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Strategy Intensity</div>
            <div className="flex flex-wrap items-center gap-3">
              <IntensityBadge level={intensity?.current_level ?? 1} label={intensity?.label || 'Loading...'} />
              <div>
                <div className="text-lg font-semibold text-white">{intensity?.name || 'Loading current intensity'}</div>
                <div className="text-sm text-slate-400">
                  {intensity?.description || 'Reading tenant-level strategy controls from the AI subservice.'}
                </div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <PreviewMetric label="Autonomy" value={String(intensity?.autonomy || '-')} />
              <PreviewMetric label="Approval" value={intensity?.approval_required ? 'Required' : 'Not required'} />
              <PreviewMetric label="Rollback" value={String(intensity?.rollback_policy || '-')} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleIntensityAdjust('deescalate')}
              disabled={!canManageIntensity || intensityAction !== null}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white disabled:opacity-50"
            >
              {intensityAction === 'deescalate' ? 'Updating...' : '降一级'}
            </button>
            <button
              type="button"
              onClick={() => void handleIntensityAdjust('escalate')}
              disabled={!canManageIntensity || intensityAction !== null}
              className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2.5 text-sm text-cyan-100 disabled:opacity-50"
            >
              {intensityAction === 'escalate' ? 'Updating...' : '升一级'}
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Autonomy Policy</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <PreviewMetric label="Default Level" value={String(autonomyPolicy?.default_level || 'L0_OBSERVE')} />
              <PreviewMetric label="Overrides" value={String(autonomyOverrideCount)} />
              <PreviewMetric label="Definitions" value={String(autonomyPolicy?.definitions?.length ?? 0)} />
            </div>
            <div className="mt-3 text-sm leading-7 text-slate-300">
              {autonomyPolicy
                ? '策略页已经预留了 L0-L3 自主决策读取位，后续只需要把更新动作接入交互控件即可。'
                : '当前环境还没有返回 autonomy policy；展示位已就绪，等后端 API 可用后会直接接上。'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Intensity History</div>
            {intensityHistoryChartData.length > 0 ? (
              <div className="mt-3 space-y-4">
                <ChartContainer
                  className="h-44 w-full"
                  config={{
                    nextLevel: {
                      label: '强度等级',
                      color: '#22d3ee',
                    },
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={intensityHistoryChartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={18} />
                      <YAxis domain={[1, 5]} allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                      <Line
                        type="monotone"
                        dataKey="nextLevel"
                        name="强度等级"
                        stroke="var(--color-nextLevel)"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#22d3ee' }}
                        activeDot={{ r: 5, fill: '#f59e0b' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>

                <div className="space-y-2">
                  {intensityHistoryChartData.slice(0, 3).map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-300">
                      <div className="font-medium text-white">{`L${item.previousLevel} -> L${item.nextLevel}`}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {item.label} · {item.changedBy}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm leading-7 text-slate-400">
                暂无历史记录，策略强度变更后自动出现。
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <div className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">策略输入</div>

          <div className="space-y-4">
            {industryHandoffSummary ? (
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-cyan-50">
                <div className="font-medium">Industry workflow handoff loaded</div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <PreviewMetric label="Workflow" value={industryHandoffSummary.workflowId} />
                  <PreviewMetric label="Industry" value={industryHandoffSummary.industryLabel} />
                  <PreviewMetric label="Approval Steps" value={String(industryHandoffSummary.approvalSteps)} />
                </div>
              </div>
            ) : null}

            <Field label="任务描述" value={taskDescription} onChange={setTaskDescription} multiline helper="一句话说明：这次要替谁解决什么增长问题。" />

            <Field label="客户行业" helper="选择客户所属行业后，任务请求会同时带上 industry 与 industry_tag，便于龙虾加载行业专属知识。">
              <IndustrySelector
                value={industryTag}
                onChange={(tag) => {
                  const nextTag = tag || '';
                  setIndustryTag(nextTag);
                  if (nextTag) {
                    trackEvent(AnalyticsEvent.INDUSTRY_SELECTED, {
                      tenant_id: currentUser?.tenantId,
                      industry_tag: nextTag,
                    });
                  }
                }}
                categories={industryCategories}
                items={industryOptions}
                disabled={industryListQuery.isLoading}
              />
            </Field>

            <div className={`rounded-2xl border p-4 text-sm ${
              knowledgePackReady
                ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-50'
                : 'border-amber-400/25 bg-amber-400/10 text-amber-50'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">行业知识包就绪状态</div>
                  <div className="mt-1 text-xs opacity-80">
                    {normalizedIndustryTag
                      ? '提交前检查当前行业是否已有 9 只龙虾的专属知识包。'
                      : '选择行业后自动检查知识包。'}
                  </div>
                </div>
                <span className="rounded-full border border-white/15 bg-black/20 px-3 py-1 text-xs">
                  {knowledgePackReadinessQuery.isLoading
                    ? '检查中'
                    : knowledgePackReady
                      ? 'Ready'
                      : normalizedIndustryTag
                        ? 'Need attention'
                        : 'Waiting'}
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <PreviewMetric label="匹配行业" value={String(knowledgePackReadiness?.matched_industry || normalizedIndustryTag || '-')} />
                <PreviewMetric label="龙虾就绪" value={`${knowledgePackRolesReady}/${knowledgePackRolesTotal}`} />
                <PreviewMetric label="文件就绪" value={`${knowledgePackFilesReady}/${knowledgePackFilesExpected || 36}`} />
                <PreviewMetric label="缺口" value={String(knowledgePackReadiness?.missing?.length ?? (normalizedIndustryTag ? '-' : 0))} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="行业标签（高级）" value={industryTag} onChange={setIndustryTag} helper="如需手工填写自定义行业 tag，可在这里覆盖选择器结果。" />
              <ReadonlyField label="当前操作者" value={currentUser?.name || currentUser?.id || '未识别'} helper="系统会把操作者身份写入策略链和审计链。" />
            </div>

            <Field label="竞品来源 / 外部信号" value={competitorHandlesText} onChange={setCompetitorHandlesText} multiline helper="一行一个来源，后续会作为策略参考和雷达输入。" />

            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">当前预览</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <PreviewMetric label="行业" value={industryTag || '-'} />
                <PreviewMetric label="来源数量" value={String(competitorHandles.length)} />
                <PreviewMetric label="执行模式" value={String(preview?.mode || '未预览')} />
                <PreviewMetric label="提交通道" value={String(preview?.recommended_submit_path || selectedSubmitPath || 'async')} />
              </div>
            </div>

            <button
              type="button"
              data-testid="strategy-preview-submit"
              onClick={() => void handlePreview()}
              disabled={submitting || previewLoading}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              {previewLoading ? '正在预览...' : '预览并确认提交'}
            </button>

            <Link
              href="/operations/strategy/industry"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-5 py-3 text-sm font-medium text-cyan-100"
            >
              <Layers3 className="h-4 w-4" />
              Industry workflow intake
            </Link>
          </div>
        </article>

        <article className="space-y-4">
          <section className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
            <div className="text-lg font-semibold text-white">当前判断</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <PreviewMetric label="推荐通道" value={selectedSubmitPath === 'sync' ? '同步返回' : '异步提交'} />
              <PreviewMetric label="当前状态" value={activeJobId || syncResult ? '已有结果' : '等待提交'} />
              <PreviewMetric label="审批风险" value={Boolean(preview?.approval_likely) ? '可能触发' : '大概率不触发'} />
              <PreviewMetric label="预计产物" value={String(preview?.estimated_artifact_count || 0)} />
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="text-lg font-semibold text-white">提交结果</div>
            {activeJobId || syncResult ? (
              <div className="mt-4 space-y-3">
                <StatusCard label="任务状态" value={activeJobId ? String(status?.status ?? 'running') : 'completed'} />
                <StatusCard label="任务编号" value={activeJobId || String(syncResult?.mission_id || '-')} mono />
                <StatusCard label="执行模式" value={String(status?.pipeline_mode ?? syncResult?.pipeline_mode ?? '-')} />
                <StatusCard label="产物数量" value={String(status?.artifact_count ?? syncResult?.artifact_count ?? 0)} />

                <KnowledgeContextEvidence context={runtimeKnowledgeContext} />

                <div className="flex flex-wrap gap-3 pt-2">
                  <Link href="/campaigns" className="rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm text-white">
                    去任务列表
                  </Link>
                  <Link href="/operations/autopilot/trace" className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2.5 text-sm text-cyan-100">
                    去 Trace 复盘
                  </Link>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm leading-7 text-slate-400">
                还没有真正提交任务。先做一次预览，再决定走同步还是异步，把这次策略推进到任务链路里。
              </div>
            )}
          </section>
        </article>
      </section>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="bg-slate-950/95">
          <DialogHeader>
            <DialogTitle>确认提交</DialogTitle>
            <DialogClose onClose={() => setPreviewOpen(false)} />
          </DialogHeader>

          <div className="space-y-4 p-6 text-sm text-slate-200">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <PreviewMetric label="执行模式" value={String(preview?.mode || '-')} />
              <PreviewMetric label="预计耗时" value={`${String(preview?.estimated_duration_sec || '-')}s`} />
              <PreviewMetric label="审批风险" value={Boolean(preview?.approval_likely) ? '可能触发' : '大概率不触发'} />
              <PreviewMetric label="产物数量" value={String(preview?.estimated_artifact_count || 0)} />
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">提交通道</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {(['sync', 'async'] as const).map((option) => {
                  const active = selectedSubmitPath === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSelectedSubmitPath(option)}
                      className="rounded-2xl border px-4 py-3 text-left transition"
                      style={{
                        borderColor: active ? '#22d3ee' : 'rgba(255,255,255,0.08)',
                        backgroundColor: active ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.03)',
                      }}
                    >
                      <div className="text-sm font-semibold text-slate-100">{option === 'sync' ? '同步返回' : '异步提交'}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {option === 'sync' ? '适合短链确认，当前页等待完整结果。' : '适合长链执行，提交后进入任务与复盘链路。'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-200"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="strategy-confirm-submit"
                onClick={() => {
                  setPreviewOpen(false);
                  if (selectedSubmitPath === 'sync') {
                    void submitSyncJob();
                  } else {
                    void submitAsyncJob();
                  }
                }}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
              >
                <Rocket className="h-4 w-4" />
                {submitting ? '正在提交...' : `确认以 ${selectedSubmitPath === 'sync' ? '同步' : '异步'} 方式提交`}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HintCard({ title, description, icon }: { title: string; description: string; icon: ReactNode }) {
  return (
    <article className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-3 inline-flex rounded-2xl border border-amber-400/15 bg-amber-400/10 p-3 text-amber-200">{icon}</div>
      <div className="text-lg font-semibold text-white">{title}</div>
      <p className="mt-2 text-sm leading-7 text-slate-300">{description}</p>
    </article>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
  helper,
  children,
}: {
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  multiline?: boolean;
  helper?: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{label}</label>
      {children ? (
        children
      ) : multiline ? (
        <textarea
          rows={4}
          value={value ?? ''}
          onChange={(event) => onChange?.(event.target.value)}
          className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-400/40"
        />
      ) : (
        <input
          value={value ?? ''}
          onChange={(event) => onChange?.(event.target.value)}
          className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-400/40"
        />
      )}
      {helper ? <div className="mt-2 text-xs text-slate-500">{helper}</div> : null}
    </div>
  );
}

function ReadonlyField({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div>
      <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{label}</label>
      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100">{value}</div>
      {helper ? <div className="mt-2 text-xs text-slate-500">{helper}</div> : null}
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function StatusCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 text-sm text-slate-100 ${mono ? 'font-mono break-all' : 'font-medium'}`}>{value}</div>
    </div>
  );
}

function IntensityBadge({ level, label }: { level: number; label: string }) {
  const palette =
    level >= 4
      ? 'border-red-400/30 bg-red-400/10 text-red-100'
      : level === 3
        ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
        : level === 2
          ? 'border-yellow-400/30 bg-yellow-400/10 text-yellow-100'
          : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';

  return <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium ${palette}`}>{label}</span>;
}

function ResourceLimitBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const safeLimit = Math.max(0, limit);
  const safeUsed = Math.max(0, used);
  const progress = safeLimit > 0 ? Math.min(100, Math.round((safeUsed / safeLimit) * 100)) : 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
        <div className="text-xs text-slate-400">
          {safeUsed} / {safeLimit}
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
