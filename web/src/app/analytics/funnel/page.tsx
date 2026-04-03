'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { fetchAnalyticsFunnel } from '@/services/endpoints/ai-subservice';
import { useTenant } from '@/contexts/TenantContext';
import type { FunnelResponse } from '@/types/funnel';

export default function FunnelAnalyticsPage() {
  const t = useTranslations('analytics.funnel');
  const { currentTenantId } = useTenant();
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'funnel', currentTenantId],
    queryFn: () => fetchAnalyticsFunnel({ tenantId: currentTenantId }),
    enabled: Boolean(currentTenantId),
    staleTime: 30 * 1000,
  });

  const stages = data?.stages ?? [];
  const totals = data?.totals ?? {};

  const summaryFields = useMemo(
    () => [
      { label: t('summary.window'), value: `${data?.start ?? '—'} → ${data?.end ?? '—'}` },
      { label: t('summary.steps'), value: String(stages.length) },
      { label: t('summary.volume'), value: String(totals?.primary ?? totals?.total ?? '-') },
    ],
    [data?.start, data?.end, stages.length, totals, t],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs text-amber-100">
          {t('badge')}
        </div>
        <h1 className="mt-4 text-3xl font-semibold leading-tight text-white md:text-4xl">{t('title')}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{t('description')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-500">
          <span>{t('meta.tenant', { tenant: currentTenantId ?? t('meta.noTenant') })}</span>
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

      <section className="grid gap-4 lg:grid-cols-[1.02fr_0.98fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">{t('stages.title')}</div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{isLoading ? t('stages.loading') : t('stages.active')}</div>
          </div>
          <div className="mt-4 space-y-3">
            {stages.length ? (
              stages.map((stage, index) => (
                <div key={`${stage.name}-${index}`} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm text-slate-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white">{stage.label ?? stage.name}</div>
                      {stage.dropoff !== undefined ? (
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          {t('stages.dropoff', { dropoff: `${stage.dropoff}%` })}
                        </div>
                      ) : null}
                    </div>
                    <span className="text-lg font-semibold text-white">{stage.value}</span>
                  </div>
                  {stage.conversion_rate !== undefined ? (
                    <div className="mt-2 text-xs text-slate-400">{t('stages.conversion', { rate: `${stage.conversion_rate}%` })}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">{isLoading ? t('stages.loading') : t('stages.empty')}</div>
            )}
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
          <div className="text-sm font-semibold text-white">{t('totals.title')}</div>
          <div className="mt-4 space-y-3">
            {Object.entries(totals).length ? (
              Object.entries(totals).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</span>
                  <span className="text-lg font-semibold text-white">{String(value)}</span>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">{isLoading ? t('totals.loading') : t('totals.empty')}</div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
