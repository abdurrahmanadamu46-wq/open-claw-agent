'use client';

/**
 * Campaign status badge aligned to the current dark product shell.
 */
export function CampaignStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING: { label: '待执行', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-200' },
    SCRAPING: { label: '抓取中', cls: 'border-sky-500/30 bg-sky-500/10 text-sky-200' },
    GENERATING: { label: '生成中', cls: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200' },
    PUBLISHING: { label: '发布中', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' },
    MONITORING: { label: '监控中', cls: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200' },
    COMPLETED: { label: '已完成', cls: 'border-slate-500/30 bg-slate-500/10 text-slate-200' },
    TERMINATED: { label: '已终止', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-200' },
  };
  const item = map[status] ?? { label: status, cls: 'border-slate-500/30 bg-slate-500/10 text-slate-300' };

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${item.cls}`}>
      {item.label}
    </span>
  );
}
