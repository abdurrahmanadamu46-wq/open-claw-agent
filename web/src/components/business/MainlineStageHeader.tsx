'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Waypoints } from 'lucide-react';

type StageLink = {
  href: string;
  label: string;
};

type MainlineKey = 'onboard' | 'strategy' | 'campaigns' | 'leads' | 'trace' | 'commercial';

const MAINLINE = [
  { key: 'onboard', label: '首启', href: '/onboard' },
  { key: 'strategy', label: '策略', href: '/operations/strategy' },
  { key: 'campaigns', label: '任务', href: '/campaigns' },
  { key: 'leads', label: '线索', href: '/operations/leads' },
  { key: 'trace', label: '复盘', href: '/operations/autopilot/trace' },
  { key: 'commercial', label: '商业化', href: '/settings/billing' },
] as const;

export function MainlineStageHeader({
  currentKey,
  step,
  title,
  description,
  previous,
  next,
  actions,
}: {
  currentKey: MainlineKey;
  step: string;
  title: string;
  description: string;
  previous?: StageLink;
  next?: StageLink;
  actions?: ReactNode;
}) {
  const currentIndex = MAINLINE.findIndex((item) => item.key === currentKey);

  return (
    <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
            <Waypoints className="h-4 w-4" />
            {step}
          </div>
          <h1 className="mt-5 text-3xl font-semibold leading-tight text-white md:text-4xl">{title}</h1>
          <p className="mt-4 text-sm leading-7 text-slate-300 md:text-base">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>

      <div className="mt-6 rounded-[24px] border border-white/8 bg-slate-950/40 p-4">
        <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">当前工作主线</div>
        <div className="grid gap-2 md:grid-cols-6">
          {MAINLINE.map((item, index) => {
            const active = index === currentIndex;
            const completed = index < currentIndex;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`rounded-2xl border px-4 py-3 text-sm transition ${
                  active
                    ? 'border-cyan-400/35 bg-cyan-400/10 text-cyan-100'
                    : completed
                      ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white'
                }`}
              >
                <div className="text-[11px] uppercase tracking-[0.18em] opacity-70">步骤 {index + 1}</div>
                <div className="mt-1 font-medium">{item.label}</div>
              </Link>
            );
          })}
        </div>
      </div>

      {(previous || next) && (
        <div className="mt-6 flex flex-wrap gap-3">
          {previous ? (
            <Link
              href={previous.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/[0.08]"
            >
              <ArrowLeft className="h-4 w-4" />
              {previous.label}
            </Link>
          ) : null}
          {next ? (
            <Link
              href={next.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15"
            >
              {next.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );
}
