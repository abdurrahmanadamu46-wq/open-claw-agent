'use client';

import { CheckCircle2, CircleAlert, Layers3 } from 'lucide-react';
import { cn } from '@/lib/utils';

type CompositionDepthItem = {
  label: string;
  mode: 'live' | 'composed' | 'local';
  detail: string;
};

export function CompositionDepthPanel({
  title = 'Integration Depth',
  summary,
  items,
}: {
  title?: string;
  summary: string;
  items: CompositionDepthItem[];
}) {
  const liveCount = items.filter((item) => item.mode === 'live').length;
  const hasNonLive = items.some((item) => item.mode !== 'live');

  return (
    <section
      className={cn(
        'rounded-[24px] border p-4',
        hasNonLive ? 'border-amber-500/20 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            {hasNonLive ? <CircleAlert className="h-4 w-4 text-amber-300" /> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
            {title}
          </div>
          <div className="mt-2 text-sm leading-7 text-slate-200">{summary}</div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-200">
          <Layers3 className="h-3.5 w-3.5" />
          {liveCount}/{items.length} live
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          const toneClass =
            item.mode === 'live'
              ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
              : item.mode === 'composed'
                ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
                : 'border-sky-400/20 bg-sky-400/10 text-sky-100';
          return (
            <div key={item.label} className={cn('rounded-2xl border px-4 py-3 text-sm', toneClass)}>
              <div className="text-[11px] uppercase tracking-[0.18em] opacity-70">{item.label}</div>
              <div className="mt-2 font-medium">{item.mode}</div>
              <div className="mt-1 text-xs opacity-80">{item.detail}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
