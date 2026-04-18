'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ExecutionTrendChart } from '@/components/charts/ExecutionTrendChart';
import { LobsterBarChart } from '@/components/charts/LobsterBarChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { LobsterContextMenu } from '@/components/entity-menus/LobsterContextMenu';
import { LobsterBindingPanel } from '@/components/lobster/LobsterBindingPanel';
import { CostChart } from '@/components/lobster/CostChart';
import { LobsterCard } from '@/components/lobster/LobsterCard';
import { TokenUsageChart } from '@/components/lobster/TokenUsageChart';
import { SurfaceStateCard } from '@/components/operations/SurfacePrimitives';
import { useTenant } from '@/contexts/TenantContext';
import { getLobsterRoleMeta } from '@/lib/lobster-skills';
import type { LobsterOverviewRow, LobsterTier } from '@/lib/lobster-api';
import {
  fetchControlPlaneSupervisorsOverview,
} from '@/services/endpoints/control-plane-overview';
import { fetchLobsterRunsPage } from '@/services/endpoints/ai-subservice';
import type { LobsterRun } from '@/types/lobster';

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCurrencyCny(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(value);
}

function normalizeTier(value?: string): LobsterTier {
  if (value === 'simple' || value === 'standard' || value === 'complex' || value === 'reasoning') return value;
  return 'standard';
}

function normalizeRunCost(run: LobsterRun): number {
  return Number(run.cost_cny ?? run.estimated_cost_cny ?? 0);
}

function normalizeRunTokens(run: LobsterRun): number {
  return Number(run.total_tokens ?? ((run.input_tokens || 0) + (run.output_tokens || 0)));
}

function getRunLobsterId(run: LobsterRun): string {
  return String(run.lobster_id ?? 'unknown');
}

function normalizeError(error: unknown) {
  const maybe = error as { response?: { data?: { message?: string; detail?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.response?.data?.detail || maybe?.message || '加载失败';
}

function groupRunsByHour(runs: LobsterRun[]) {
  const map = new Map<string, { date: string; runs: number; success: number; input_tokens: number; output_tokens: number; cost: number }>();
  for (const run of runs) {
    const createdAt = String(run.created_at || '');
    const key = createdAt ? createdAt.slice(5, 16).replace('T', ' ') : 'unknown';
    const current = map.get(key) || { date: key, runs: 0, success: 0, input_tokens: 0, output_tokens: 0, cost: 0 };
    current.runs += 1;
    if (run.status === 'success') current.success += 1;
    current.input_tokens += Number(run.input_tokens || 0);
    current.output_tokens += Number(run.output_tokens || 0);
    current.cost += normalizeRunCost(run);
    map.set(key, current);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function groupRunsByLobster(runs: LobsterRun[]) {
  const map = new Map<string, number>();
  for (const run of runs) {
    const lobsterId = getRunLobsterId(run);
    map.set(lobsterId, (map.get(lobsterId) || 0) + 1);
  }
  return map;
}

function groupRunsByModel(runs: LobsterRun[]) {
  const map = new Map<string, { model: string; run_count: number; tokens: number; estimated_cost: number }>();
  for (const run of runs) {
    const model = String(run.model_used || 'unknown');
    const current = map.get(model) || { model, run_count: 0, tokens: 0, estimated_cost: 0 };
    current.run_count += 1;
    current.tokens += normalizeRunTokens(run);
    current.estimated_cost += normalizeRunCost(run);
    map.set(model, current);
  }
  return Array.from(map.values()).sort((a, b) => b.run_count - a.run_count);
}

export default function LobsterPoolDashboardPage() {
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';

  const overviewQuery = useQuery({
    queryKey: ['dashboard-lobster-pool', 'supervisors-overview', tenantId],
    queryFn: () => fetchControlPlaneSupervisorsOverview({ tenant_id: tenantId }),
    retry: false,
  });
  const runsQuery = useQuery({
    queryKey: ['dashboard-lobster-pool', 'runs', tenantId],
    queryFn: () => fetchLobsterRunsPage({ page: 1, page_size: 100, sort_by: 'created_at', sort_dir: 'desc' }),
    retry: false,
  });

  const rawOverview = overviewQuery.data;
  const rawLobsters = useMemo(
    () => rawOverview?.lobsters.items ?? rawOverview?.lobsters.lobsters ?? [],
    [rawOverview?.lobsters],
  );
  const rawSkillsOverview = useMemo(
    () => rawOverview?.skills_pool?.overview,
    [rawOverview?.skills_pool],
  );
  const bindingRows = useMemo(
    () => rawSkillsOverview?.llm_bindings ?? [],
    [rawSkillsOverview?.llm_bindings],
  );
  const bindingsByAgent = useMemo(
    () => new Map(bindingRows.map((row) => [row.agent_id, row])),
    [bindingRows],
  );
  const runs = useMemo(() => runsQuery.data?.items ?? runsQuery.data?.data ?? [], [runsQuery.data?.data, runsQuery.data?.items]);
  const runCountByLobster = useMemo(() => groupRunsByLobster(runs), [runs]);
  const runTrend = useMemo(() => groupRunsByHour(runs), [runs]);
  const modelRows = useMemo(() => groupRunsByModel(runs), [runs]);

  const lobsterRows = useMemo<LobsterOverviewRow[]>(() => {
    return rawLobsters.map((item) => {
      const id = String(item.id ?? item.lobster_id ?? '');
      const meta = getLobsterRoleMeta(id);
      const binding = bindingsByAgent.get(id);
      const recentRuns = runs.filter((run) => getRunLobsterId(run) === id);
      const totalTokens = recentRuns.reduce((sum, run) => sum + normalizeRunTokens(run), 0);
      const totalCost = recentRuns.reduce((sum, run) => sum + normalizeRunCost(run), 0);
      const avgLatency =
        recentRuns.length > 0
          ? recentRuns.reduce((sum, run) => sum + Number(run.duration_ms || 0), 0) / recentRuns.length
          : 0;

      return {
        id,
        name: String(item.display_name ?? item.zh_name ?? item.name ?? meta.zhName),
        icon: String(item.icon ?? meta.icon),
        role: String(item.role ?? meta.stageLabel),
        tier: normalizeTier(String(item.default_model_tier ?? binding?.model_name ?? 'standard')),
        status: String(item.status ?? item.lifecycle ?? 'idle') as LobsterOverviewRow['status'],
        run_count_24h: runCountByLobster.get(id) || 0,
        total_tokens_24h: totalTokens,
        total_cost_24h: totalCost,
        avg_latency_ms: avgLatency,
        skills: meta.representativeSkills,
        default_bridge_target: null,
      };
    });
  }, [bindingsByAgent, rawLobsters, runCountByLobster, runs]);

  const summary = useMemo(() => {
    const statusCounts = lobsterRows.reduce(
      (acc, row) => {
        const normalized = String(row.status || '').toLowerCase();
        if (normalized === 'healthy' || normalized === 'active') acc.healthy += 1;
        else if (normalized === 'degraded' || normalized === 'training') acc.degraded += 1;
        else if (normalized === 'critical' || normalized === 'error' || normalized === 'offline') acc.critical += 1;
        else acc.idle += 1;
        return acc;
      },
      { healthy: 0, degraded: 0, critical: 0, idle: 0 },
    );
    const totalRuns = runs.length;
    const totalTokens = runs.reduce((sum, run) => sum + normalizeRunTokens(run), 0);
    const totalCost = runs.reduce((sum, run) => sum + normalizeRunCost(run), 0);
    const errorCount = runs.filter((run) => run.status === 'failed' || run.status === 'error').length;
    return {
      lobster_count: rawOverview?.summary.lobster_count ?? lobsterRows.length,
      healthy: statusCounts.healthy,
      degraded: statusCounts.degraded,
      critical: statusCounts.critical,
      idle: statusCounts.idle,
      total_runs: totalRuns,
      total_tokens: totalTokens,
      total_cost: totalCost,
      error_count: errorCount,
      error_rate: totalRuns > 0 ? errorCount / totalRuns : 0,
    };
  }, [lobsterRows, rawOverview?.summary.lobster_count, runs]);

  if (overviewQuery.isLoading || runsQuery.isLoading) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="loading"
          title="正在加载龙虾池总览"
          description="这页正在切到 live-only 聚合链路：supervisors overview + runs page，不再使用本地 lobster-pool overview mock。"
        />
      </div>
    );
  }

  if (overviewQuery.isError || runsQuery.isError || !rawOverview) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="error"
          title="龙虾池总览加载失败"
          description={`当前页面不再使用本地 fallback。overview: ${normalizeError(overviewQuery.error)} / runs: ${normalizeError(runsQuery.error)}`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-gray-950 p-6 text-gray-100">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Lobster Pool / Live Aggregate</div>
            <h1 className="mt-3 text-4xl font-semibold text-white">龙虾运行池总览</h1>
            <p className="mt-3 text-sm leading-7 text-gray-300">
              这页现在走 live-only 聚合链路。角色列表来自 supervisors overview，运行活跃度来自 live runs page，不再依赖旧的本地 pool overview / metrics / registry mock。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/lobster-pool/scorer" className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm text-cyan-200">
              打开评分模拟器
            </Link>
            <Link href="/lobsters/capability-tree" className="rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm text-white">
              查看主管能力树
            </Link>
          </div>
        </div>
      </section>

      <LobsterBindingPanel
        title="龙虾池接线深度"
        items={[
          {
            label: 'overview',
            binding: {
              source: 'live',
              endpoint: '/api/v1/control-plane/supervisors/overview',
              detail: 'Read from live supervisors overview aggregate.',
            },
          },
          {
            label: 'runs',
            binding: {
              source: 'live',
              endpoint: '/api/v1/lobsters/runs',
              detail: 'Read from live lobster runs page and aggregated on the client.',
            },
          },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard
          label="龙虾总数"
          value={String(summary.lobster_count)}
          helper={`healthy ${summary.healthy} · degraded ${summary.degraded} · idle ${summary.idle}`}
        />
        <OverviewCard
          label="Recent Runs"
          value={String(summary.total_runs)}
          helper={`错误率 ${(summary.error_rate * 100).toFixed(1)}%`}
        />
        <OverviewCard
          label="Recent Tokens"
          value={formatCompactNumber(summary.total_tokens)}
          helper={`${summary.error_count} 次异常记录`}
        />
        <OverviewCard
          label="Recent Cost"
          value={formatCurrencyCny(summary.total_cost)}
          helper="基于 live run feed 聚合"
        />
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {lobsterRows.map((lobster) => (
          <LobsterContextMenu
            key={lobster.id}
            lobster={{
              id: lobster.id,
              name: lobster.name,
              display_name: lobster.name,
              lifecycle: 'production',
              status: lobster.status,
            }}
            onRefresh={async () => {
              await Promise.all([overviewQuery.refetch(), runsQuery.refetch()]);
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
          title="Recent Execution Trend"
          description="按最新 live run feed 聚合，不再依赖本地 token_usage fixture。"
          data={runTrend.map((item) => ({
            date: item.date,
            runs: item.runs,
            success: item.success,
          }))}
        />
        <LobsterBarChart
          title="各龙虾近期执行量"
          data={lobsterRows.map((lobster) => ({
            display_name: lobster.name,
            runs: lobster.run_count_24h,
          }))}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TokenUsageChart
          data={runTrend.map((item) => ({
            hour: item.date,
            input_tokens: item.input_tokens,
            output_tokens: item.output_tokens,
          }))}
        />
        <CostChart
          data={runTrend.map((item) => ({
            hour: item.date,
            cost: Number(item.cost.toFixed(2)),
          }))}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">模型使用聚合</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 bg-black/20 text-gray-400">
                  <tr>
                    <th className="px-4 py-3">模型</th>
                    <th className="px-4 py-3">运行次数</th>
                    <th className="px-4 py-3">Token 消耗</th>
                    <th className="px-4 py-3">估算成本</th>
                  </tr>
                </thead>
                <tbody>
                  {modelRows.map((row) => (
                    <tr key={row.model} className="border-b border-white/6 last:border-0">
                      <td className="px-4 py-3 text-gray-100">{row.model}</td>
                      <td className="px-4 py-3 text-gray-300">{row.run_count}</td>
                      <td className="px-4 py-3 text-gray-300">{formatCompactNumber(row.tokens)}</td>
                      <td className="px-4 py-3 text-gray-100">{formatCurrencyCny(row.estimated_cost)}</td>
                    </tr>
                  ))}
                  {modelRows.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-500" colSpan={4}>
                        当前没有可聚合的模型运行记录。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">最近运行动态</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {runs.slice(0, 6).map((run) => (
              <div key={run.run_id || run.id || run.created_at} className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm">
                <div className="font-medium text-gray-100">{getRunLobsterId(run)}</div>
                <div className="mt-1 text-xs text-gray-500">{new Date(run.created_at).toLocaleString('zh-CN')}</div>
                <div className="mt-2 text-gray-300">
                  {run.model_used || '-'} · {normalizeTier(run.tier)}
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  tokens {formatCompactNumber(normalizeRunTokens(run))} · cost {formatCurrencyCny(normalizeRunCost(run))}
                </div>
              </div>
            ))}
            {runs.length === 0 ? (
              <SurfaceStateCard
                kind="empty"
                title="当前没有最近运行动态"
                description="live runs page 当前没有返回记录，所以总览页也不会再用本地 history fixture 补齐。"
              />
            ) : null}
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
