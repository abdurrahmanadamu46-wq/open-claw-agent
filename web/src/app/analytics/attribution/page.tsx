'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { fetchAnalyticsAttribution } from '@/services/endpoints/ai-subservice';
import { useTenant } from '@/contexts/TenantContext';
import type { AttributionResponse } from '@/types/attribution';

function formatWindowLabel(data?: AttributionResponse) {
  const start = data?.start?.trim();
  const end = data?.end?.trim();
  if (!start && !end) {
    return '—';
  }
  if (!start) {
    return end!;
  }
  if (!end) {
    return start;
  }
  return `${start} → ${end}`;
}

export default function AttributionAnalyticsPage() {
  const t = useTranslations('analytics.attribution');
  const { currentTenantId } = useTenant();
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'attribution', currentTenantId],
    queryFn: () => fetchAnalyticsAttribution({ tenantId: currentTenantId }),
    enabled: Boolean(currentTenantId),
    staleTime: 30 * 1000,
  });

  const totals = data?.totals ?? {};
  const series = data?.series ?? [];
  const highlights = data?.highlights ?? [];
  const windowLabel = formatWindowLabel(data);

  const summaryFields = useMemo(
    () => [
      { label: t('summary.model'), value: data?.model ?? t('summary.unknown') },
      { label: t('summary.window'), value: windowLabel },
      { label: t('summary.channels'), value: String(series.length) },
    ],
    [data?.model, series.length, t, windowLabel],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs text-emerald-100">
          {t('badge')}
        </div>
        <h1 className="mt-4 text-3xl font-semibold leading-tight text-white md:text-4xl">{t('title')}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{t('description')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-500">
          <span>{t('meta.tenant', { tenant: currentTenantId ?? t('meta.noTenant') })}</span>
          <span className="hidden md:inline">{t('meta.dataHint')}</span>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {summaryFields.map((field) => (
          <article key={field.label} className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{field.label}</div>
            <div className="mt-2 text-2xl font-semibold text-white">{field.value}</div>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">{t('totals.title')}</div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{isLoading ? t('totals.loading') : t('totals.updated')}</div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {Object.entries(totals).slice(0, 4).map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
                <div className="mt-2 text-2xl font-semibold text-white">{String(value)}</div>
              </div>
            ))}
            {Object.keys(totals).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/20 p-4 text-sm text-slate-400">
                {isLoading ? t('totals.loading') : t('totals.empty')}
              </div>
            ) : null}
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
          <div className="text-sm font-semibold text-white">{t('series.title')}</div>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{t('series.sub')}</p>
          <div className="mt-4 space-y-3">
            {series.length ? (
              series.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                  <div>
                    <div className="font-semibold text-white">{item.label ?? item.name}</div>
                    <div className="text-xs text-slate-400">{item.share !== undefined ? `${item.share}% ${t('series.share')}` : t('series.noShare')}</div>
                  </div>
                  <div className="text-lg font-semibold text-white">{item.value}</div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">{isLoading ? t('series.loading') : t('series.empty')}</div>
            )}
          </div>

          <div className="mt-6 text-sm font-semibold text-white">{t('highlights.title')}</div>
          <div className="mt-3 space-y-2 text-sm text-slate-300">
            {highlights.length ? (
              highlights.map((item, index) => (
                <div key={`${item.label}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.label}</div>
                  <div className="mt-1 text-lg font-semibold text-white">{item.value}</div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">{isLoading ? t('highlights.loading') : t('highlights.empty')}</div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
