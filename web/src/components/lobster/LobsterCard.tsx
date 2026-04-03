'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { LobsterStatusBadge } from './LobsterStatusBadge';
import { formatCompactNumber, formatCurrencyCny, tierLabel, type LobsterOverviewRow } from '@/lib/lobster-api';

export function LobsterCard({ lobster }: { lobster: LobsterOverviewRow }) {
  return (
    <Link href={`/dashboard/lobster-pool/${lobster.id}`} className="block">
      <Card className="border border-gray-700 bg-gray-800 p-0 shadow-none transition hover:border-cyan-500/40 hover:bg-gray-800/90">
        <CardHeader className="p-5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{lobster.icon}</span>
                <div>
                  <CardTitle className="text-base text-gray-100">{lobster.name}</CardTitle>
                  <div className="mt-1 text-sm text-gray-400">{lobster.role}</div>
                </div>
              </div>
            </div>
            <LobsterStatusBadge status={lobster.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-5 pt-0">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-gray-300">
            层级：{tierLabel(lobster.tier)}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MetricCell label="Runs" value={String(lobster.run_count_24h)} />
            <MetricCell label="Tokens" value={formatCompactNumber(lobster.total_tokens_24h)} />
            <MetricCell label="Latency" value={`${Math.round(lobster.avg_latency_ms)}ms`} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">24h 成本</span>
            <span className="font-semibold text-gray-100">{formatCurrencyCny(lobster.total_cost_24h)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-gray-100">{value}</div>
    </div>
  );
}
