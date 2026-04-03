'use client';

import type { AuditEvent } from '@/types/audit-log';

export function ConfigDiffPanel({ log }: { log: AuditEvent }) {
  const details = log.details || {};
  const before = typeof details['before'] === 'object' ? details['before'] : null;
  const after = typeof details['after'] === 'object' ? details['after'] : null;

  if (!before || !after) {
    return (
      <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-xs text-slate-300">
        {JSON.stringify(details, null, 2)}
      </pre>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-300">变更前</div>
        <pre className="max-h-64 overflow-auto rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-xs text-slate-100">
          {JSON.stringify(before, null, 2)}
        </pre>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-300">变更后</div>
        <pre className="max-h-64 overflow-auto rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-xs text-slate-100">
          {JSON.stringify(after, null, 2)}
        </pre>
      </div>
    </div>
  );
}
