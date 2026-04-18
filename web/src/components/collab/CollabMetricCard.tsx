import type { ReactNode } from 'react';

export function CollabMetricCard({
  label,
  value,
  description,
  icon,
}: {
  label: string;
  value: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      {description ? <div className="mt-2 text-sm text-slate-300">{description}</div> : null}
    </div>
  );
}
