'use client';

import { LifecycleBadge } from '@/components/lobster/LifecycleBadge';
import { LobsterStatusBadge } from '@/components/lobster/LobsterStatusBadge';
import type { LobsterEntity } from '@/types/lobster';

export function LobsterEntityHeader({ lobster }: { lobster: LobsterEntity }) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Lobster Entity</div>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-4xl">{lobster.icon || '🦞'}</span>
            <div>
              <h1 className="text-4xl font-semibold text-white">{lobster.zh_name || lobster.display_name}</h1>
              <p className="mt-1 text-sm text-slate-400">{lobster.display_name} · {lobster.system}</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-7 text-slate-300">{lobster.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <LifecycleBadge lifecycle={lobster.lifecycle} />
            <LobsterStatusBadge status={lobster.status as any} />
            <span>技能 {lobster.skill_count} 个</span>
            <span>本周 {lobster.weekly_runs} 次</span>
            {lobster.active_experiment ? <span className="text-amber-300">A/B 实验 {lobster.active_experiment.rollout}%</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
