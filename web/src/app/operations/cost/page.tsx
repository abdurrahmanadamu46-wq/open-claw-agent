'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Coins, Cpu, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { StatusCard } from '@/components/lobster/StatusCard';
import { fetchLobsterCostDetail, fetchLobsterCostSummary, fetchLobsterCostTimeseries } from '@/services/endpoints/lobster-cost';
import { getCurrentUser } from '@/services/endpoints/user';

function formatUsd(value?: number | null) {
  if (!Number.isFinite(Number(value))) return '$0.00';
  return `$${Number(value).toFixed(2)}`;
}

function formatNumber(value?: number | null) {
  if (!Number.isFinite(Number(value))) return '-';
  return Number(value).toLocaleString('en-US');
}

function formatPercent(value?: number | null) {
  if (!Number.isFinite(Number(value))) return '-';
  return `${Number(value).toFixed(1)}%`;
}

function trendTone(direction?: string) {
  if (direction === 'up') return 'text-rose-300';
  if (direction === 'down') return 'text-emerald-300';
  return 'text-slate-300';
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/25 p-6 text-center">
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="mt-2 text-sm text-slate-400">{description}</div>
    </div>
  );
}

export default function OperationsCostPage() {
  const t = useTranslations('operations.lobsterCost');
  const common = useTranslations('common');
  const [rangeDays, setRangeDays] = useState<1 | 7 | 30>(7);
  const [selectedLobsterId, setSelectedLobsterId] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'cost' | 'calls' | 'trend'>('cost');
  const [selectedCallId, setSelectedCallId] = useState('');

  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    staleTime: 60 * 1000,
  });

  const currentUser = currentUserQuery.data;
  const isAdmin = Boolean(
    currentUser?.isAdmin ||
      currentUser?.roles?.some((role) => String(role).toLowerCase() === 'admin'),
  );

  const summaryQuery = useQuery({
    queryKey: ['lobster-cost', 'summary', rangeDays],
    queryFn: () => fetchLobsterCostSummary(rangeDays),
    enabled: isAdmin,
    staleTime: 30 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!selectedLobsterId && summaryQuery.data?.items?.length) {
      setSelectedLobsterId(summaryQuery.data.items[0].lobster_id);
    }
  }, [selectedLobsterId, summaryQuery.data]);

  const activeLobsterId = selectedLobsterId || summaryQuery.data?.items?.[0]?.lobster_id || '';

  const detailQuery = useQuery({
    queryKey: ['lobster-cost', 'detail', activeLobsterId, rangeDays],
    queryFn: () => fetchLobsterCostDetail(activeLobsterId, rangeDays),
    enabled: isAdmin && Boolean(activeLobsterId),
    staleTime: 30 * 1000,
    retry: false,
  });

  const timeseriesQuery = useQuery({
    queryKey: ['lobster-cost', 'timeseries', activeLobsterId, rangeDays],
    queryFn: () => fetchLobsterCostTimeseries(activeLobsterId, rangeDays),
    enabled: isAdmin && Boolean(activeLobsterId),
    staleTime: 30 * 1000,
    retry: false,
  });

  const rangeLabel = useMemo(() => {
    if (rangeDays === 1) return t('ranges.d1');
    if (rangeDays === 30) return t('ranges.d30');
    return t('ranges.d7');
  }, [rangeDays, t]);

  const summaryItems = useMemo(() => summaryQuery.data?.items ?? [], [summaryQuery.data?.items]);
  const budget = summaryQuery.data?.budget;
  const detail = detailQuery.data?.summary;
  const topCalls = useMemo(() => detailQuery.data?.top_calls ?? [], [detailQuery.data?.top_calls]);
  const selectedCall = topCalls.find((item) => item.call_id === selectedCallId) ?? topCalls[0] ?? null;
  const timeseries = useMemo(
    () =>
      (timeseriesQuery.data?.data ?? []).map((item) => ({
        date: item.timestamp.slice(5),
        cost: Number(item.cost_usd || 0),
        calls: Number(item.call_count || 0),
        input: Number(item.input_tokens || 0),
        output: Number(item.output_tokens || 0),
      })),
    [timeseriesQuery.data?.data],
  );

  const visibleSummaryItems = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const nextItems = summaryItems.filter((item) =>
      !normalized ? true : item.lobster_id.toLowerCase().includes(normalized),
    );
    nextItems.sort((left, right) => {
      if (sortBy === 'calls') return Number(right.call_count || 0) - Number(left.call_count || 0);
      if (sortBy === 'trend') return Number(right.trend_pct || 0) - Number(left.trend_pct || 0);
      return Number(right.total_cost_usd || 0) - Number(left.total_cost_usd || 0);
    });
    return nextItems;
  }, [search, sortBy, summaryItems]);

  const totals = useMemo(
    () => ({
      totalCalls: summaryItems.reduce((sum, item) => sum + Number(item.call_count || 0), 0),
      totalTokens: summaryItems.reduce((sum, item) => sum + Number(item.total_tokens || 0), 0),
      avgCostPerCall:
        summaryItems.reduce((sum, item) => sum + Number(item.total_cost_usd || 0), 0) /
        Math.max(1, summaryItems.reduce((sum, item) => sum + Number(item.call_count || 0), 0)),
    }),
    [summaryItems],
  );

  useEffect(() => {
    if (topCalls.length > 0 && !topCalls.some((item) => item.call_id === selectedCallId)) {
      setSelectedCallId(topCalls[0].call_id);
    }
  }, [selectedCallId, topCalls]);

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
          <Coins className="h-4 w-4" />
          {t('badge')}
        </div>
        <h1 className="mt-4 text-3xl font-semibold leading-tight text-white md:text-4xl">{t('title')}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{t('description')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-500">
          <span>{t('meta.tenant', { tenant: currentUser?.tenantId ?? '-' })}</span>
          <span>{t('meta.operator', { operator: currentUser?.name ?? currentUser?.id ?? '-' })}</span>
        </div>
      </section>

      {!isAdmin ? (
        <EmptyState title={t('states.nonAdminTitle')} description={t('states.nonAdminDescription')} />
      ) : (
        <>
          <section className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">{t('filters.title')}</div>
                <div className="mt-1 text-sm text-slate-400">{t('filters.description')}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-2xl border border-white/10 bg-black/20 p-1">
                  {([
                    { value: 1 as const, label: t('ranges.d1') },
                    { value: 7 as const, label: t('ranges.d7') },
                    { value: 30 as const, label: t('ranges.d30') },
                  ]).map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setRangeDays(item.value)}
                      className={`rounded-xl px-3 py-2 text-sm transition ${
                        rangeDays === item.value
                          ? 'bg-cyan-400/15 text-cyan-100'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void summaryQuery.refetch();
                    void detailQuery.refetch();
                    void timeseriesQuery.refetch();
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-400/40 hover:text-white"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${
                      summaryQuery.isFetching || detailQuery.isFetching || timeseriesQuery.isFetching
                        ? 'animate-spin'
                        : ''
                    }`}
                  />
                  {common('refresh')}
                </button>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatusCard title={t('summary.totalCost')} value={formatUsd(budget?.total_cost_usd)} />
            <StatusCard title={t('summary.lobsterCount')} value={formatNumber(budget?.lobster_count)} />
            <StatusCard title={t('summary.topLobster')} value={budget?.top_lobster || '-'} />
            <StatusCard title={t('summary.range')} value={rangeLabel} />
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <StatusCard title={t('summary.totalCalls')} value={formatNumber(totals.totalCalls)} />
            <StatusCard title={t('summary.totalTokens')} value={formatNumber(totals.totalTokens)} />
            <StatusCard title={t('summary.avgCostPerCall')} value={formatUsd(totals.avgCostPerCall)} />
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{t('list.title')}</div>
                  <div className="mt-1 text-sm text-slate-400">{t('list.description')}</div>
                </div>
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {summaryQuery.isLoading ? t('states.loading') : `${visibleSummaryItems.length} / ${summaryItems.length}`}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                  placeholder={t('list.searchPlaceholder')}
                />
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as 'cost' | 'calls' | 'trend')}
                  className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                >
                  <option value="cost">{t('list.sortCost')}</option>
                  <option value="calls">{t('list.sortCalls')}</option>
                  <option value="trend">{t('list.sortTrend')}</option>
                </select>
              </div>

              <div className="mt-4 space-y-3">
                {visibleSummaryItems.length ? (
                  visibleSummaryItems.map((item) => (
                    <button
                      key={item.lobster_id}
                      type="button"
                      onClick={() => setSelectedLobsterId(item.lobster_id)}
                      className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                        activeLobsterId === item.lobster_id
                          ? 'border-cyan-300/60 bg-cyan-500/10'
                          : 'border-white/10 bg-black/20 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{item.lobster_id}</div>
                          <div className="mt-1 text-xs text-slate-400">
                            {t('list.calls', { count: item.call_count })} · {t('list.tokens', { count: item.total_tokens })}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-white">{formatUsd(item.total_cost_usd)}</div>
                          <div className={`mt-1 inline-flex items-center gap-1 text-xs ${trendTone(item.trend_direction)}`}>
                            {item.trend_direction === 'down' ? (
                              <TrendingDown className="h-3.5 w-3.5" />
                            ) : (
                              <TrendingUp className="h-3.5 w-3.5" />
                            )}
                            {formatPercent(item.trend_pct)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                          {t('list.avgCost')}: {formatUsd(item.avg_cost_per_call)}
                        </div>
                        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                          {t('list.maxCost')}: {formatUsd(item.max_cost_usd)}
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <EmptyState
                    title={summaryQuery.isLoading ? t('states.loading') : t('list.emptyTitle')}
                    description={summaryQuery.isLoading ? t('states.loadingDescription') : t('list.emptyFilteredDescription')}
                  />
                )}
              </div>
            </article>

            <div className="space-y-4">
              <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{t('detail.title')}</div>
                    <div className="mt-1 text-sm text-slate-400">{t('detail.description')}</div>
                  </div>
                  <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
                    {activeLobsterId || '-'}
                  </div>
                </div>

                {detail ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <StatusCard title={t('detail.totalCalls')} value={formatNumber(detail.call_count)} />
                    <StatusCard title={t('detail.avgCost')} value={formatUsd(detail.avg_cost_per_call)} />
                    <StatusCard title={t('detail.maxCost')} value={formatUsd(detail.max_cost_usd)} />
                    <StatusCard title={t('detail.totalTokens')} value={formatNumber(detail.total_tokens)} />
                    <StatusCard title={t('detail.inputTokens')} value={formatNumber(detail.total_input_tokens)} />
                    <StatusCard title={t('detail.outputTokens')} value={formatNumber(detail.total_output_tokens)} />
                  </div>
                ) : (
                  <EmptyState title={t('detail.emptyTitle')} description={t('detail.emptyDescription')} />
                )}
              </article>

              <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{t('chart.title')}</div>
                    <div className="mt-1 text-sm text-slate-400">{t('chart.description')}</div>
                  </div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{rangeLabel}</div>
                </div>

                {timeseries.length ? (
                  <div className="mt-4">
                    <ChartContainer
                      className="h-[260px]"
                      config={{
                        cost: { label: t('chart.costLine'), color: '#22d3ee' },
                        calls: { label: t('chart.callsLine'), color: '#f59e0b' },
                      }}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={timeseries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Line type="monotone" dataKey="cost" name={t('chart.costLine')} stroke="var(--color-cost)" strokeWidth={2.5} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="calls" name={t('chart.callsLine')} stroke="var(--color-calls)" strokeWidth={2.5} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </div>
                ) : (
                  <div className="mt-4">
                    <EmptyState title={t('chart.emptyTitle')} description={t('chart.emptyDescription')} />
                  </div>
                )}
              </article>

              <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{t('topCalls.title')}</div>
                    <div className="mt-1 text-sm text-slate-400">{t('topCalls.description')}</div>
                  </div>
                  <Cpu className="h-4 w-4 text-slate-500" />
                </div>

                <div className="mt-4 space-y-3">
                  {topCalls.length ? (
                    topCalls.map((item) => (
                      <button
                        key={item.call_id}
                        type="button"
                        onClick={() => setSelectedCallId(item.call_id)}
                        className={`w-full rounded-2xl border p-4 text-left ${
                          selectedCall?.call_id === item.call_id
                            ? 'border-cyan-300/60 bg-cyan-500/10'
                            : 'border-white/10 bg-black/20'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white">{item.call_id}</div>
                            <div className="mt-1 text-xs text-slate-400">
                              {(item.model || t('topCalls.noModel'))} · {(item.provider || t('topCalls.noProvider'))}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold text-white">{formatUsd(item.cost_usd)}</div>
                            <div className="mt-1 text-xs text-slate-400">{item.status}</div>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                            {t('topCalls.latency')}: {item.latency_ms}ms
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                            {t('topCalls.inputTokens')}: {formatNumber(item.input_tokens)}
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                            {t('topCalls.outputTokens')}: {formatNumber(item.output_tokens)}
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <EmptyState title={t('topCalls.emptyTitle')} description={t('topCalls.emptyDescription')} />
                  )}
                </div>

                {selectedCall ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('topCalls.selected')}</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-200">
                        {t('topCalls.routeTier')}: {selectedCall.route_tier || '-'}
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-200">
                        {t('topCalls.createdAt')}: {selectedCall.created_at || '-'}
                      </div>
                    </div>
                  </div>
                ) : null}
              </article>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
