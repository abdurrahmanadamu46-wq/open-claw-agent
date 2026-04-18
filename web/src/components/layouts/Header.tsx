'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { Bell, HelpCircle, Waypoints } from 'lucide-react';
import { GlobalSearch } from '@/components/GlobalSearch';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { useTenant } from '@/contexts/TenantContext';
import { PRODUCT_LENSES, resolveCurrentLens, t } from '@/config/operations-navigation';
import {
  fetchLiveFirstIndustryTaxonomy,
  formatIndustryDisplayValue,
  resolveIndustryDisplay,
} from '@/lib/live-industry-taxonomy';
import { fetchCommercialReadiness } from '@/services/endpoints/ai-subservice';

const HEADER_COPY = {
  badge: { zh: '租户增长总控状态', en: 'Tenant Control Status' },
  currentLens: { zh: '当前视角', en: 'Current Lens' },
  tenant: { zh: '租户', en: 'Tenant' },
  industry: { zh: '行业', en: 'Industry' },
  gate: { zh: '上线闸门', en: 'Launch Gate' },
  blockers: { zh: '阻塞项', en: 'Blockers' },
  collab: { zh: '群协作', en: 'Collab' },
  search: { zh: '搜索...', en: 'Search...' },
  commercialGate: { zh: '商业化闸门', en: 'Commercial Gate' },
  helpCenter: { zh: '帮助中心', en: 'Help Center' },
  partner: { zh: '代理经营台', en: 'Partner Portal' },
  healthy: { zh: '可推进', en: 'Ready' },
  guarded: { zh: '需关注', en: 'Guarded' },
  blocked: { zh: '存在阻塞', en: 'Blocked' },
  collabState: { zh: '播报 / 审批 / 催办', en: 'Reports / Approvals / Nudges' },
  industryLocalFallback: { zh: '本地回退', en: 'local fallback' },
  industryUnmapped: { zh: '未映射标签', en: 'unmapped tag' },
} as const;

export function Header() {
  const pathname = usePathname() ?? '';
  const locale = useLocale();
  const currentLens = resolveCurrentLens(pathname);
  const { currentTenant } = useTenant();
  const readinessQuery = useQuery({
    queryKey: ['header', 'commercial-readiness'],
    queryFn: fetchCommercialReadiness,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const industryTaxonomyQuery = useQuery({
    queryKey: ['industry-taxonomy', 'live-first'],
    queryFn: fetchLiveFirstIndustryTaxonomy,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const readiness = readinessQuery.data?.readiness;
  const blockerCount = Number(readiness?.blocker_count ?? 0);
  const industry = resolveIndustryDisplay({
    tag: currentTenant?.industryType,
    taxonomy: industryTaxonomyQuery.data?.taxonomy,
    source: industryTaxonomyQuery.data?.source,
    fallbackLabel: currentTenant?.industryType,
  });
  const industryValue = formatIndustryDisplayValue(industry, {
    localFallbackLabel: t(locale, HEADER_COPY.industryLocalFallback),
    rawFallbackLabel: t(locale, HEADER_COPY.industryUnmapped),
    emptyLabel: '-',
  });
  const gateText =
    blockerCount > 0
      ? `${t(locale, HEADER_COPY.blocked)} / ${blockerCount}`
      : readiness?.status === 'warning'
        ? t(locale, HEADER_COPY.guarded)
        : t(locale, HEADER_COPY.healthy);

  return (
    <header className="border-b border-white/10 bg-[#07111f]/80 px-6 py-5 backdrop-blur">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Waypoints className="h-4 w-4" />
              {t(locale, HEADER_COPY.badge)}
            </div>
            <div className="mt-3 flex items-center gap-3 text-white">
              <h1 className="text-2xl font-semibold">{t(locale, currentLens.label)}</h1>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                {t(locale, HEADER_COPY.currentLens)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-7 text-slate-400">{t(locale, currentLens.description)}</p>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <StatusChip label={t(locale, HEADER_COPY.tenant)} value={currentTenant?.name || '-'} />
              <StatusChip
                label={t(locale, HEADER_COPY.industry)}
                value={industryValue}
                tone={industry.source === 'live' ? 'ok' : industry.source === 'empty' ? 'neutral' : 'warn'}
              />
              <StatusChip label={t(locale, HEADER_COPY.gate)} value={gateText} tone={blockerCount > 0 ? 'warn' : 'ok'} />
              <StatusChip label={t(locale, HEADER_COPY.blockers)} value={String(blockerCount)} />
              <StatusChip label={t(locale, HEADER_COPY.collab)} value={t(locale, HEADER_COPY.collabState)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                document.dispatchEvent(new CustomEvent('global-search-open'));
              }}
              className="inline-flex items-center justify-between rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
            >
              <span>{t(locale, HEADER_COPY.search)}</span>
              <kbd className="ml-3 rounded bg-white/10 px-2 py-0.5 text-xs text-slate-400">Ctrl K</kbd>
            </button>
            <LocaleSwitcher />
            <Link
              href="/settings/commercial-readiness"
              className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-400/15"
            >
              {t(locale, HEADER_COPY.commercialGate)}
            </Link>
            <Link
              href="/partner/portal"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
            >
              <Bell className="h-4 w-4" />
              {t(locale, HEADER_COPY.partner)}
            </Link>
            <Link
              href="/help"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
            >
              <HelpCircle className="h-4 w-4" />
              {t(locale, HEADER_COPY.helpCenter)}
            </Link>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-7">
          {PRODUCT_LENSES.map((item) => {
            const active = item.id === currentLens.id;
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`rounded-2xl border px-4 py-3 text-sm transition ${
                  active
                    ? 'border-cyan-400/35 bg-cyan-400/10 text-cyan-100'
                    : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white'
                }`}
              >
                <div className="text-[11px] uppercase tracking-[0.18em] opacity-70">
                  {t(locale, HEADER_COPY.currentLens)}
                </div>
                <div className="mt-2 flex items-center gap-2 font-medium">
                  <Icon className="h-4 w-4" />
                  <span>{t(locale, item.label)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
      <GlobalSearch />
    </header>
  );
}

function StatusChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  const toneClass =
    tone === 'ok'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
      : tone === 'warn'
        ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
        : 'border-white/10 bg-white/[0.04] text-slate-300';

  return (
    <span className={`rounded-full border px-3 py-1 ${toneClass}`}>
      <span className="text-slate-500">{label}</span>
      <span className="mx-1">/</span>
      <span>{value}</span>
    </span>
  );
}
