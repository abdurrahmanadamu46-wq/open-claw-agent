'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import {
  Bell,
  Bot,
  BrainCircuit,
  ClipboardList,
  MessageSquare,
  Radio,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import { ExecutionTrendChart } from '@/components/charts/ExecutionTrendChart';
import {
  SurfaceHero,
  SurfaceLinkCard,
  SurfaceMetric,
  SurfacePill,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import { PRODUCT_ZONES, t } from '@/config/operations-navigation';
import { useTenant } from '@/contexts/TenantContext';
import { useCampaigns } from '@/hooks/queries/useCampaigns';
import {
  fetchLiveFirstIndustryTaxonomy,
  formatIndustryDisplayValue,
  resolveIndustryDisplay,
} from '@/lib/live-industry-taxonomy';
import {
  fetchLatestReleaseGate,
  resolveLatestFrontendCloseout,
} from '@/lib/release-gate-client';
import { getAllKnownLobsterRoles } from '@/lib/lobster-skills';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import { getDashboardMetrics } from '@/services/api';
import { fetchAutopilotDashboardMetrics } from '@/services/endpoints/autopilot';
import { fetchNotificationOutbox } from '@/services/endpoints/billing';
import { fetchCommercialReadiness, fetchLobsters } from '@/services/endpoints/ai-subservice';
import { fetchSkillImprovementOverview } from '@/services/endpoints/skill-improvements';
import type { DashboardMetricsResponse } from '@/shared/types/dashboard';

function parseGrowthRate(rate: string): number {
  const parsed = parseFloat(rate.replace(/[%\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readinessLabel(status?: string): string {
  switch (status) {
    case 'ready':
      return '可推进';
    case 'warning':
      return '需关注';
    case 'blocked':
      return '存在阻塞';
    default:
      return '待确认';
  }
}

function learningReadinessLabel(status?: string): string {
  switch (status) {
    case 'needs_rollback_review':
      return '建议回滚复核';
    case 'has_blocked_proposals':
      return '存在阻断提案';
    case 'needs_operator_review':
      return '待人工审核';
    case 'learning_loop_active':
      return '学习闭环运行中';
    case 'waiting_for_signals':
      return '等待真实信号';
    case 'loading':
      return '加载中';
    default:
      return status || '待确认';
  }
}

function learningToneClass(status?: string): string {
  if (status === 'needs_rollback_review' || status === 'has_blocked_proposals') {
    return 'border-rose-400/25 bg-rose-500/10 text-rose-100';
  }
  if (status === 'needs_operator_review' || status === 'waiting_for_signals') {
    return 'border-amber-400/25 bg-amber-500/10 text-amber-100';
  }
  return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100';
}

export default function HomePage() {
  const locale = useLocale();
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id || 'tenant_main';

  const metricsQuery = useQuery({
    queryKey: ['dashboard', 'metrics'],
    queryFn: getDashboardMetrics,
    staleTime: 5 * 60 * 1000,
  });
  const readinessQuery = useQuery({
    queryKey: ['dashboard', 'commercial-readiness'],
    queryFn: fetchCommercialReadiness,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const autopilotQuery = useQuery({
    queryKey: ['autopilot', 'dashboard-metrics'],
    queryFn: () => fetchAutopilotDashboardMetrics({ windowMinutes: 60 }),
    staleTime: 60 * 1000,
  });
  const lobsterQuery = useQuery({
    queryKey: ['home', 'lobster-supervisors'],
    queryFn: () => fetchLobsters(),
    staleTime: 5 * 60 * 1000,
  });
  const outboxQuery = useQuery({
    queryKey: ['home', 'notification-outbox'],
    queryFn: () => fetchNotificationOutbox(5),
    retry: false,
    staleTime: 60 * 1000,
  });
  const learningLoopQuery = useQuery({
    queryKey: ['home', 'skill-improvement-overview', tenantId],
    queryFn: () => fetchSkillImprovementOverview({ tenant_id: tenantId }),
    retry: false,
    staleTime: 60 * 1000,
  });
  const releaseGateQuery = useQuery({
    queryKey: ['home', 'release-gate-latest'],
    queryFn: fetchLatestReleaseGate,
    retry: false,
    staleTime: 60 * 1000,
  });
  const industryTaxonomyQuery = useQuery({
    queryKey: ['industry-taxonomy', 'live-first'],
    queryFn: fetchLiveFirstIndustryTaxonomy,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const campaignsQuery = useCampaigns(1);

  const zoneCards = useMemo(
    () =>
      PRODUCT_ZONES.map((zone) => ({
        ...zone,
        visibleItems: zone.items.slice(0, 3),
      })),
    [],
  );

  if (metricsQuery.isLoading) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-7xl">
          <SurfaceStateCard
            kind="loading"
            title="正在装配租户增长总控台"
            description="首页会把六大区、主管入口、群协作状态、本地执行状态和联调提示汇总到同一个主视角里。"
          />
        </div>
      </div>
    );
  }

  if (metricsQuery.isError) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-7xl">
          <SurfaceStateCard
            kind="error"
            title="首页指标加载失败"
            description="总控台依赖的首页指标接口当前不可用，但六大区导航和主管区入口仍然可以继续使用。"
            actionHref="/governance"
            actionLabel="打开治理中心"
          />
        </div>
      </div>
    );
  }

  const metrics: DashboardMetricsResponse = metricsQuery.data ?? {
    total_leads_today: 0,
    leads_growth_rate: '0%',
    active_campaigns: 0,
    total_videos_published: 0,
    node_health_rate: '0%',
    chart_data_7days: [],
  };

  const readiness = readinessQuery.data?.readiness;
  const blockerCount = Number(readiness?.blocker_count ?? 0);
  const readinessScore = Number(readiness?.score ?? 0);
  const gateStatus = readinessLabel(readiness?.status);
  const growthNum = parseGrowthRate(metrics.leads_growth_rate);
  const industry = resolveIndustryDisplay({
    tag: currentTenant?.industryType,
    taxonomy: industryTaxonomyQuery.data?.taxonomy,
    source: industryTaxonomyQuery.data?.source,
    fallbackLabel: currentTenant?.industryType,
  });
  const industryValue = formatIndustryDisplayValue(industry, {
    localFallbackLabel: '本地回退',
    rawFallbackLabel: '未映射标签',
    emptyLabel: '待配置',
  });
  const queueFail = autopilotQuery.data?.totals.queueProcessFail ?? 0;
  const dlqCount = autopilotQuery.data?.totals.dlqEnqueue ?? 0;
  const supervisorCount = lobsterQuery.data?.count ?? getAllKnownLobsterRoles().length - 1;
  const knownRoles = getAllKnownLobsterRoles().filter((role) => role.id !== 'commander');
  const activeCampaigns = campaignsQuery.data?.list ?? [];
  const outboxItems = outboxQuery.data?.items ?? [];
  const learningSummary = learningLoopQuery.data?.summary;
  const learningMemory = learningLoopQuery.data?.dual_track_memory;
  const learningStatus = learningSummary?.readiness_status || (learningLoopQuery.isLoading ? 'loading' : 'waiting_for_signals');
  const latestReleaseGate = releaseGateQuery.data?.summary;
  const latestFrontendCloseout = resolveLatestFrontendCloseout(releaseGateQuery.data);

  return (
    <div data-testid="dashboard-root" className="relative text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_78%_12%,rgba(245,158,11,0.14),transparent_22%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative mx-auto max-w-7xl space-y-6 p-6">
        <SurfaceHero
          eyebrow="租户增长总控台"
          title="先看今天该盯哪条链路，再决定往主管区、群协作还是本地执行下钻"
          description={`首页不再像普通 dashboard 那样堆功能卡，而是把六大区导航、主管入口、群协作状态、本地执行状态和${LEARNING_LOOP_ROUTES.frontendGaps.title}收成一个主视角。`}
          actions={
            <>
              <Link
                href="/lobsters"
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
              >
                <Bot className="h-4 w-4" />
                打开主管区
              </Link>
              <Link
                href="/collab"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white"
              >
                <MessageSquare className="h-4 w-4" />
                打开群协作区
              </Link>
              <Link
                href={LEARNING_LOOP_ROUTES.frontendGaps.href}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
              >
                <ClipboardList className="h-4 w-4" />
                {LEARNING_LOOP_ROUTES.frontendGaps.title}
              </Link>
              <Link
                href={LEARNING_LOOP_ROUTES.deliveryHub.href}
                className="inline-flex items-center gap-2 rounded-2xl border border-indigo-400/25 bg-indigo-400/10 px-4 py-3 text-sm font-medium text-indigo-100"
              >
                <ShieldCheck className="h-4 w-4" />
                {LEARNING_LOOP_ROUTES.deliveryHub.title}
              </Link>
            </>
          }
          aside={
            <>
              <SurfacePill label="当前租户" value={currentTenant?.name || '未命名租户'} />
              <SurfacePill
                label="所属行业"
                value={industryValue}
                tone={industry.source === 'live' ? 'ok' : industry.source === 'empty' ? 'neutral' : 'warn'}
              />
              <SurfacePill label="上线闸门" value={`${gateStatus} / ${blockerCount}`} tone={blockerCount > 0 ? 'warn' : 'ok'} />
              <SurfacePill label="主管入口" value={`${supervisorCount} 个主管角色`} />
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {zoneCards.map((zone) => {
            const ZoneIcon = zone.icon;
            return (
              <SurfaceLinkCard
                key={zone.id}
                href={zone.href}
                title={t(locale, zone.title)}
                description={t(locale, zone.description)}
                icon={<ZoneIcon className="h-5 w-5" />}
                eyebrow={zone.visibleItems.map((item) => t(locale, item.label)).join(' / ')}
              />
            );
          })}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <SurfaceMetric
            label="主管角色"
            value={String(supervisorCount)}
            helper="总览、详情和能力树入口都已经收口"
            icon={<Bot className="h-4 w-4" />}
          />
          <SurfaceMetric
            label="今日线索"
            value={String(metrics.total_leads_today)}
            helper={`${growthNum >= 0 ? '较昨日提升' : '较昨日下降'} ${Math.abs(growthNum)}%`}
            icon={<MessageSquare className="h-4 w-4" />}
          />
          <SurfaceMetric
            label="增长任务"
            value={String(metrics.active_campaigns)}
            helper="正在推进中的增长任务链"
            icon={<Target className="h-4 w-4" />}
          />
          <SurfaceMetric
            label="群协作"
            value={String(outboxItems.length)}
            helper="最近已发播报与待确认动作"
            icon={<Bell className="h-4 w-4" />}
          />
          <SurfaceMetric
            label="本地执行"
            value={metrics.node_health_rate}
            helper={`queue fail ${queueFail} / DLQ ${dlqCount}`}
            icon={<Radio className="h-4 w-4" />}
          />
          <SurfaceMetric
            label="治理闸门"
            value={String(readinessScore)}
            helper={gateStatus}
            icon={<ShieldCheck className="h-4 w-4" />}
          />
        </section>

        <SurfaceSection
          title="Latest release gate"
          description="把最近一次自动验收直接挂到首页，老板、项目总控和 QA 不进收尾页也能先判断这版是否已经稳定。"
          actionHref={LEARNING_LOOP_ROUTES.releaseChecklist.href}
          actionLabel="打开收尾清单"
        >
          {releaseGateQuery.isLoading ? (
            <SurfaceStateCard
              kind="loading"
              title="正在读取最近一次 release gate"
              description="首页会把 UI smoke 和本地真实数据 evidence 的合并结果收进同一块摘要里。"
            />
          ) : releaseGateQuery.isError || !latestReleaseGate ? (
            <SurfaceStateCard
              kind="warn"
              title="最近一次 release gate 暂不可用"
              description="说明最近还没有跑一键验收，或者当前没有可读取的 gate 结果。"
                actionHref={LEARNING_LOOP_ROUTES.releaseChecklist.href}
              actionLabel="去收尾清单查看"
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-base font-semibold text-white">Gate verdict</div>
                  <SurfacePill
                    label="result"
                    value={latestReleaseGate.ok ? 'pass' : 'needs attention'}
                    tone={latestReleaseGate.ok ? 'ok' : 'warn'}
                  />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SurfaceMetric
                    label="UI routes"
                    value={`${latestReleaseGate.ui_smoke?.metrics?.passed_routes ?? 0}/${latestReleaseGate.ui_smoke?.metrics?.total_routes ?? 0}`}
                    helper="核心页面路由 smoke"
                    icon={<ClipboardList className="h-4 w-4" />}
                  />
                  <SurfaceMetric
                    label="UI interactions"
                    value={`${latestReleaseGate.ui_smoke?.metrics?.passed_interactions ?? 0}/${latestReleaseGate.ui_smoke?.metrics?.total_interactions ?? 0}`}
                    helper="关键交互 smoke"
                    icon={<Bot className="h-4 w-4" />}
                  />
                  <SurfaceMetric
                    label="Data probes"
                    value={`${latestReleaseGate.data_evidence?.metrics?.required_passed ?? 0}/${latestReleaseGate.data_evidence?.metrics?.required_total ?? 0}`}
                    helper="本地真实数据 evidence"
                    icon={<Radio className="h-4 w-4" />}
                  />
                  <SurfaceMetric
                    label="Runtime mode"
                    value={String(latestReleaseGate.data_evidence?.runtime_mode || '-')}
                    helper={String(latestReleaseGate.data_evidence?.dragon_url || '-')}
                    icon={<ShieldCheck className="h-4 w-4" />}
                  />
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
                <div className="text-base font-semibold text-white">Operator summary</div>
                <div className="mt-3 flex flex-wrap gap-3">
                  <SurfacePill label="generated" value={String(latestReleaseGate.generated_at || '-')} />
                  <SurfacePill label="artifact" value={releaseGateQuery.data?.artifact_dir || '-'} />
                </div>
                <div className="mt-4 text-sm leading-7 text-slate-300">
                  {latestReleaseGate.ok
                    ? '最近一次自动验收已经通过，说明首页、监控、日志审核、Trace、技能治理、渠道治理、模型供应商和本地真实数据链都至少完成了一轮稳定验证。'
                    : '最近一次自动验收还有阻塞，建议先看收尾清单页和 gate 报告，不要直接往外扩散结论。'}
                </div>
                {Array.isArray(latestReleaseGate.notes) && latestReleaseGate.notes.length > 0 ? (
                  <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs leading-6 text-slate-400">
                    {latestReleaseGate.notes.join(' | ')}
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    href={LEARNING_LOOP_ROUTES.releaseChecklist.href}
                    className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
                  >
                    查看收尾清单
                  </Link>
                  <Link
                    href={LEARNING_LOOP_ROUTES.projectCloseout.href}
                    className="inline-flex items-center gap-2 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/10 px-4 py-3 text-sm font-medium text-fuchsia-100"
                  >
                    打开项目收口页
                  </Link>
                </div>
              </div>
            </div>
          )}
        </SurfaceSection>

        <SurfaceSection
          title="Latest frontend closeout"
          description="首页也直接挂出最近一次前端总收尾结果。这样不进交付页，也能先知道前端这条线当前是不是整条绿。"
          actionHref={LEARNING_LOOP_ROUTES.deliveryHub.href}
          actionLabel={`打开${LEARNING_LOOP_ROUTES.deliveryHub.title}`}
        >
          {latestFrontendCloseout.available ? (
            <div className="grid gap-4 xl:grid-cols-[0.94fr_1.06fr]">
              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-base font-semibold text-white">Closeout verdict</div>
                  <SurfacePill
                    label="result"
                    value={latestFrontendCloseout.ok ? 'pass' : 'needs attention'}
                    tone={latestFrontendCloseout.ok ? 'ok' : 'warn'}
                  />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SurfaceMetric
                    label="Steps"
                    value={`${latestFrontendCloseout.passedSteps}/${latestFrontendCloseout.totalSteps}`}
                    helper="本轮通过的前端收尾步骤数"
                    icon={<ClipboardList className="h-4 w-4" />}
                  />
                  <SurfaceMetric
                    label="Generated"
                    value={String(latestFrontendCloseout.generatedAt || '-')}
                    helper="最近一次一键收尾时间"
                    icon={<ShieldCheck className="h-4 w-4" />}
                  />
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
                <div className="text-base font-semibold text-white">Operator summary</div>
                <div className="mt-3 text-sm leading-7 text-slate-300">
                  {latestFrontendCloseout.ok
                    ? '最近一次前端总收尾已经通过，说明类型检查、独立构建、关键页面截图和 operations 巡检都完成了一轮稳定验证。'
                    : '最近一次前端总收尾仍有阻塞，建议直接去交付页或项目总收口页查看 artifact 路径与失败步骤。'}
                </div>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Closeout artifact</div>
                    <div className="mt-2 font-mono text-xs text-cyan-200">{latestFrontendCloseout.artifactDir || '-'}</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Screenshot artifact</div>
                    <div className="mt-2 font-mono text-xs text-cyan-200">
                      {latestFrontendCloseout.screenshotArtifactDir || '-'}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    href={LEARNING_LOOP_ROUTES.deliveryHub.href}
                    className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
                  >
                    打开交付页
                  </Link>
                  <Link
                    href={LEARNING_LOOP_ROUTES.projectCloseout.href}
                    className="inline-flex items-center gap-2 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/10 px-4 py-3 text-sm font-medium text-fuchsia-100"
                  >
                    打开项目收口页
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <SurfaceStateCard
              kind="warn"
              title="最近一次前端总收尾暂不可用"
              description="说明最近还没有跑一键前端收尾，或者当前还没有可读取的 closeout 汇总。"
              actionHref={LEARNING_LOOP_ROUTES.deliveryHub.href}
              actionLabel={`去${LEARNING_LOOP_ROUTES.deliveryHub.title}查看`}
            />
          )}
        </SurfaceSection>

        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <SurfaceSection
            title="学习闭环健康度"
            description="首页只放轻量状态：真实信号、Skill 提案、apply/rollback、双轨记忆是否已经跑起来。深入操作继续进入 Skill 进化页或租户 Cockpit。"
            actionHref={LEARNING_LOOP_ROUTES.tenantCockpit.href}
            actionLabel="打开租户 Cockpit"
          >
            {learningLoopQuery.isError ? (
              <SurfaceStateCard
                kind="warn"
                title="学习闭环状态暂不可用"
                description="主入口仍可使用，但 `/api/v1/ai/skills/improvement-overview` 当前没有返回可用数据。"
                actionHref={LEARNING_LOOP_ROUTES.skillsImprovements.href}
                actionLabel="打开 Skill 进化页"
              />
            ) : (
              <div className="space-y-4">
                <div className={`rounded-2xl border p-4 ${learningToneClass(learningStatus)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] opacity-70">Learning loop</div>
                      <div className="mt-2 text-xl font-semibold">{learningReadinessLabel(learningStatus)}</div>
                    </div>
                    <BrainCircuit className="h-8 w-8 opacity-80" />
                  </div>
                  <div className="mt-3 text-sm opacity-85">
                    signals {learningSummary?.signal_total ?? 0} / proposals {learningSummary?.proposal_total ?? 0} / effects {learningSummary?.effect_event_total ?? 0}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatusPanel label="审核与应用" value={`待审 ${learningSummary?.pending_review ?? 0} / 可应用 ${learningSummary?.ready_to_apply ?? 0}`} />
                  <StatusPanel label="恢复链路" value={`已应用 ${learningSummary?.applied ?? 0} / 已回滚 ${learningSummary?.rolled_back ?? 0}`} />
                  <StatusPanel label="效果建议" value={`建议回滚 ${learningSummary?.recommend_rollback ?? 0}`} />
                  <StatusPanel label="双轨记忆" value={`常驻 ${learningMemory?.resident_count ?? 0} / 历史 ${learningMemory?.history_count ?? 0}`} />
                </div>
              </div>
            )}
          </SurfaceSection>

          <SurfaceSection
            title="学习闭环下一步"
            description="如果状态是待审核或建议回滚，优先进入 Skill 进化页处理；如果状态健康，继续从租户 Cockpit 做商业化验收。"
          >
            <div className="grid gap-3 md:grid-cols-4">
              <SurfaceLinkCard
                href={LEARNING_LOOP_ROUTES.skillsImprovements.href}
                title={LEARNING_LOOP_ROUTES.skillsImprovements.title}
                description={LEARNING_LOOP_ROUTES.skillsImprovements.description}
                icon={<BrainCircuit className="h-5 w-5" />}
                compact
              />
              <SurfaceLinkCard
                href={LEARNING_LOOP_ROUTES.memory.href}
                title={LEARNING_LOOP_ROUTES.memory.title}
                description="查看常驻小记忆、历史可检索记忆、来源链和手动沉淀入口。"
                icon={<Sparkles className="h-5 w-5" />}
                compact
              />
              <SurfaceLinkCard
                href={LEARNING_LOOP_ROUTES.report.href}
                title={LEARNING_LOOP_ROUTES.report.title}
                description={LEARNING_LOOP_ROUTES.report.description}
                icon={<ShieldCheck className="h-5 w-5" />}
                compact
              />
              <SurfaceLinkCard
                href={LEARNING_LOOP_ROUTES.projectCloseout.href}
                title={LEARNING_LOOP_ROUTES.projectCloseout.title}
                description={LEARNING_LOOP_ROUTES.projectCloseout.description}
                icon={<ClipboardList className="h-5 w-5" />}
                compact
              />
            </div>
          </SurfaceSection>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
          <SurfaceSection
            title="今天先盯这几条链路"
            description="租户视角下的首页不做功能堆叠，而是先把今天最该看的链路状态讲清楚。"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <StatusPanel label="主管区" value="主管总览 / 主管详情 / 能力树 / 能力配置" />
              <StatusPanel label="训练区" value="对标雷达 -> 策略编排 -> 任务链 -> 工件回放" />
              <StatusPanel label="群协作区" value="播报 / 待确认项 / 审批 / 催办" />
              <StatusPanel label="本地执行区" value={`本轮执行异常 ${queueFail}，待处理 DLQ ${dlqCount}`} />
            </div>
          </SurfaceSection>

          <SurfaceSection
            title="近 7 天租户输入活跃度"
            description="先看租户整体是否在推进，再决定是去主管区、群协作区还是本地执行区。"
          >
            <ExecutionTrendChart
              title="近 7 天线索活跃趋势"
              description="当前以首页指标里的 leads 数据作为总控台活跃趋势。"
              data={metrics.chart_data_7days.map((item) => ({
                date: item.date,
                runs: item.leads,
                success: item.leads,
              }))}
            />
          </SurfaceSection>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.12fr_0.88fr]">
          <SurfaceSection
            title="龙虾主管区入口"
            description="从首页直接落到主管视角，而不是先绕旧 dashboard 再猜页面关系。"
            actionHref="/lobsters"
            actionLabel="打开主管详情"
          >
            <div className="grid gap-3 lg:grid-cols-3">
              {knownRoles.map((role) => (
                <Link
                  key={role.id}
                  href={`/lobsters/${encodeURIComponent(role.id)}`}
                  className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 transition hover:border-cyan-400/25 hover:bg-slate-950/55"
                >
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{role.stageIndex}</div>
                  <div className="mt-2 text-sm font-semibold text-white">{role.zhName}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-300">{role.summary}</div>
                </Link>
              ))}
            </div>
          </SurfaceSection>

          <SurfaceSection
            title="联调与交付提示"
            description="这几处是现在最值得在演示时讲清楚的真实状态。"
            actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
            actionLabel={LEARNING_LOOP_ROUTES.frontendGaps.title}
          >
            <div className="space-y-3">
              <StatusCallout
                label="群协作"
                description="已接通知 outbox 和 Feishu readiness，但确认队列和群内回执仍然是代用态。"
              />
              <StatusCallout
                label="主管区"
                description="详情和能力树已经成型，但主管摘要接口仍需要统一字段命名。"
              />
              <StatusCallout
                label="知识区"
                description="平台行业知识页已经切到 live taxonomy-first，并且会显式标出本地回退；当前剩下的平台级摘要和覆盖统计仍然是前端组合态。"
              />
            </div>
          </SurfaceSection>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <SurfaceSection
            title="当前任务池"
            description="首页保留对今天最接近交付的任务的可见性，便于现场演示和联调。"
            actionHref="/campaigns"
            actionLabel="打开完整任务池"
          >
            <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/20">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/8 bg-black/20 text-slate-400">
                  <tr>
                    <th className="px-4 py-3">任务 ID</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">线索数</th>
                    <th className="px-4 py-3">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {activeCampaigns.slice(0, 5).map((row) => (
                    <tr key={row.campaign_id} className="border-b border-white/6 last:border-0">
                      <td className="px-4 py-3 text-slate-100">{row.campaign_id}</td>
                      <td className="px-4 py-3 text-slate-300">{row.status}</td>
                      <td className="px-4 py-3 text-slate-300">{row.leads_collected}</td>
                      <td className="px-4 py-3 text-slate-500">{new Date(row.created_at).toLocaleString('zh-CN')}</td>
                    </tr>
                  ))}
                  {activeCampaigns.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-500" colSpan={4}>
                        当前还没有可展示的任务数据。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </SurfaceSection>

          <SurfaceSection
            title="群协作实时信号"
            description={`这里先接已发播报和审批阻塞镜像，真实群消息通道仍留在${LEARNING_LOOP_ROUTES.frontendGaps.title}里。`}
            actionHref="/collab"
            actionLabel="打开群协作区"
          >
            {outboxItems.length > 0 ? (
              <div className="space-y-3">
                {outboxItems.map((item) => (
                  <div key={item.file} className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">
                    <div className="text-sm font-medium text-white">{item.kind}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {item.target} / {item.channel}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{item.file}</div>
                  </div>
                ))}
              </div>
            ) : (
              <SurfaceStateCard
                kind="empty"
                title="暂时还没有群播报记录"
                description="这不影响页面演示，但说明当前租户还没有把群播报链路跑起来。"
                actionHref="/collab/reports"
                actionLabel="打开群播报页"
              />
            )}
          </SurfaceSection>
        </section>
      </div>
    </div>
  );
}

function StatusPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm leading-6 text-white">{value}</div>
    </div>
  );
}

function StatusCallout({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="mt-2 text-sm leading-7 text-slate-300">{description}</div>
    </div>
  );
}
