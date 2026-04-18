'use client';

import { SurfaceSection } from '@/components/operations/SurfacePrimitives';
import { FINAL_SIGNOFF_GATES, type FinalSignoffGateStatus } from '@/lib/final-signoff-gates';

function gateTone(status: FinalSignoffGateStatus) {
  if (status === 'passed') return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100';
  if (status === 'watch') return 'border-amber-400/25 bg-amber-400/10 text-amber-100';
  return 'border-rose-400/25 bg-rose-400/10 text-rose-100';
}

function statusLabel(status: FinalSignoffGateStatus) {
  if (status === 'passed') return 'signed off';
  if (status === 'watch') return 'watch';
  return 'blocks release';
}

export function FinalExternalGatesSection({
  description = 'This keeps the remaining external signoff gates on one shared view.',
  actionHref,
  actionLabel,
}: {
  description?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <SurfaceSection
      title="Final external gates"
      description={description}
      actionHref={actionHref}
      actionLabel={actionLabel}
    >
      <FinalExternalGatesGrid />
    </SurfaceSection>
  );
}

export function FinalExternalGatesGrid() {
  const blockedCount = FINAL_SIGNOFF_GATES.filter((gate) => gate.status === 'blocked').length;
  const watchCount = FINAL_SIGNOFF_GATES.filter((gate) => gate.status === 'watch').length;
  const passedCount = FINAL_SIGNOFF_GATES.filter((gate) => gate.status === 'passed').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <span className="rounded-full border border-rose-400/25 bg-rose-400/10 px-3 py-1 text-xs text-rose-100">
          blocking: {blockedCount}
        </span>
        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs text-amber-100">
          watch: {watchCount}
        </span>
        <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
          signed off: {passedCount}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {FINAL_SIGNOFF_GATES.map((gate) => (
          <article key={gate.id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-white">{gate.id}</div>
                <div className="mt-1 text-sm text-slate-300">{gate.title}</div>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs ${gateTone(gate.status)}`}>
                {statusLabel(gate.status)}
              </span>
            </div>
            <div className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">{gate.owner}</div>
            <div className="mt-3 text-sm leading-7 text-slate-300">{gate.summary}</div>
            <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Evidence path</div>
              <div className="mt-2 font-mono text-xs text-cyan-200">{gate.evidence}</div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
