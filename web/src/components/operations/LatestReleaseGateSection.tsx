'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SurfaceMetric, SurfacePill, SurfaceStateCard } from '@/components/operations/SurfacePrimitives';
import type { LatestReleaseGateResponse } from '@/lib/release-gate-client';

type LatestReleaseGateSectionProps = {
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
  isLoading: boolean;
  isError: boolean;
  latestGate?: LatestReleaseGateResponse['summary'];
  artifactDir?: string;
  loadingTitle: string;
  loadingDescription: string;
  unavailableTitle: string;
  unavailableDescription: string;
  positiveSummary: string;
  negativeSummary: string;
  errorMessage?: string;
  headerAction?: ReactNode;
  footerActions?: ReactNode;
};

export function LatestReleaseGateSection({
  title,
  description,
  actionHref,
  actionLabel,
  isLoading,
  isError,
  latestGate,
  artifactDir,
  loadingTitle,
  loadingDescription,
  unavailableTitle,
  unavailableDescription,
  positiveSummary,
  negativeSummary,
  errorMessage,
  headerAction,
  footerActions,
}: LatestReleaseGateSectionProps) {
  const unavailableText = errorMessage ? `${unavailableDescription} (${errorMessage})` : unavailableDescription;

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm leading-7 text-slate-400">{description}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {headerAction}
          <Link
            href={actionHref}
            className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100"
          >
            {actionLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <SurfaceStateCard
            kind="loading"
            title={loadingTitle}
            description={loadingDescription}
          />
        ) : isError || !latestGate ? (
          <SurfaceStateCard
            kind="warn"
            title={unavailableTitle}
            description={unavailableText}
            actionHref={actionHref}
            actionLabel={actionLabel}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-base font-semibold text-white">Gate verdict</div>
                <SurfacePill
                  label="result"
                  value={latestGate.ok ? 'pass' : 'needs attention'}
                  tone={latestGate.ok ? 'ok' : 'warn'}
                />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SurfaceMetric
                  label="UI routes"
                  value={`${latestGate.ui_smoke?.metrics?.passed_routes ?? 0}/${latestGate.ui_smoke?.metrics?.total_routes ?? 0}`}
                  helper="核心页面路由 smoke"
                />
                <SurfaceMetric
                  label="UI interactions"
                  value={`${latestGate.ui_smoke?.metrics?.passed_interactions ?? 0}/${latestGate.ui_smoke?.metrics?.total_interactions ?? 0}`}
                  helper="关键交互 smoke"
                />
                <SurfaceMetric
                  label="Data probes"
                  value={`${latestGate.data_evidence?.metrics?.required_passed ?? 0}/${latestGate.data_evidence?.metrics?.required_total ?? 0}`}
                  helper="本地真实数据 evidence"
                />
                <SurfaceMetric
                  label="Runtime mode"
                  value={String(latestGate.data_evidence?.runtime_mode || '-')}
                  helper={String(latestGate.data_evidence?.dragon_url || '-')}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="text-base font-semibold text-white">Operator summary</div>
              <div className="mt-3 flex flex-wrap gap-3">
                <SurfacePill label="generated" value={String(latestGate.generated_at || '-')} />
                <SurfacePill label="artifact" value={artifactDir || '-'} />
              </div>
              <div className="mt-4 text-sm leading-7 text-slate-300">
                {latestGate.ok ? positiveSummary : negativeSummary}
              </div>
              {Array.isArray(latestGate.notes) && latestGate.notes.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs leading-6 text-slate-400">
                  {latestGate.notes.join(' | ')}
                </div>
              ) : null}
              {footerActions ? <div className="mt-4 flex flex-wrap gap-3">{footerActions}</div> : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
