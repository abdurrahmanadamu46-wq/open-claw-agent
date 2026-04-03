'use client';

import Link from 'next/link';

export interface SidebarMenuItemProps {
  href: string;
  label: string;
  icon: React.ElementType;
  active?: boolean;
  // 绿色徽章（如在线节点数）
  badgeGreen?: number | string;
  // 红色徽章（如今日线索数）
  badgeRed?: number | string;
}

export function SidebarMenuItem({
  href,
  label,
  icon: Icon,
  active,
  badgeGreen,
  badgeRed,
}: SidebarMenuItemProps) {
  const badge = badgeGreen !== undefined || badgeRed !== undefined;
  const badgeVal = badgeGreen ?? badgeRed ?? '';
  const badgeClass = badgeRed !== undefined
    ? 'bg-red-500/90 text-white'
    : 'bg-emerald-500/90 text-white';

  return (
    <Link
      href={href}
      scroll={false}
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
        active
          ? 'bg-[var(--claw-rust)] text-[var(--claw-gold)] shadow-sm ring-1 ring-amber-500/30'
          : 'text-slate-300 hover:bg-white/10 hover:text-white'
      }`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <Icon
          className="h-4 w-4 shrink-0"
          size={16}
          strokeWidth={active ? 2.2 : 1.8}
        />
        <span className="truncate">{label}</span>
      </span>
      {badge && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}
        >
          {badgeVal}
        </span>
      )}
    </Link>
  );
}
