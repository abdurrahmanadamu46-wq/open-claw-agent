'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ExecutionTrendChart } from '@/components/charts/ExecutionTrendChart';
import { LobsterBarChart } from '@/components/charts/LobsterBarChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { LobsterContextMenu } from '@/components/entity-menus/LobsterContextMenu';
import { CostChart } from '@/components/lobster/CostChart';
import { LobsterCard } from '@/components/lobster/LobsterCard';
import { TokenUsageChart } from '@/components/lobster/TokenUsageChart';
import { fetchLobsters } from '@/services/endpoints/ai-subservice';
import {
  fetchLobsterPoolMetrics,
  fetchLobsterPoolOverview,
  fetchLobsterRegistry,
  fetchLobsterRoutingHistory,
  formatCompactNumber,
  formatCurrencyCny,
} from '@/lib/lobster-api';
import { useTenant } from '@/contexts/TenantContext';

export default function LobsterPoolDashboardPage() {
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';

  const overviewQuery = useQuery({
    queryKey: ['lobster-pool', 'overview', tenantId],
    queryFn: () => fetchLobsterPoolOverview(tenantId),
  });
  const metricsQuery = useQuery({
    queryKey: ['lobster-pool', 'metrics', tenantId],
    queryFn: () => fetchLobsterPoolMetrics(24, 'hour'),
  });
  const registryQuery = useQuery({
    queryKey: ['lobster-pool', 'registry'],
    queryFn: fetchLobsterRegistry,
  });
  const lifecycleQuery = useQuery({
    queryKey: ['lobster-pool', 'lifecycles'],
    queryFn: () => fetchLobsters(),
  });
  const historyQuery = useQuery({
    queryKey: ['lobster-pool', 'history'],
    queryFn: () => fetchLobsterRoutingHistory({ limit: 6 }),
  });

  const overview = overviewQuery.data;
  const metrics = metricsQuery.data;
  const registry = registryQuery.data;
  const lobsterRows = useMemo(() => {
    const lifecycleRows = lifecycleQuery.data?.items || [];
    const registryMap = new Map((registry?.lobsters || []).map((item) => [item.id, item]));
    const currentMap = new Map((overview?.lobsters || []).map((item) => [item.id, item]));
    const lifecycleMap = new Map(
      lifecycleRows.map((item) => [String(item.id || ''), item as Record<string, unknown>]),
    );
    return (registry?.lobsters || []).map((item) => ({
      ...item,
      ...currentMap.get(item.id),
      ...lifecycleMap.get(item.id),
      id: item.id,
      status: currentMap.get(item.id)?.status || 'idle',
      run_count_24h: currentMap.get(item.id)?.run_count_24h || 0,
      total_tokens_24h: currentMap.get(item.id)?.total_tokens_24h || 0,
      total_cost_24h: currentMap.get(item.id)?.total_cost_24h || 0,
      avg_latency_ms: currentMap.get(item.id)?.avg_latency_ms || 0,
      lifecycle: String(lifecycleMap.get(item.id)?.lifecycle || 'production'),
      display_name: String(lifecycleMap.get(item.id)?.zh_name || lifecycleMap.get(item.id)?.display_name || item.name),
    }));
  }, [lifecycleQuery.data?.items, overview?.lobsters, registry?.lobsters]);

  if (!overview || !metrics || !registry || !lifecycleQuery.data) {
    return <div className="p-6 text-sm text-gray-400">正在加载龙虾池看板...</div>;
  }

  return (
    <div className="space-y-6 bg-gray-950 p-6 text-gray-100">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Lobster Pool</div>
            <h1 className="mt-3 text-4xl font-semibold text-white">9 只龙虾的实时运行池</h1>
            <p className="mt-3 text-sm leading-7 text-gray-300">
              这里看的是运行态，不是静态名册。状态、成本、Token 消耗和任务路由都会集中在这一页，方便你先判断系统稳不稳，再决定去扩容、收口还是追查异常。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/lobster-pool/scorer" className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm text-cyan-200">
              打开评分模拟器
            </Link>
            <Link href="/dashboard/lobster-skills" className="rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm text-white">
              查看技能总览
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard
          label="龙虾总数"
          value={String(overview.summary.lobster_count)}
          helper={`healthy ${overview.summary.healthy} · degraded ${overview.summary.degraded} · idle ${overview.summary.idle}`}
        />
        <OverviewCard
          label="24h 运行次数"
          value={String(overview.summary.total_runs_24h)}
          helper={`错误率 ${(overview.summary.error_rate_24h * 100).toFixed(1)}%`}
        />
        <OverviewCard
          label="24h Token 消耗"
          value={formatCompactNumber(overview.summary.total_tokens_24h)}
          helper={`${overview.summary.error_count_24h} 次异常记录`}
        />
        <OverviewCard
          label="24h 成本"
          value={formatCurrencyCny(overview.summary.total_cost_cny_24h)}
          helper="按租户聚合后的估算成本"
        />
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {lobsterRows.map((lobster) => (
          <LobsterContextMenu
            key={lobster.id}
            lobster={{
              id: lobster.id,
              name: lobster.name,
              display_name: (lobster as { display_name?: string }).display_name,
              lifecycle: (lobster as { lifecycle?: 'experimental' | 'production' | 'deprecated' }).lifecycle,
              status: lobster.status,
            }}
            onRefresh={async () => {
              await Promise.all([overviewQuery.refetch(), lifecycleQuery.refetch()]);
            }}
          >
            <div>
              <LobsterCard lobster={lobster} />
            </div>
          </LobsterContextMenu>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ExecutionTrendChart
          title="24h 执行活跃趋势"
          description="按小时看执行活跃度，当前用 message_count 近似表示调度活跃量。"
          data={overview.token_usage.map((item) => ({
            date: String(item.hour).slice(11, 16),
            runs: item.message_count,
            success: item.message_count,
          }))}
        />
        <LobsterBarChart
          title="各龙虾执行量（24h）"
          data={lobsterRows.map((lobster) => ({
            display_name: (lobster as { display_name?: string }).display_name || lobster.name,
            runs: lobster.run_count_24h,
          }))}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TokenUsageChart data={metrics.token_usage} />
        <CostChart data={metrics.cost_usage} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">模型成本表</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 bg-black/20 text-gray-400">
                  <tr>
                    <th className="px-4 py-3">模型</th>
                    <th className="px-4 py-3">调用次数</th>
                    <th className="px-4 py-3">Token 消耗</th>
                    <th className="px-4 py-3">估算成本</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.cost_by_model.map((row) => (
                    <tr key={row.model} className="border-b border-white/6 last:border-0">
                      <td className="px-4 py-3 text-gray-100">{row.model}</td>
                      <td className="px-4 py-3 text-gray-300">{row.run_count}</td>
                      <td className="px-4 py-3 text-gray-300">{formatCompactNumber(row.tokens)}</td>
                      <td className="px-4 py-3 text-gray-100">{formatCurrencyCny(row.estimated_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">最近路由历史</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {(historyQuery.data?.items || []).map((item) => (
              <div key={item.history_id} className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm">
                <div className="font-medium text-gray-100">{item.lobster_name}</div>
                <div className="mt-1 text-xs text-gray-500">{item.routed_at}</div>
                <p className="mt-2 text-gray-300">{item.task_description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function OverviewCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="text-sm text-gray-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm text-gray-300">{helper}</div>
    </div>
  );
}
