'use client';

const STATUS_MAP = {
  draft: { label: '草稿', tone: 'bg-slate-700 text-slate-400' },
  review: { label: '审核中', tone: 'bg-amber-400/15 text-amber-200' },
  approved: { label: '已上架', tone: 'bg-emerald-500/15 text-emerald-200' },
  deprecated: { label: '已下架', tone: 'bg-rose-500/15 text-rose-200' },
} as const;

export function SkillPublishStatusBadge({ status }: { status?: string }) {
  const cfg = STATUS_MAP[status as keyof typeof STATUS_MAP] ?? STATUS_MAP.draft;
  return <span className={`rounded-full px-3 py-1 text-xs ${cfg.tone}`}>{cfg.label}</span>;
}
