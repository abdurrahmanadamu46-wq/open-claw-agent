'use client';

import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

export function EntityListPage({
  title,
  description,
  searchValue,
  onSearchChange,
  searchPlaceholder = '搜索...',
  primaryAction,
  filters,
  children,
  footer,
}: {
  title: string;
  description?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  primaryAction?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold text-white">{title}</div>
            {description ? <div className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">{description}</div> : null}
          </div>
          {primaryAction}
        </div>

        {(typeof searchValue === 'string' || filters) ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {typeof searchValue === 'string' ? (
              <label className="relative block w-full max-w-sm">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  value={searchValue}
                  onChange={(event) => onSearchChange?.(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="pl-10"
                />
              </label>
            ) : null}
            {filters ? <div className={cn('flex flex-wrap items-center gap-3')}>{filters}</div> : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">{children}</section>
      {footer ? <div className="flex justify-between text-sm text-slate-400">{footer}</div> : null}
    </div>
  );
}
