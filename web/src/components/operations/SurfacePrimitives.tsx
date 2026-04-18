import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CircleAlert, LoaderCircle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SurfaceHero({
  eyebrow,
  title,
  description,
  actions,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_30%),radial-gradient(circle_at_78%_12%,rgba(245,158,11,0.14),transparent_24%),rgba(255,255,255,0.04)] p-6 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
            <Sparkles className="h-4 w-4" />
            {eyebrow}
          </div>
          <h1 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-5xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">{description}</p>
          {actions ? <div className="mt-5 flex flex-wrap gap-3">{actions}</div> : null}
        </div>
        {aside ? <div className="grid gap-3 sm:grid-cols-2">{aside}</div> : null}
      </div>
    </section>
  );
}

export function SurfaceMetric({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm text-slate-300">{helper}</div>
    </div>
  );
}

export function SurfaceSection({
  title,
  description,
  actionHref,
  actionLabel,
  children,
}: {
  title: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {description ? <p className="mt-1 text-sm leading-7 text-slate-400">{description}</p> : null}
        </div>
        {actionHref && actionLabel ? (
          <Link
            href={actionHref}
            className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100"
          >
            {actionLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SurfaceLinkCard({
  href,
  title,
  description,
  icon,
  eyebrow,
  compact = false,
}: {
  href: string;
  title: string;
  description: string;
  icon?: ReactNode;
  eyebrow?: string;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-[28px] border border-white/10 bg-white/[0.04] transition hover:border-cyan-400/25 hover:bg-white/[0.06]',
        compact ? 'p-4' : 'p-5',
      )}
    >
      {icon ? (
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
          {icon}
        </div>
      ) : null}
      {eyebrow ? <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-slate-500">{eyebrow}</div> : null}
      <div className={cn('text-lg font-semibold text-white', icon || eyebrow ? 'mt-4' : '')}>{title}</div>
      <div className="mt-2 text-sm leading-7 text-slate-300">{description}</div>
      {!compact ? (
        <div className="mt-4 inline-flex items-center gap-2 text-sm text-cyan-200">
          打开页面
          <ArrowRight className="h-4 w-4" />
        </div>
      ) : null}
    </Link>
  );
}

export function SurfaceStateCard({
  kind,
  title,
  description,
  actionHref,
  actionLabel,
}: {
  kind: 'loading' | 'error' | 'warn' | 'empty';
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  const toneClass =
    kind === 'error'
      ? 'border-rose-500/25 bg-rose-500/10 text-rose-100'
      : kind === 'warn'
        ? 'border-amber-500/25 bg-amber-500/10 text-amber-100'
        : 'border-white/10 bg-black/20 text-slate-200';
  const Icon =
    kind === 'loading' ? LoaderCircle : kind === 'error' ? AlertTriangle : kind === 'warn' ? CircleAlert : Sparkles;

  return (
    <div className={cn('rounded-[24px] border p-5', toneClass)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', kind === 'loading' && 'animate-spin')} />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-2 text-sm leading-7 opacity-90">{description}</div>
          {actionHref && actionLabel ? (
            <Link href={actionHref} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-cyan-100">
              {actionLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SurfacePill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  const toneClass =
    tone === 'ok'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
      : tone === 'warn'
        ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
        : 'border-white/10 bg-slate-950/40 text-slate-300';

  return (
    <div className={cn('rounded-2xl border px-4 py-3', toneClass)}>
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}
