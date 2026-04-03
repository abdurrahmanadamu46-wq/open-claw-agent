'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  BriefcaseBusiness,
  Building2,
  Coins,
  Database,
  ChevronRight,
  ClipboardList,
  CreditCard,
  ChartLine,
  FileSearch,
  FileText,
  FlaskConical,
  Gauge,
  HelpCircle,
  Kanban,
  Layers3,
  Lock,
  Magnet,
  MessageSquare,
  Network,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Scale,
  Settings2,
  Shield,
  Sparkles,
  ToggleLeft,
  Wrench,
  Waypoints,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Item = {
  href: string;
  labelKey: string;
  icon?: React.ElementType;
  exact?: boolean;
};

type Group = {
  id: string;
  titleKey: string;
  icon: React.ElementType;
  items: Item[];
};

const GROUPS: Group[] = [
  {
    id: 'mainline',
    titleKey: 'sidebar.groups.mainline',
    icon: Waypoints,
    items: [
      { href: '/', labelKey: 'nav.overview', icon: BriefcaseBusiness, exact: true },
      { href: '/onboard', labelKey: 'nav.onboard', icon: Waypoints },
      { href: '/operations/strategy', labelKey: 'nav.strategy', icon: Sparkles },
      { href: '/campaigns', labelKey: 'nav.campaigns', icon: ClipboardList },
      { href: '/operations/leads', labelKey: 'nav.leads', icon: Magnet },
      { href: '/operations/autopilot/trace', labelKey: 'nav.trace', icon: FileSearch },
    ],
  },
      {
        id: 'operations',
        titleKey: 'sidebar.groups.support',
        icon: Gauge,
        items: [
          { href: '/lobsters', labelKey: 'nav.lobster_pool', icon: Gauge },
          { href: '/operations/kanban', labelKey: 'nav.kanban', icon: Kanban },
          { href: '/operations/lobster-config', labelKey: 'nav.lobster_config', icon: Wrench },
          { href: '/operations/cost', labelKey: 'nav.cost', icon: Coins },
          { href: '/crm/leads', labelKey: 'nav.crm_leads', icon: MessageSquare },
          { href: '/crm/graph', labelKey: 'nav.crm_graph', icon: Network },
          { href: '/operations/prompts', labelKey: 'nav.prompts', icon: FileText },
          { href: '/operations/workflows', labelKey: 'nav.workflows', icon: ClipboardList },
          { href: '/operations/feature-flags', labelKey: 'nav.feature_flags', icon: ToggleLeft },
          { href: '/operations/experiments', labelKey: 'nav.experiments', icon: FlaskConical },
          { href: '/operations/traces', labelKey: 'nav.traces', icon: Activity },
          { href: '/operations/alerts', labelKey: 'nav.alerts', icon: Bell },
          { href: '/operations/sessions', labelKey: 'nav.sessions', icon: MessageSquare },
          { href: '/operations/channels', labelKey: 'nav.channels', icon: Network },
          { href: '/operations/control-panel', labelKey: 'nav.control_panel', icon: Database },
          { href: '/operations/skills-pool', labelKey: 'nav.skills_pool', icon: Sparkles },
          { href: '/operations/knowledge-base', labelKey: 'nav.knowledge_base', icon: Layers3 },
          { href: '/operations/memory', labelKey: 'nav.memory', icon: Layers3 },
          { href: '/operations/monitor', labelKey: 'nav.monitor', icon: Network },
          { href: '/fleet', labelKey: 'nav.fleet', icon: Network },
          { href: '/operations/mcp', labelKey: 'nav.mcp', icon: Plug },
          { href: '/analytics/attribution', labelKey: 'nav.analytics_attribution', icon: ChartLine },
          { href: '/analytics/funnel', labelKey: 'nav.analytics_funnel', icon: BarChart3 },
        ],
      },
  {
    id: 'commercial',
    titleKey: 'sidebar.groups.commercial',
    icon: CreditCard,
    items: [
      { href: '/settings/billing', labelKey: 'nav.billing', icon: CreditCard },
      { href: '/reseller', labelKey: 'nav.reseller', icon: Building2 },
      { href: '/partner/portal', labelKey: 'nav.partner_portal', icon: BriefcaseBusiness },
      { href: '/settings/commercial-readiness', labelKey: 'nav.commercial_readiness', icon: Settings2 },
      { href: '/settings/model-providers', labelKey: 'nav.model_providers', icon: Settings2 },
      { href: '/settings/integrations', labelKey: 'nav.integrations', icon: Settings2 },
      { href: '/settings/activities', labelKey: 'nav.activities', icon: Activity },
      { href: '/settings/audit', labelKey: 'nav.audit', icon: Shield },
      { href: '/settings/policies', labelKey: 'nav.policies', icon: Scale },
      { href: '/settings/permissions', labelKey: 'nav.permissions', icon: Lock },
      { href: '/settings/white-label', labelKey: 'nav.white_label', icon: Palette },
      { href: '/settings/widget', labelKey: 'nav.widget', icon: Sparkles },
      { href: '/settings/tenants', labelKey: 'nav.client_center', icon: BriefcaseBusiness },
    ],
  },
  {
    id: 'secondary',
    titleKey: 'sidebar.groups.secondary',
    icon: Bot,
    items: [
      { href: '/agents/cabinet', labelKey: 'nav.agents_cabinet', icon: Bot },
      { href: '/ai-brain/studio', labelKey: 'nav.ai_studio', icon: Layers3 },
      { href: '/help', labelKey: 'nav.help', icon: HelpCircle },
    ],
  },
];

function isActive(pathname: string, href: string, exact = false): boolean {
  if (href === '/') return pathname === '/' || pathname === '/dashboard';
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    mainline: true,
    operations: true,
    commercial: true,
    secondary: true,
  });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const mobileItems = useMemo(() => GROUPS.flatMap((group) => group.items).slice(0, 5), []);

  if (isMobile) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-white/10 bg-[#0b1528]/95 px-2 py-2 backdrop-blur md:hidden">
        {mobileItems.map((item) => {
          const Icon = item.icon || BriefcaseBusiness;
          const active = isActive(pathname, item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex min-w-[64px] flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs transition',
                active ? 'bg-cyan-400/10 text-cyan-100' : 'text-slate-400 hover:text-white',
              )}
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
    <aside
      className={cn(
        'hidden shrink-0 border-r border-white/10 bg-[#091222] transition-[width] duration-300 md:flex md:flex-col',
        collapsed ? 'w-[92px]' : 'w-[300px]',
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-5">
        <Link href="/" className="flex items-center gap-3 overflow-hidden">
          <Image src="/logo.png" alt={t('sidebar.brandTitle')} width={124} height={32} priority className="h-8 w-auto shrink-0" />
          {!collapsed ? (
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">{t('sidebar.brandTitle')}</div>
              <div className="text-xs text-slate-400">{t('sidebar.brandSubtitle')}</div>
            </div>
          ) : null}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <div className="border-b border-white/10 px-4 py-4">
        <Link
          href="/onboard"
          className={cn(
            'flex items-center justify-between rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-100 transition hover:bg-amber-400/15',
            collapsed && 'justify-center px-0',
          )}
        >
          <span className={collapsed ? 'sr-only' : ''}>{t('sidebar.startFromOnboard')}</span>
          <Waypoints className="h-4 w-4" />
        </Link>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-5">
        {GROUPS.map((group) => {
          const GroupIcon = group.icon;
          const groupActive = group.items.some((item) => isActive(pathname, item.href, item.exact));
          return (
            <section key={group.id} className="space-y-2">
              <button
                type="button"
                onClick={() => !collapsed && setOpenGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-2.5 text-left text-sm transition',
                  groupActive ? 'text-cyan-100' : 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
                  collapsed && 'justify-center px-0',
                )}
              >
                <GroupIcon className="h-4 w-4 shrink-0" />
                {!collapsed ? (
                  <>
                    <span className="flex-1">{t(group.titleKey)}</span>
                    <ChevronRight className={cn('h-4 w-4 transition', openGroups[group.id] && 'rotate-90')} />
                  </>
                ) : null}
              </button>

              {collapsed ? null : openGroups[group.id] ? (
                <div className="space-y-1 pl-2">
                  {group.items.map((item) => {
                    const ItemIcon = item.icon || BriefcaseBusiness;
                    const active = isActive(pathname, item.href, item.exact);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition',
                          active ? 'bg-cyan-400/10 text-cyan-100' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white',
                        )}
                      >
                        <ItemIcon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <div className={cn('rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300', collapsed && 'text-center')}>
          {collapsed ? 'AI' : '控制台已切到统一 Blocks 骨架'}
        </div>
      </div>
    </aside>
  );
}
