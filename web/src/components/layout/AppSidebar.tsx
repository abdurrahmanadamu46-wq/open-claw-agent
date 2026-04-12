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
  Home,
  Target,
  Cpu,
  Radio,
  TrendingUp,
  Handshake,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────

type NavItem = {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  exact?: boolean;
};

type NavGroup = {
  id: string;
  titleKey: string;
  icon: React.ElementType;
  items: NavItem[];
};

// ─── Standalone overview (not in any group) ─────────────────────────────────

const OVERVIEW_ITEM: NavItem = {
  href: '/',
  labelKey: 'nav.overview',
  icon: Home,
  exact: true,
};

// ─── 5 collapsible groups ───────────────────────────────────────────────────

const GROUPS: NavGroup[] = [
  {
    id: 'operations',
    titleKey: 'sidebar.groups.operations',
    icon: Target,
    items: [
      { href: '/campaigns',                   labelKey: 'nav.campaigns',  icon: ClipboardList },
      { href: '/operations/leads',             labelKey: 'nav.leads',      icon: Magnet },
      { href: '/crm/leads',                   labelKey: 'nav.crm_leads',  icon: MessageSquare },
      { href: '/crm/graph',                   labelKey: 'nav.crm_graph',  icon: Network },
      { href: '/operations/autopilot/trace',  labelKey: 'nav.trace',      icon: FileSearch },
      { href: '/operations/kanban',           labelKey: 'nav.kanban',     icon: Kanban },
    ],
  },
  {
    id: 'ai',
    titleKey: 'sidebar.groups.ai',
    icon: Cpu,
    items: [
      { href: '/lobsters',                    labelKey: 'nav.lobster_pool',    icon: Gauge },
      { href: '/operations/lobster-config',   labelKey: 'nav.lobster_config',  icon: Wrench },
      { href: '/operations/skills-pool',      labelKey: 'nav.skills_pool',     icon: Sparkles },
      { href: '/operations/prompts',          labelKey: 'nav.prompts',         icon: FileText },
      { href: '/operations/knowledge-base',   labelKey: 'nav.knowledge_base',  icon: Layers3 },
      { href: '/operations/memory',           labelKey: 'nav.memory',          icon: Database },
      { href: '/operations/workflows',        labelKey: 'nav.workflows',       icon: ClipboardList },
      { href: '/operations/mcp',              labelKey: 'nav.mcp',             icon: Plug },
      { href: '/ai-brain/studio',             labelKey: 'nav.ai_studio',       icon: Bot },
    ],
  },
  {
    id: 'fleet',
    titleKey: 'sidebar.groups.fleet',
    icon: Radio,
    items: [
      { href: '/fleet',                       labelKey: 'nav.fleet',           icon: Network },
      { href: '/operations/monitor',          labelKey: 'nav.monitor',         icon: Activity },
      { href: '/operations/sessions',         labelKey: 'nav.sessions',        icon: MessageSquare },
      { href: '/operations/channels',         labelKey: 'nav.channels',        icon: Network },
      { href: '/operations/alerts',           labelKey: 'nav.alerts',          icon: Bell },
      { href: '/operations/traces',           labelKey: 'nav.traces',          icon: FileSearch },
      { href: '/operations/control-panel',    labelKey: 'nav.control_panel',   icon: Database },
    ],
  },
  {
    id: 'data',
    titleKey: 'sidebar.groups.data',
    icon: TrendingUp,
    items: [
      { href: '/analytics/attribution',       labelKey: 'nav.analytics_attribution', icon: ChartLine },
      { href: '/analytics/funnel',            labelKey: 'nav.analytics_funnel',      icon: BarChart3 },
      { href: '/operations/cost',             labelKey: 'nav.cost',                  icon: Coins },
      { href: '/operations/experiments',      labelKey: 'nav.experiments',           icon: FlaskConical },
      { href: '/operations/feature-flags',    labelKey: 'nav.feature_flags',         icon: ToggleLeft },
    ],
  },
  {
    id: 'settings',
    titleKey: 'sidebar.groups.settings',
    icon: Settings2,
    items: [
      { href: '/settings/model-providers',       labelKey: 'nav.model_providers',       icon: Cpu },
      { href: '/settings/integrations',          labelKey: 'nav.integrations',           icon: Plug },
      { href: '/settings/permissions',           labelKey: 'nav.permissions',            icon: Lock },
      { href: '/settings/policies',              labelKey: 'nav.policies',               icon: Scale },
      { href: '/settings/audit',                 labelKey: 'nav.audit',                  icon: Shield },
      { href: '/settings/white-label',           labelKey: 'nav.white_label',            icon: Palette },
      { href: '/settings/widget',                labelKey: 'nav.widget',                 icon: Sparkles },
      { href: '/settings/tenants',               labelKey: 'nav.client_center',          icon: BriefcaseBusiness },
      { href: '/settings/billing',               labelKey: 'nav.billing',                icon: CreditCard },
      { href: '/reseller',                       labelKey: 'nav.reseller',               icon: Building2 },
      { href: '/settings/commercial-readiness',  labelKey: 'nav.commercial_readiness',   icon: Settings2 },
    ],
  },
];

// ─── Fixed bottom items ─────────────────────────────────────────────────────

const BOTTOM_ITEMS: NavItem[] = [
  { href: '/partner/portal', labelKey: 'nav.partner_portal', icon: Handshake },
  { href: '/help',           labelKey: 'nav.help',           icon: HelpCircle },
];

// ─── Mobile bottom-bar (5 core tabs) ───────────────────────────────────────

const MOBILE_ITEMS: NavItem[] = [
  OVERVIEW_ITEM,
  { href: '/campaigns',  labelKey: 'nav.campaigns',    icon: Target },
  { href: '/lobsters',   labelKey: 'nav.lobster_pool', icon: Cpu },
  { href: '/fleet',      labelKey: 'nav.fleet',        icon: Radio },
  { href: '/settings/integrations', labelKey: 'nav.settings', icon: Settings2 },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const LS_KEY = 'sidebar_open_groups';

function isActive(pathname: string, href: string, exact = false): boolean {
  if (href === '/') return pathname === '/' || pathname === '/dashboard';
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function loadOpenGroups(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveOpenGroups(state: Record<string, boolean>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AppSidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Determine which group the current route belongs to
  const activeGroupId = useMemo(
    () => GROUPS.find((g) => g.items.some((item) => isActive(pathname, item.href, item.exact)))?.id ?? null,
    [pathname],
  );

  // Open state: default = only 'operations' open; auto-open active group
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const persisted = loadOpenGroups();
    const defaults: Record<string, boolean> = { operations: true };
    return { ...defaults, ...persisted };
  });

  // Auto-expand the group that contains the current route
  useEffect(() => {
    if (activeGroupId && !openGroups[activeGroupId]) {
      setOpenGroups((prev) => {
        const next = { ...prev, [activeGroupId]: true };
        saveOpenGroups(next);
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  function toggleGroup(id: string) {
    if (collapsed) return;
    setOpenGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveOpenGroups(next);
      return next;
    });
  }

  // ── Mobile bottom bar ──────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-white/10 bg-[#0b1528]/95 px-2 py-2 backdrop-blur md:hidden">
        {MOBILE_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex min-w-[56px] flex-col items-center gap-1 rounded-xl px-2 py-2 text-xs transition',
                active ? 'bg-cyan-400/10 text-cyan-100' : 'text-slate-400 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  // ── Desktop sidebar ────────────────────────────────────────────────────────
  return (
    <aside
      className={cn(
        'hidden shrink-0 border-r border-white/10 bg-[#091222] transition-[width] duration-300 md:flex md:flex-col',
        collapsed ? 'w-[72px]' : 'w-[280px]',
      )}
    >
      {/* ── Logo / brand ── */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-5">
        <Link href="/" className="flex items-center gap-3 overflow-hidden">
          <Image
            src="/logo.png"
            alt={t('sidebar.brandTitle')}
            width={124}
            height={32}
            priority
            className="h-8 w-auto shrink-0"
          />
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">{t('sidebar.brandTitle')}</div>
              <div className="text-xs text-slate-400">{t('sidebar.brandSubtitle')}</div>
            </div>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* ── Onboard quick-entry ── */}
      <div className="border-b border-white/10 px-3 py-3">
        <Link
          href="/onboard"
          className={cn(
            'flex items-center justify-between rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-400/15',
            collapsed && 'justify-center px-0',
          )}
        >
          <span className={collapsed ? 'sr-only' : ''}>{t('sidebar.startFromOnboard')}</span>
          <Waypoints className="h-4 w-4 shrink-0" />
        </Link>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">

        {/* Standalone: Overview */}
        <div className="mb-3 px-1">
          <NavItemLink item={OVERVIEW_ITEM} pathname={pathname} collapsed={collapsed} t={t} />
        </div>

        {/* 5 collapsible groups */}
        <div className="space-y-1">
          {GROUPS.map((group) => {
            const GroupIcon = group.icon;
            const groupHasActive = group.items.some((item) => isActive(pathname, item.href, item.exact));
            const isOpen = openGroups[group.id] ?? false;

            return (
              <section key={group.id}>
                {/* Group header / toggle — 父级：白色 + 加粗 + 稍大图标，与子项明显区分 */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition',
                    groupHasActive
                      ? 'text-white'
                      : 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
                    collapsed && 'justify-center px-0 py-3',
                  )}
                  title={collapsed ? t(group.titleKey) : undefined}
                >
                  <GroupIcon className={cn('shrink-0', groupHasActive ? 'h-[18px] w-[18px] text-cyan-400' : 'h-[18px] w-[18px]')} />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{t(group.titleKey)}</span>
                      <ChevronRight
                        className={cn('h-3.5 w-3.5 text-slate-500 transition-transform duration-200', isOpen && 'rotate-90')}
                      />
                    </>
                  )}
                </button>

                {/* Sub-items — 子级：灰色 + 细字 + 左侧竖线锚点 + 更深缩进 */}
                {!collapsed && isOpen && (
                  <div className="mb-1 ml-[22px] mt-0.5 space-y-0.5 border-l border-white/[0.08] pl-3 pr-1">
                    {group.items.map((item) => (
                      <NavItemLink key={item.href} item={item} pathname={pathname} collapsed={false} t={t} indent />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </nav>

      {/* ── Fixed bottom items ── */}
      <div className="border-t border-white/10 px-2 py-3 space-y-0.5">
        {BOTTOM_ITEMS.map((item) => (
          <NavItemLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} t={t} />
        ))}
      </div>
    </aside>
  );
}

// ─── Sub-component: single nav item ────────────────────────────────────────

function NavItemLink({
  item,
  pathname,
  collapsed,
  t,
  indent = false,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  t: ReturnType<typeof useTranslations>;
  indent?: boolean;
}) {
  const Icon = item.icon;
  const active = isActive(pathname, item.href, item.exact);

  return (
    <Link
      href={item.href}
      title={collapsed ? t(item.labelKey) : undefined}
      className={cn(
        'flex items-center gap-2 rounded-lg transition',
        // 子项比父级更小、更暗
        indent ? 'px-2 py-1.5 text-[13px]' : 'px-3 py-2 text-sm font-medium',
        collapsed ? 'justify-center px-0 py-2.5' : '',
        active
          ? indent
            ? 'bg-cyan-400/10 text-cyan-300'          // 子项激活：细青色
            : 'bg-cyan-400/10 text-cyan-100 font-semibold' // 顶级激活（Overview）
          : indent
            ? 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300' // 子项默认：更暗
            : 'text-slate-300 hover:bg-white/[0.05] hover:text-white',    // 顶级默认
      )}
    >
      <Icon className={cn('shrink-0', indent ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
      {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
    </Link>
  );
}
