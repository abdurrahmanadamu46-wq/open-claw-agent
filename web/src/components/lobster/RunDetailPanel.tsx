'use client';

import type { LobsterRun } from '@/types/lobster';
import {
  KnowledgeContextEvidence,
  resolveKnowledgeContext,
} from '@/components/knowledge/KnowledgeContextEvidence';

export function RunDetailPanel({ run }: { run: LobsterRun }) {
  const input = run.input;
  const output = run.output;
  const breakdown = run.quality_breakdown ?? undefined;
  const knowledgeContext =
    resolveKnowledgeContext(run.knowledge_context)
    ?? resolveKnowledgeContext(run.result)
    ?? resolveKnowledgeContext(output)
    ?? resolveKnowledgeContext(input);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-4">
        <KnowledgeContextEvidence context={knowledgeContext} compact />

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">输入</div>
          <pre className="max-h-56 overflow-auto rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-xs text-slate-300">
            {input ? JSON.stringify(input, null, 2) : '暂无输入快照'}
          </pre>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">输出</div>
          <div className="max-h-56 overflow-auto rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-xs leading-6 text-slate-300">
            {typeof output === 'string' ? output : run.error || '暂无输出快照'}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <MetaItem label="模型" value={run.model_used || '-'} />
        <MetaItem label="状态" value={run.status} />
        <MetaItem label="耗时" value={`${Math.round(run.duration_ms || 0)}ms`} />
        <MetaItem label="输入 Tokens" value={String(run.input_tokens || 0)} />
        <MetaItem label="输出 Tokens" value={String(run.output_tokens || 0)} />
        <MetaItem label="总 Tokens" value={String(run.total_tokens || 0)} />
        <MetaItem label="成本" value={String(run.cost_cny || run.estimated_cost_cny || 0)} />
        <MetaItem label="评分" value={typeof run.score === 'number' ? run.score.toFixed(1) : '-'} />

        {breakdown ? (
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">质量评分细项</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(breakdown).map(([key, value]) => (
                <div key={key} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
                  <span className="text-slate-500">{key}</span>
                  <span className="float-right font-medium text-white">{value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {run.error ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-xs text-rose-200">
            {run.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}
