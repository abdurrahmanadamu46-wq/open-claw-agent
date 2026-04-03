'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Bot,
  BriefcaseBusiness,
  ClipboardList,
  CreditCard,
  Database,
  FileSearch,
  Gauge,
  HelpCircle,
  Layers3,
  Magnet,
  Network,
  Settings2,
  Sparkles,
  Waypoints,
  Plug
} from 'lucide-react';
import { SidebarMenuItem } from './SidebarMenuItem';

type NavItem = {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  exact?: boolean;
};

type NavGroup = {
  titleKey: string;
  items: NavItem[];
};

const GROUPS: NavGroup[] = [
  {
    titleKey: 'sidebar.groups.mainline',
    items: [
      { href: '/', labelKey: 'nav.overview', icon: BriefcaseBusiness, exact: true },
      { href: '/onboard', labelKey: 'nav.onboard', icon: Waypoints },
      { href: '/operations/strategy', labelKey: 'nav.strategy', icon: Sparkles },
      { href: '/campaigns', labelKey: 'nav.campaigns', icon: ClipboardList },
      { href: '/operations/leads', labelKey: 'nav.leads', icon: Magnet },
      { href: '/operations/autopilot/trace', labelKey: 'nav.trace', icon: FileSearch }
    ]
  },
  {
    titleKey: 'sidebar.groups.support',
    items: [
      { href: '/agents/cabinet', labelKey: 'nav.agents_cabinet', icon: Bot },
      { href: '/dashboard/lobster-pool', labelKey: 'nav.lobster_pool', icon: Gauge },
      { href: '/dashboard/lobster-skills', labelKey: 'nav.lobster_skills', icon: Sparkles },
      { href: '/operations/control-panel', labelKey: 'nav.control_panel', icon: Database },
      { href: '/operations/monitor', labelKey: 'nav.monitor', icon: Network },
      { href: '/ai-brain/studio', labelKey: 'nav.ai_studio', icon: Layers3 },
      { href: '/fleet', labelKey: 'nav.fleet', icon: Network },
      { href: '/operations/mcp', labelKey: 'nav.mcp', icon: Plug }
    ]
  },
  {
    titleKey: 'sidebar.groups.commercial',
    items: [
      { href: '/settings/billing', labelKey: 'nav.billing', icon: CreditCard },
      { href: '/partner/portal', labelKey: 'nav.partner_portal', icon: BriefcaseBusiness },
      { href: '/settings/commercial-readiness', labelKey: 'nav.commercial_readiness', icon: Settings2 },
      { href: '/settings/model-providers', labelKey: 'nav.model_providers', icon: Settings2 },
      { href: '/settings/integrations', labelKey: 'nav.integrations', icon: Settings2 }
    ]
  },
  {
    titleKey: 'sidebar.groups.secondary',
    items: [
      { href: '/client-center', labelKey: 'nav.client_center', icon: BriefcaseBusiness },
      { href: '/client-mobile', labelKey: 'nav.client_mobile', icon: Magnet },
      { href: '/help', labelKey: 'nav.help', icon: HelpCircle }
    ]
  }
];

const MOBILE_NAV = [
  { href: '/', labelKey: 'nav.overview', icon: BriefcaseBusiness },
  { href: '/campaigns', labelKey: 'nav.campaigns', icon: ClipboardList },
  { href: '/operations/strategy', labelKey: 'nav.strategy', icon: Sparkles },
  { href: '/operations/leads', labelKey: 'nav.leads', icon: Magnet },
  { href: '/dashboard/lobster-pool', labelKey: 'nav.lobster_pool', icon: Gauge }
];

function isActive(pathname: string, href: string, exact = false): boolean {
  if (href === '/') return pathname === '/' || pathname === '/dashboard';
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  if (isMobile) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-white/10 bg-[#0b1528]/95 px-2 py-2 backdrop-blur md:hidden">
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href, item.href === '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-w-[64px] flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs transition ${
                active ? 'bg-cyan-400/10 text-cyan-100' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <aside className="hidden w-[280px] shrink-0 border-r border-white/10 bg-[#091222] md:flex md:flex-col">
      <div className="border-b border-white/10 px-5 py-5">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo.png" alt={t('sidebar.brandTitle')} width={124} height={32} priority className="h-8 w-auto" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">{t('sidebar.brandTitle')}</div>
            <div className="text-xs text-slate-400">{t('sidebar.brandSubtitle')}</div>
          </div>
        </Link>
      </div>

      <div className="border-b border-white/10 px-5 py-4">
        <Link
          href="/onboard"
          className="flex items-center justify-between rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-100 transition hover:bg-amber-400/15"
        >
          <span>{t('sidebar.startFromOnboard')}</span>
          <Waypoints className="h-4 w-4" />
        </Link>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
        {GROUPS.map((group) => (
          <section key={group.titleKey} className="space-y-2">
            <div className="px-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">{t(group.titleKey)}</div>
            <div className="space-y-1.5">
              {group.items.map((item) => (
                <SidebarMenuItem
                  key={item.href}
                  href={item.href}
                  label={t(item.labelKey)}
                  icon={item.icon}
                  active={isActive(pathname, item.href, item.exact)}
                />
              ))}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
}
