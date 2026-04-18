import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, ClipboardList } from 'lucide-react';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';

export function IntegrationHelpCard({
  title = '联调遇到问题时先看这里',
  description,
  modelOwner,
  readOwner,
  blockerOwner = 'AI 收尾总指挥',
  checklistHref = LEARNING_LOOP_ROUTES.frontendGaps.href,
  extra,
}: {
  title?: string;
  description: string;
  modelOwner: string;
  readOwner: string;
  blockerOwner?: string;
  checklistHref?: string;
  extra?: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-amber-100">
            <AlertTriangle className="h-4 w-4" />
            {title}
          </div>
          <p className="mt-2 leading-7 text-amber-50/90">{description}</p>
        </div>
        <Link
          href={checklistHref}
          className="inline-flex items-center gap-2 rounded-2xl border border-amber-300/30 bg-black/15 px-3 py-2 text-xs font-medium text-amber-100"
        >
          <ClipboardList className="h-4 w-4" />
          {LEARNING_LOOP_ROUTES.frontendGaps.title}
        </Link>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <InfoTile label="数据模型找谁" value={modelOwner} />
        <InfoTile label="读接口找谁" value={readOwner} />
        <InfoTile label="blocker 先找谁" value={blockerOwner} />
      </div>

      {extra ? <div className="mt-4 rounded-2xl border border-amber-300/20 bg-black/15 p-3 leading-7">{extra}</div> : null}
    </section>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-amber-300/20 bg-black/15 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-amber-100/70">{label}</div>
      <div className="mt-2 font-medium text-amber-50">{value}</div>
    </div>
  );
}
