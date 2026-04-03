'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { CostChart } from '@/components/lobster/CostChart';
import { LobsterStatusBadge } from '@/components/lobster/LobsterStatusBadge';
import { TokenUsageChart } from '@/components/lobster/TokenUsageChart';
import { fetchLobsterDetail, fetchLobsterRoutingHistory, formatCompactNumber, formatCurrencyCny, tierLabel } from '@/lib/lobster-api';

export default function LobsterDetailPage() {
  const params = useParams<{ id: string }>();
  const lobsterId = String(params?.id || 'radar');

  const detailQuery = useQuery({
    queryKey: ['lobster-pool', 'detail', lobsterId],
    queryFn: () => fetchLobsterDetail(lobsterId, 50),
  });
  const historyQuery = useQuery({
    queryKey: ['lobster-pool', 'history', lobsterId],
    queryFn: () => fetchLobsterRoutingHistory({ lobster_id: lobsterId, limit: 8 }),
  });

  const detail = detailQuery.data;

  if (!detail) {
    return <div className="p-6 text-sm text-gray-400">正在加载单虾详情...</div>;
  }

  return (
    <div className="space-y-6 bg-gray-950 p-6 text-gray-100">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Lobster Detail</div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-4xl">{detail.lobster.icon}</span>
              <div>
                <h1 className="text-4xl font-semibold text-white">{detail.lobster.name}</h1>
                <p className="mt-1 text-sm text-gray-400">{detail.lobster.role} · {tierLabel(detail.lobster.tier)}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-7 text-gray-300">
              这里展示单只龙虾的运行状态、成本、时序用量和最近运行记录，方便判断这只虾是否稳定、是否该继续扩容或降载。
            </p>
          </div>
          <LobsterStatusBadge status={detail.lobster.status} />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="24h Runs" value={String(detail.lobster.total_runs_24h)} />
        <StatCard label="24h Tokens" value={formatCompactNumber(detail.lobster.total_tokens_24h)} />
        <StatCard label="24h 成本" value={formatCurrencyCny(detail.lobster.total_cost_cny_24h)} />
        <StatCard label="平均延迟" value={`${Math.round(detail.lobster.avg_latency_ms)}ms`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TokenUsageChart data={detail.hourly_usage.map((item) => ({
          hour: item.hour,
          input_tokens: item.input_tokens,
          output_tokens: item.output_tokens,
        }))} />
        <CostChart data={detail.hourly_usage.map((item) => ({ hour: item.hour, cost: item.cost }))} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">最近运行日志</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 bg-black/20 text-gray-400">
                  <tr>
                    <th className="px-4 py-3">时间</th>
                    <th className="px-4 py-3">模型</th>
                    <th className="px-4 py-3">层级</th>
                    <th className="px-4 py-3">Input</th>
                    <th className="px-4 py-3">Output</th>
                    <th className="px-4 py-3">成本</th>
                    <th className="px-4 py-3">延迟</th>
                    <th className="px-4 py-3">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recent_runs.map((row) => (
                    <tr key={row.run_id} className="border-b border-white/6 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{new Date(row.created_at).toLocaleString('zh-CN')}</td>
                      <td className="px-4 py-3 text-gray-100">{row.model_used}</td>
                      <td className="px-4 py-3 text-gray-300">{tierLabel(row.tier)}</td>
                      <td className="px-4 py-3 text-gray-300">{row.input_tokens}</td>
                      <td className="px-4 py-3 text-gray-300">{row.output_tokens}</td>
                      <td className="px-4 py-3 text-gray-100">{formatCurrencyCny(row.cost_cny)}</td>
                      <td className="px-4 py-3 text-gray-300">{Math.round(row.latency_ms)}ms</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs ${row.status === 'success' ? 'bg-green-500/15 text-green-300' : row.status === 'failed' ? 'bg-red-500/15 text-red-300' : 'bg-blue-500/15 text-blue-300'}`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">相关路由历史</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {(historyQuery.data?.items || []).map((item) => (
              <div key={item.history_id} className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm">
                <div className="font-medium text-gray-100">{item.task_description}</div>
                <div className="mt-2 text-xs text-gray-400">
                  raw_score {item.raw_score.toFixed(2)} · confidence {item.confidence.toFixed(2)}
                </div>
                <div className="mt-2 text-xs text-gray-500">{new Date(item.routed_at).toLocaleString('zh-CN')}</div>
              </div>
            ))}
          </CardContent>
        </Card>
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
