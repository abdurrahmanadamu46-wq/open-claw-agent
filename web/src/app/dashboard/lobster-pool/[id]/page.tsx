'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { CostChart } from '@/components/lobster/CostChart';
import { LobsterStatusBadge } from '@/components/lobster/LobsterStatusBadge';
import { TokenUsageChart } from '@/components/lobster/TokenUsageChart';
import { SurfaceStateCard } from '@/components/operations/SurfacePrimitives';
import {
  fetchLobsterEntity,
  fetchLobsterEntityRuns,
  fetchLobsterEntityStats,
  fetchLobsterMetricsHistory,
  fetchLobsterQualityStats,
  type LobsterHourlyUsageRow,
} from '@/services/endpoints/ai-subservice';

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(value);
}

function normalizeTier(value?: string) {
  if (value === 'simple') return '简单任务';
  if (value === 'standard') return '标准任务';
  if (value === 'complex') return '复杂任务';
  if (value === 'reasoning') return '推理任务';
  return value || '-';
}

function normalizeError(error: unknown) {
  const maybe = error as { response?: { data?: { message?: string; detail?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.response?.data?.detail || maybe?.message || '加载失败';
}

export default function LobsterDetailPage() {
  const params = useParams<{ id: string }>();
  const lobsterId = String(params?.id || 'radar');

  const detailQuery = useQuery({
    queryKey: ['dashboard-lobster-detail', lobsterId],
    queryFn: () => fetchLobsterEntity(lobsterId),
    retry: false,
  });
  const statsQuery = useQuery({
    queryKey: ['dashboard-lobster-detail', 'stats', lobsterId],
    queryFn: () => fetchLobsterEntityStats(lobsterId),
    retry: false,
  });
  const metricsHistoryQuery = useQuery({
    queryKey: ['dashboard-lobster-detail', 'metrics-history', lobsterId],
    queryFn: () => fetchLobsterMetricsHistory(lobsterId, 30),
    retry: false,
  });
  const runsQuery = useQuery({
    queryKey: ['dashboard-lobster-detail', 'runs', lobsterId],
    queryFn: () => fetchLobsterEntityRuns(lobsterId, 12),
    retry: false,
  });
  const qualityQuery = useQuery({
    queryKey: ['dashboard-lobster-detail', 'quality', lobsterId],
    queryFn: () => fetchLobsterQualityStats(lobsterId, 30),
    retry: false,
  });

  const detail = detailQuery.data;
  const stats = statsQuery.data?.stats;
  const tokenUsage = useMemo(
    () =>
      (detail?.hourly_usage ?? []).map((row: LobsterHourlyUsageRow) => {
        return {
          hour: String(row.hour ?? row.date ?? row.created_at ?? ''),
          input_tokens: Number(row.input_tokens ?? 0),
          output_tokens: Number(row.output_tokens ?? 0),
        };
      }),
    [detail?.hourly_usage],
  );
  const costUsage = useMemo(
    () =>
      (detail?.hourly_usage ?? []).map((row: LobsterHourlyUsageRow) => {
        return {
          hour: String(row.hour ?? row.date ?? row.created_at ?? ''),
          cost: Number(row.cost ?? row.cost_cny ?? row.estimated_cost_cny ?? 0),
        };
      }),
    [detail?.hourly_usage],
  );
  const recentRuns = runsQuery.data?.items ?? runsQuery.data?.data ?? detail?.recent_runs ?? [];
  const quality = qualityQuery.data?.stats;
  const metricsHistory = metricsHistoryQuery.data?.items ?? [];

  if (detailQuery.isLoading || statsQuery.isLoading) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="loading"
          title="正在加载单虾详情"
          description="这页现在只消费 live lobster detail / stats / runs / quality contract，不再回落到本地 detail mock。"
        />
      </div>
    );
  }

  if (detailQuery.isError || statsQuery.isError || !detail || !stats) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="error"
          title="单虾详情加载失败"
          description={`当前页面不再使用本地 fallback。detail: ${normalizeError(detailQuery.error)} / stats: ${normalizeError(statsQuery.error)}`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-gray-950 p-6 text-gray-100">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Lobster Detail / Live Contract</div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-4xl">{detail.lobster.icon || '🦞'}</span>
              <div>
                <h1 className="text-4xl font-semibold text-white">
                  {detail.lobster.display_name || detail.lobster.zh_name || detail.lobster.name || lobsterId}
                </h1>
                <p className="mt-1 text-sm text-gray-400">
                  {detail.lobster.role || '未标注角色'} · {normalizeTier(detail.lobster.default_model_tier)}
                </p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-7 text-gray-300">
              这页已经切到新版 live lobster contract。运行摘要、趋势、质量和最近运行都来自真实读接口，失败时直接暴露，不再 silently fallback。
            </p>
          </div>
          <LobsterStatusBadge status={detail.lobster.status || 'idle'} />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Weekly Runs" value={String(stats.weekly_runs)} />
        <StatCard label="Avg Quality" value={stats.avg_quality_score ? `${Math.round(stats.avg_quality_score * 100)}%` : '-'} />
        <StatCard label="P95 Latency" value={`${Math.round(stats.p95_latency_ms)}ms`} />
        <StatCard label="Active Edge Nodes" value={String(stats.active_edge_nodes)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TokenUsageChart data={tokenUsage} />
        <CostChart data={costUsage} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <Card className="border border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">最近运行记录</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {runsQuery.isError ? (
              <SurfaceStateCard
                kind="warn"
                title="运行记录暂时不可用"
                description={normalizeError(runsQuery.error)}
              />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-white/10 bg-black/20 text-gray-400">
                    <tr>
                      <th className="px-4 py-3">时间</th>
                      <th className="px-4 py-3">模型</th>
                      <th className="px-4 py-3">层级</th>
                      <th className="px-4 py-3">Tokens</th>
                      <th className="px-4 py-3">成本</th>
                      <th className="px-4 py-3">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRuns.map((row) => {
                      const totalTokens = Number(row.total_tokens ?? ((row.input_tokens || 0) + (row.output_tokens || 0)));
                      const runCost = Number(row.cost_cny ?? row.estimated_cost_cny ?? 0);
                      return (
                        <tr key={row.run_id || row.id || row.created_at} className="border-b border-white/6 last:border-0">
                          <td className="px-4 py-3 text-gray-300">{new Date(row.created_at).toLocaleString('zh-CN')}</td>
                          <td className="px-4 py-3 text-gray-100">{row.model_used || '-'}</td>
                          <td className="px-4 py-3 text-gray-300">{normalizeTier(row.tier)}</td>
                          <td className="px-4 py-3 text-gray-300">{formatCompactNumber(totalTokens)}</td>
                          <td className="px-4 py-3 text-gray-100">{formatCurrency(runCost)}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-1 text-xs ${
                              row.status === 'success'
                                ? 'bg-green-500/15 text-green-300'
                                : row.status === 'failed'
                                  ? 'bg-red-500/15 text-red-300'
                                  : 'bg-blue-500/15 text-blue-300'
                            }`}>
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {recentRuns.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                          当前没有最近运行记录。
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border border-white/10 bg-white/[0.04] shadow-none">
            <CardHeader>
              <CardTitle className="text-white">质量快照</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {qualityQuery.isError ? (
                <SurfaceStateCard
                  kind="warn"
                  title="质量统计暂时不可用"
                  description={normalizeError(qualityQuery.error)}
                />
              ) : quality ? (
                <>
                  <MiniStat label="Feedbacks" value={String(quality.total_feedbacks)} />
                  <MiniStat label="Thumbs Up" value={String(quality.thumbs_up)} />
                  <MiniStat label="Thumbs Down" value={String(quality.thumbs_down)} />
                  <MiniStat
                    label="Satisfaction"
                    value={quality.satisfaction_rate != null ? `${Math.round(quality.satisfaction_rate * 100)}%` : '-'}
                  />
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Top Tags</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(quality.top_tags || []).map((tag) => (
                        <span key={tag.tag} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200">
                          {tag.tag} · {tag.count}
                        </span>
                      ))}
                      {quality.top_tags.length === 0 ? (
                        <span className="text-sm text-slate-500">当前没有质量标签数据。</span>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <SurfaceStateCard
                  kind="empty"
                  title="当前没有质量反馈"
                  description="说明这只龙虾最近还没有被质量反馈链路覆盖到。"
                />
              )}
            </CardContent>
          </Card>

          <Card className="border border-white/10 bg-white/[0.04] shadow-none">
            <CardHeader>
              <CardTitle className="text-white">30 天趋势摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {metricsHistoryQuery.isError ? (
                <SurfaceStateCard
                  kind="warn"
                  title="趋势摘要暂时不可用"
                  description={normalizeError(metricsHistoryQuery.error)}
                />
              ) : (
                <>
                  <MiniStat label="History Points" value={String(metricsHistory.length)} />
                  <MiniStat
                    label="Latest Task Count"
                    value={String(metricsHistory[metricsHistory.length - 1]?.task_count ?? 0)}
                  />
                  <MiniStat
                    label="Latest Error Rate"
                    value={
                      metricsHistory[metricsHistory.length - 1]?.error_rate != null
                        ? `${Math.round((metricsHistory[metricsHistory.length - 1]?.error_rate ?? 0) * 100)}%`
                        : '-'
                    }
                  />
                  <MiniStat
                    label="Latest Cost"
                    value={String(metricsHistory[metricsHistory.length - 1]?.cost_usd ?? 0)}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="text-sm text-gray-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}
