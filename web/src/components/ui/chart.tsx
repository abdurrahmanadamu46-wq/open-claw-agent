'use client';

import * as React from 'react';
import { Legend, Tooltip, type TooltipProps } from 'recharts';
import { cn } from '@/lib/utils';

export type ChartConfig = Record<
  string,
  {
    label: string;
    color: string;
  }
>;

export function ChartContainer({
  config,
  className,
  children,
}: {
  config: ChartConfig;
  className?: string;
  children: React.ReactNode;
}) {
  const style = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color]),
  ) as React.CSSProperties;

  return (
    <div className={cn('w-full', className)} style={style}>
      {children}
    </div>
  );
}

export const ChartTooltip = Tooltip;
export const ChartLegend = Legend;

export function ChartTooltipContent({
  active,
  payload,
  label,
  hideLabel = false,
}: TooltipProps<number, string> & { hideLabel?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0f172a] px-4 py-3 text-xs shadow-2xl">
      {!hideLabel && label ? <div className="mb-2 font-medium text-white">{String(label)}</div> : null}
      <div className="space-y-1.5">
        {payload.map((item) => (
          <div key={item.dataKey as string} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
            <span className="font-medium text-white">{String(item.value ?? '-')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
