'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, CreditCard, LifeBuoy, Waypoints } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { GlobalSearch } from '@/components/GlobalSearch';
import { LocaleSwitcher } from '@/components/locale-switcher';

type StageItem = {
  id: string;
  href: string;
  match: string[];
};

const MAINLINE_ITEMS: StageItem[] = [
  { id: 'onboard', href: '/onboard', match: ['/onboard'] },
  { id: 'strategy', href: '/operations/strategy', match: ['/operations/strategy', '/ai-brain/radar', '/ai-brain/prompt-lab'] },
  { id: 'campaigns', href: '/campaigns', match: ['/campaigns', '/operations/calendar'] },
  { id: 'fleet', href: '/fleet', match: ['/fleet', '/devices', '/nodes', '/fleet'] },
  { id: 'leads', href: '/operations/leads', match: ['/operations/leads', '/client-center', '/client-mobile'] },
  { id: 'review', href: '/operations/autopilot/trace', match: ['/operations/autopilot', '/operations/log-audit'] },
  { id: 'commercial', href: '/settings/billing', match: ['/settings', '/dashboard/settings'] }
];

function resolveStage(pathname: string): StageItem {
  return (
    MAINLINE_ITEMS.find((item) => item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) ??
    MAINLINE_ITEMS[0]
  );
}

export function Header() {
  const pathname = usePathname();
  const currentStage = resolveStage(pathname);
  const t = useTranslations();

  return (
    <header className="border-b border-white/10 bg-[#07111f]/80 px-6 py-5 backdrop-blur">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Waypoints className="h-4 w-4" />
              {t('header.badge')}
            </div>
            <div className="mt-3 flex items-center gap-3 text-white">
              <h1 className="text-2xl font-semibold">{t(`header.stages.${currentStage.id}.label`)}</h1>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                {t('header.currentStage')}
              </span>
            </div>
            <p className="mt-2 text-sm leading-7 text-slate-400">{t(`header.stages.${currentStage.id}.description`)}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                document.dispatchEvent(new CustomEvent('global-search-open'));
              }}
              className="inline-flex items-center justify-between rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
            >
              <span>搜索...</span>
              <kbd className="ml-3 rounded bg-white/10 px-2 py-0.5 text-xs text-slate-400">Ctrl K</kbd>
            </button>
            <LocaleSwitcher />
            <Link
              href="/settings/commercial-readiness"
              className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-400/15"
            >
              {t('header.buttons.commercialGate')}
            </Link>
            <Link
              href="/help"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
            >
              <LifeBuoy className="h-4 w-4" />
              {t('header.buttons.helpCenter')}
            </Link>
            <Link
              href="/settings/billing"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
            >
              <CreditCard className="h-4 w-4" />
              {t('header.buttons.billing')}
            </Link>
            <Link
              href="/operations/autopilot/alerts"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
            >
              <Bell className="h-4 w-4" />
              {t('header.buttons.alerts')}
            </Link>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-7">
          {MAINLINE_ITEMS.map((item) => {
            const active = item.href === currentStage.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-2xl border px-4 py-3 text-sm transition ${
                  active
                    ? 'border-cyan-400/35 bg-cyan-400/10 text-cyan-100'
                    : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white'
                }`}
              >
                <div className="text-[11px] uppercase tracking-[0.18em] opacity-70">{t('header.stageTag')}</div>
                <div className="mt-1 font-medium">{t(`header.stages.${item.id}.label`)}</div>
              </Link>
            );
          })}
        </div>
      </div>
      <GlobalSearch />
    </header>
  );
}
