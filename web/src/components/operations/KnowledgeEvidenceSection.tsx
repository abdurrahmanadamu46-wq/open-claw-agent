'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { SurfacePill } from '@/components/operations/SurfacePrimitives';
import type { LatestKnowledgeEvidenceSnapshot } from '@/lib/release-gate-client';
import type { KnowledgeEvidenceActionLink, KnowledgeEvidenceCommandItem } from '@/lib/knowledge-evidence';

function actionToneClass(tone: KnowledgeEvidenceActionLink['tone'] = 'cyan') {
  const map: Record<NonNullable<KnowledgeEvidenceActionLink['tone']>, string> = {
    amber: 'border-amber-400/25 bg-amber-400/10 text-amber-100',
    cyan: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
    emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
    fuchsia: 'border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-100',
    indigo: 'border-indigo-400/25 bg-indigo-400/10 text-indigo-100',
    sky: 'border-sky-400/25 bg-sky-400/10 text-sky-100',
  };
  return map[tone];
}

export function KnowledgeEvidenceSummaryCard({
  snapshot,
  title,
  summaryText,
  showPills = false,
}: {
  snapshot: LatestKnowledgeEvidenceSnapshot;
  title: string;
  summaryText: string;
  showPills?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5 text-emerald-100">
        <div className="text-xs uppercase tracking-[0.18em] opacity-75">Latest Runtime Evidence</div>
        <div className="mt-2 text-2xl font-semibold">{title}</div>
        <div className="mt-3 text-sm leading-7 opacity-90">{summaryText}</div>
      </div>
      {showPills ? (
        <div className="flex flex-wrap gap-3">
          <SurfacePill label="Mode" value={snapshot.mode} tone={snapshot.available ? 'ok' : 'neutral'} />
          <SurfacePill label="Seed" value={snapshot.seedStrategy} tone={snapshot.available ? 'ok' : 'neutral'} />
          <SurfacePill label="Tenant Private" value={String(snapshot.tenantPrivate)} tone={snapshot.tenantPrivate > 0 ? 'ok' : 'warn'} />
          <SurfacePill label="Platform Common" value={String(snapshot.platformCommon)} />
          <SurfacePill label="Platform Industry" value={String(snapshot.platformIndustry)} />
          <SurfacePill label="Raw Trace" value={snapshot.rawTraceExcluded} tone={snapshot.rawTraceExcluded === 'yes' ? 'ok' : 'warn'} />
          <SurfacePill label="Summary Only" value={snapshot.summaryOnly} tone={snapshot.summaryOnly === 'yes' ? 'ok' : 'warn'} />
          <SurfacePill label="Backflow" value={snapshot.backflowBlocked} tone={snapshot.backflowBlocked === 'yes' ? 'ok' : 'warn'} />
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgeEvidenceCommandsGrid({
  commands,
}: {
  commands: readonly KnowledgeEvidenceCommandItem[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {commands.map((item, index) => (
        <article key={`${item.command}-${index}`} className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
          <div className="text-sm font-semibold text-white">{item.label}</div>
          {item.note ? <p className="mt-2 text-sm leading-7 text-slate-300">{item.note}</p> : null}
          <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-xs text-cyan-100">
            <code>{item.command}</code>
          </pre>
        </article>
      ))}
    </div>
  );
}

export function KnowledgeEvidenceRulesCard({
  title,
  rules,
  summaryText,
  actionLinks = [],
}: {
  title: string;
  rules: readonly string[];
  summaryText?: string;
  actionLinks?: readonly KnowledgeEvidenceActionLink[];
}) {
  return (
    <article className="rounded-[24px] border border-emerald-400/20 bg-emerald-400/10 p-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      {summaryText ? <div className="mt-4 text-sm leading-7 text-emerald-100">{summaryText}</div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {rules.map((item) => (
          <span
            key={item}
            className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100"
          >
            {item}
          </span>
        ))}
      </div>
      {actionLinks.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {actionLinks.map((item) => (
            <Link
              key={`${item.href}-${item.label}`}
              href={item.href}
              className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition hover:opacity-90 ${actionToneClass(item.tone)}`}
            >
              {item.label}
              <ExternalLink className="h-4 w-4" />
            </Link>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function KnowledgeEvidenceArtifactsCard({
  paths,
}: {
  paths: readonly string[];
}) {
  return (
    <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
      <div className="text-sm font-semibold text-white">证据落点</div>
      <div className="mt-3 space-y-3 text-sm leading-7 text-slate-300">
        {paths.map((item) => (
          <div key={item} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 font-mono text-xs text-cyan-100">
            {item}
          </div>
        ))}
      </div>
    </article>
  );
}
