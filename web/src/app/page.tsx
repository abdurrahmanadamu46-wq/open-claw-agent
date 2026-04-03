'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck, Sparkles, TrendingUp, Waypoints } from 'lucide-react';
import { ExecutionTrendChart } from '@/components/charts/ExecutionTrendChart';
import type { DashboardMetricsResponse } from '@/shared/types/dashboard';
import { getDashboardMetrics } from '@/services/api';
import { fetchCommercialReadiness } from '@/services/endpoints/ai-subservice';
import { fetchAutopilotDashboardMetrics } from '@/services/endpoints/autopilot';
import { useCampaigns } from '@/hooks/queries/useCampaigns';
import { Skeleton } from '@/components/ui/Skeleton';

const MAINLINE_STEPS = [
  {
    index: '01',
    title: '首启',
    description: '先确认行业、目标和风险边界，生成第一批可执行任务。',
    href: '/onboard',
  },
  {
    index: '02',
    title: '策略',
    description: '把目标交给总脑做规划，不在这里手动拆一堆动作。',
    href: '/operations/strategy',
  },
  {
    index: '03',
    title: '任务',
    description: '看清今天真正要推进的是哪几条任务链。',
    href: '/campaigns',
  },
  {
    index: '04',
    title: '线索',
    description: '把结果集中收拢，再决定跟进优先级。',
    href: '/operations/leads',
  },
  {
    index: '05',
    title: '复盘',
    description: '回到 Trace 看证据链、风险链和回滚链。',
    href: '/operations/autopilot/trace',
  },
];

function parseGrowthRate(rate: string): number {
  const parsed = parseFloat(rate.replace(/[%\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readinessStatusLabel(status?: string): string {
  switch (status) {
    case 'ready':
      return '已就绪';
    case 'warning':
      return '存在提醒';
    case 'blocked':
      return '存在阻塞';
    default:
      return '待确认';
  }
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'metrics'],
    queryFn: getDashboardMetrics,
    staleTime: 1000 * 60 * 5,
  });

  const { data: autopilotMetrics } = useQuery({
    queryKey: ['autopilot', 'dashboard-metrics'],
    queryFn: () => fetchAutopilotDashboardMetrics({ windowMinutes: 60 }),
    staleTime: 1000 * 60,
  });

  const { data: commercialReadiness } = useQuery({
    queryKey: ['dashboard', 'commercial-readiness'],
    queryFn: fetchCommercialReadiness,
    retry: false,
  });

  const campaignsQuery = useCampaigns(1);

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-8rem)] bg-[#07111f] p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <Skeleton className="h-56 rounded-[28px] bg-slate-900/70" />
          <Skeleton className="h-64 rounded-[28px] bg-slate-900/70" />
          <Skeleton className="h-72 rounded-[28px] bg-slate-900/70" />
        </div>
      </div>
    );
  }

  const metrics: DashboardMetricsResponse = data ?? {
    total_leads_today: 0,
    leads_growth_rate: '0%',
    active_campaigns: 0,
    total_videos_published: 0,
    node_health_rate: '0%',
    chart_data_7days: [],
  };

  const growthNum = parseGrowthRate(metrics.leads_growth_rate);
  const readiness = commercialReadiness?.readiness;
  const readinessScore = Number(readiness?.score ?? 0);
  const blockerCount = Number(readiness?.blocker_count ?? 0);
  const readinessStatus = readinessStatusLabel(readiness?.status);
  const topBlocker = readiness?.blockers?.[0];

  const queueFail = autopilotMetrics?.totals.queueProcessFail ?? 0;
  const dlqCount = autopilotMetrics?.totals.dlqEnqueue ?? 0;
  const replaySuccessRate = Math.round((autopilotMetrics?.totals.replaySuccessRate ?? 1) * 100);

  const priorities = [
    blockerCount > 0
      ? '先处理商业化闸门里的阻塞项，再决定今天是否继续对外放量。'
      : '当前没有商业化硬阻塞，可以把精力放到任务推进和线索转化。',
    metrics.active_campaigns > 0
      ? `当前有 ${metrics.active_campaigns} 条任务在跑，先挑出今天最重要的一条推进。`
      : '当前没有活跃任务，优先从首启流程或创建新任务开始。',
    dlqCount > 0
      ? 'DLQ 有积压，建议先去 Trace 页面看这轮执行为什么卡住。'
      : '执行链路比较稳定，可以优先看线索质量和转化动作。',
  ];

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-[#07111f] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_78%_12%,rgba(245,158,11,0.14),transparent_22%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative mx-auto max-w-7xl space-y-6 p-6">
        <section className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
                <Sparkles className="h-4 w-4" />
                一页看清今天先做什么
              </div>
              <h2 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-5xl">
                首页不是后台统计墙，
                <br />
                而是今天的主线指挥页。
              </h2>
              <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">
                先看商业化闸门，再看系统状态，再决定去首启、做策略、推进任务、处理线索还是进入复盘。
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link href="/onboard" className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 font-medium text-slate-950">
                打开首启流程
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/campaigns" className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-5 py-3 font-medium text-cyan-100">
                查看任务列表
              </Link>
              <Link href="/dashboard/lobster-pool" className="rounded-2xl border border-white/12 bg-white/[0.04] px-5 py-3 font-medium text-white transition hover:bg-white/[0.08]">
                打开龙虾池看板
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <Waypoints className="h-4 w-4 text-cyan-300" />
              先跑这条主线
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-5">
              {MAINLINE_STEPS.map((step) => (
                <Link
                  key={step.title}
                  href={step.href}
                  className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 transition hover:border-cyan-400/25 hover:bg-slate-950/60"
                >
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{step.index}</div>
                  <div className="mt-2 text-sm font-semibold text-white">{step.title}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-300">{step.description}</div>
                </Link>
              ))}
            </div>
          </article>

          <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                <ShieldCheck className="h-4 w-4 text-cyan-300" />
                商业化闸门
              </div>
              <Link
                href="/settings/commercial-readiness"
                className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200"
              >
                打开检查面板
              </Link>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <MetricPanel label="就绪度评分" value={String(readinessScore)} helper="越接近上线，分数越高" />
              <MetricPanel
                label="当前状态"
                value={readinessStatus}
                helper={blockerCount > 0 ? `${blockerCount} 个阻塞项待处理` : '当前没有硬阻塞'}
              />
              <MetricPanel
                label="发布判断"
                value={blockerCount > 0 ? '暂缓推进' : '可以推进'}
                helper={blockerCount > 0 ? '仍有外部切真条件未满足' : '可继续推进真实交付'}
              />
            </div>

            <div className={`mt-5 rounded-2xl border p-4 ${blockerCount > 0 ? 'border-amber-500/35 bg-amber-500/10 text-amber-200' : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'}`}>
              {topBlocker ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">{topBlocker.title}</div>
                    <div className="rounded-full border border-current/20 px-3 py-1 text-xs opacity-90">{topBlocker.severity}</div>
                  </div>
                  <p className="mt-2 text-sm leading-7">{topBlocker.detail}</p>
                  <div className="mt-2 text-xs uppercase tracking-[0.18em] opacity-80">{topBlocker.next_action}</div>
                </>
              ) : (
                <div className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>当前没有商业化硬阻塞，可以继续推进对外交付。</span>
                </div>
              )}
            </div>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.98fr_1.02fr]">
          <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <AlertTriangle className="h-4 w-4 text-amber-300" />
              今天最值得先做的 3 件事
            </div>
            <div className="mt-4 space-y-3">
              {priorities.map((item, index) => (
                <div key={item} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-7 text-slate-300">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/8 text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <TrendingUp className="h-4 w-4 text-emerald-300" />
              关键结果
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <KpiCard
                label="今日线索"
                value={String(metrics.total_leads_today)}
                helper={`${growthNum >= 0 ? '较昨日提升' : '较昨日下降'} ${Math.abs(growthNum)}%`}
                accent={growthNum >= 0 ? 'text-emerald-300' : 'text-rose-300'}
              />
              <KpiCard label="活跃任务" value={String(metrics.active_campaigns)} helper="当前仍在执行链路里的任务数" />
              <KpiCard label="已发布内容" value={String(metrics.total_videos_published)} helper="已进入执行或发布链路的内容量" />
              <KpiCard label="执行网络" value={metrics.node_health_rate} helper="边缘执行网络当前可用性" />
            </div>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.04fr_0.96fr]">
          <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <ExecutionTrendChart
              title="近 7 天线索活跃趋势"
              description="用统一 chart primitives 看每天活跃输入的变化。当前数据源来自首页 7 日线索趋势。"
              data={metrics.chart_data_7days.map((item) => ({
                date: item.date,
                runs: item.leads,
                success: item.leads,
              }))}
            />
          </article>

          <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <ShieldCheck className="h-4 w-4 text-cyan-300" />
              系统状态摘要
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <MetricPanel label="队列失败" value={String(queueFail)} helper="过去 60 分钟的失败数" />
              <MetricPanel label="DLQ 增量" value={String(dlqCount)} helper="过去 60 分钟死信堆积" />
              <MetricPanel label="重放成功率" value={`${replaySuccessRate}%`} helper="自动恢复链路成功率" />
              <MetricPanel label="节点健康度" value={metrics.node_health_rate} helper="执行网络整体健康状态" />
            </div>
          </article>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-white">最近任务</div>
              <div className="mt-1 text-sm text-slate-400">首页直接看今天最接近交付的一批任务，不用先跳去任务页。</div>
            </div>
            <Link href="/campaigns" className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100">
              打开完整任务池
            </Link>
          </div>

          <div className="mt-5 overflow-hidden rounded-[24px] border border-white/10 bg-black/20">
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
                {(campaignsQuery.data?.list ?? []).slice(0, 5).map((row) => (
                  <tr key={row.campaign_id} className="border-b border-white/6 last:border-0">
                    <td className="px-4 py-3 text-slate-100">{row.campaign_id}</td>
                    <td className="px-4 py-3 text-slate-300">{row.status}</td>
                    <td className="px-4 py-3 text-slate-300">{row.leads_collected}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(row.created_at).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
                {(campaignsQuery.data?.list ?? []).length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={4}>
                      当前还没有任务数据。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricPanel({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-400">{helper}</div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  helper,
  accent = 'text-slate-300',
}: {
  label: string;
  value: string;
  helper: string;
  accent?: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-slate-950/40 p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      <div className={`mt-2 text-sm ${accent}`}>{helper}</div>
    </div>
  );
}
