'use client';

import { CheckCircle2, CircleAlert, DatabaseZap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LobsterBindingMeta } from '@/lib/lobster-api';

export function LobsterBindingPanel({
  title = '数据接线状态',
  items,
}: {
  title?: string;
  items: Array<{
    label: string;
    binding?: LobsterBindingMeta | null;
  }>;
}) {
  const nonLiveItems = items.filter((item) => item.binding && item.binding.source !== 'live');
  const allLive = items.length > 0 && nonLiveItems.length === 0;

  return (
    <section
      className={cn(
        'rounded-[24px] border p-4',
        allLive ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-amber-500/20 bg-amber-500/10',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            {allLive ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <CircleAlert className="h-4 w-4 text-amber-300" />}
            {title}
          </div>
          <div className="mt-2 text-sm text-slate-200">
            {allLive
              ? '当前页面核心数据都来自 live endpoint。'
              : '当前页面存在 mock 或 fallback 数据源，适合演示和联调，但不能等同于完全真接线。'}
          </div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-200">
          <DatabaseZap className="h-3.5 w-3.5" />
          {allLive ? 'all live' : `${nonLiveItems.length} non-live`}
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          const binding = item.binding;
          const toneClass =
            binding?.source === 'live'
              ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
              : binding?.source === 'mock'
                ? 'border-sky-400/20 bg-sky-400/10 text-sky-100'
                : 'border-amber-400/20 bg-amber-400/10 text-amber-100';
          return (
            <div key={item.label} className={cn('rounded-2xl border px-4 py-3 text-sm', toneClass)}>
              <div className="text-[11px] uppercase tracking-[0.18em] opacity-70">{item.label}</div>
              <div className="mt-2 font-medium">{binding?.source || 'unknown'}</div>
              <div className="mt-1 text-xs opacity-80">{binding?.detail || 'No binding detail available.'}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
