'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ChevronRight, PanelLeftClose, PanelLeftOpen, Waypoints } from 'lucide-react';
import {
  CONTROL_DECK_ITEM,
  MOBILE_NAV_ITEMS,
  PRODUCT_BRAND,
  PRODUCT_ZONES,
  SIDEBAR_FOOTER_ITEMS,
  isRouteActive,
  t,
} from '@/config/operations-navigation';
import { cn } from '@/lib/utils';

const LS_KEY = 'sidebar_open_groups';

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

export function AppSidebar() {
  const pathname = usePathname() ?? '';
  const locale = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const activeGroupId = useMemo(
    () => PRODUCT_ZONES.find((group) => group.items.some((item) => isRouteActive(pathname, item.href, item.exact)))?.id ?? null,
    [pathname],
  );

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    lobsters: true,
    training: true,
    collab: true,
  });

  useEffect(() => {
    const persisted = loadOpenGroups();
    if (Object.keys(persisted).length > 0) {
      setOpenGroups((prev) => ({ ...prev, ...persisted }));
    }
  }, []);

  useEffect(() => {
    if (activeGroupId && !openGroups[activeGroupId]) {
      setOpenGroups((prev) => {
        const next = { ...prev, [activeGroupId]: true };
        saveOpenGroups(next);
        return next;
      });
    }
  }, [activeGroupId, openGroups]);

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

  if (isMobile) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-white/10 bg-[#0b1528]/95 px-2 py-2 backdrop-blur md:hidden">
        {MOBILE_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isRouteActive(pathname, item.href, item.exact);
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
              <span className="truncate">{t(locale, item.label)}</span>
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
        collapsed ? 'w-[72px]' : 'w-[292px]',
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-5">
        <Link href="/" className="flex items-center gap-3 overflow-hidden">
          <Image
            src="/logo.png"
            alt={t(locale, PRODUCT_BRAND.title)}
            width={124}
            height={32}
            priority
            className="h-8 w-auto shrink-0"
          />
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">{t(locale, PRODUCT_BRAND.title)}</div>
              <div className="text-xs text-slate-400">{t(locale, PRODUCT_BRAND.subtitle)}</div>
            </div>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
          aria-label={collapsed ? (locale === 'en' ? 'Expand sidebar' : '展开侧边栏') : (locale === 'en' ? 'Collapse sidebar' : '折叠侧边栏')}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <div className="border-b border-white/10 px-3 py-3">
        <Link
          href="/onboard"
          className={cn(
            'flex items-center justify-between rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-400/15',
            collapsed && 'justify-center px-0',
          )}
        >
          <span className={collapsed ? 'sr-only' : ''}>{t(locale, PRODUCT_BRAND.start)}</span>
          <Waypoints className="h-4 w-4 shrink-0" />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-3 px-1">
          <NavItemLink item={CONTROL_DECK_ITEM} pathname={pathname} collapsed={collapsed} locale={locale} />
        </div>

        <div className="space-y-1">
          {PRODUCT_ZONES.map((group) => {
            const GroupIcon = group.icon;
            const isOpen = openGroups[group.id] ?? false;
            const groupHasActive = group.items.some((item) => isRouteActive(pathname, item.href, item.exact));

            return (
              <section key={group.id}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition',
                    groupHasActive ? 'text-white' : 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
                    collapsed && 'justify-center px-0 py-3',
                  )}
                  title={collapsed ? t(locale, group.title) : undefined}
                >
                  <GroupIcon className={cn('shrink-0', groupHasActive ? 'h-[18px] w-[18px] text-cyan-400' : 'h-[18px] w-[18px]')} />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{t(locale, group.title)}</span>
                      <ChevronRight className={cn('h-3.5 w-3.5 text-slate-500 transition-transform duration-200', isOpen && 'rotate-90')} />
                    </>
                  )}
                </button>

                {!collapsed && isOpen && (
                  <div className="mb-1 ml-[22px] mt-0.5 space-y-0.5 border-l border-white/[0.08] pl-3 pr-1">
                    {group.items.map((item) => (
                      <NavItemLink key={item.href} item={item} pathname={pathname} collapsed={false} locale={locale} indent />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </nav>

      <div className="space-y-0.5 border-t border-white/10 px-2 py-3">
        {SIDEBAR_FOOTER_ITEMS.map((item) => (
          <NavItemLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} locale={locale} />
        ))}
      </div>
    </aside>
  );
}

function NavItemLink({
  item,
  pathname,
  collapsed,
  locale,
  indent = false,
}: {
  item: typeof CONTROL_DECK_ITEM;
  pathname: string;
  collapsed: boolean;
  locale: string;
  indent?: boolean;
}) {
  const Icon = item.icon;
  const active = isRouteActive(pathname, item.href, item.exact);

  return (
    <Link
      href={item.href}
      title={collapsed ? t(locale, item.label) : undefined}
      className={cn(
        'flex items-center gap-2 rounded-lg transition',
        indent ? 'px-2 py-1.5 text-[13px]' : 'px-3 py-2 text-sm font-medium',
        collapsed ? 'justify-center px-0 py-2.5' : '',
        active
          ? indent
            ? 'bg-cyan-400/10 text-cyan-300'
            : 'bg-cyan-400/10 font-semibold text-cyan-100'
          : indent
            ? 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
            : 'text-slate-300 hover:bg-white/[0.05] hover:text-white',
      )}
    >
      <Icon className={cn('shrink-0', indent ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
      {!collapsed && <span className="truncate">{t(locale, item.label)}</span>}
    </Link>
  );
}
