'use client';

import { CheckCircle2, CircleAlert, MessageSquareMore } from 'lucide-react';
import { cn } from '@/lib/utils';

type CollabIntegrationAdapter = {
  id: string;
  label: string;
  provider: string;
  mode: 'mock' | 'live';
  health: string;
  isDefault: boolean;
  liveSupported: boolean;
};

export function CollabIntegrationPanel({
  contractVersion,
  adapters,
  recordsState,
  callbackState,
}: {
  contractVersion: string;
  adapters: CollabIntegrationAdapter[];
  recordsState: string;
  callbackState: string;
}) {
  const liveReadyCount = adapters.filter((item) => item.liveSupported && item.health === 'ready').length;
  const mockModeCount = adapters.filter((item) => item.mode === 'mock').length;
  const hasNonLive = mockModeCount > 0 || liveReadyCount === 0;

  return (
    <section
      className={cn(
        'rounded-[24px] border p-4',
        hasNonLive ? 'border-amber-500/20 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            {hasNonLive ? (
              <CircleAlert className="h-4 w-4 text-amber-300" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
            )}
            群协作接线深度
          </div>
          <div className="mt-2 text-sm leading-7 text-slate-200">
            contract `{contractVersion}` 已统一，但 adapter mode、回执深度和 inbound 回写深度仍可能因环境不同而不一致。
          </div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-200">
          <MessageSquareMore className="h-3.5 w-3.5" />
          {hasNonLive ? 'partially live' : 'fully live'}
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="contract" value={contractVersion} />
        <Metric label="adapters" value={String(adapters.length)} />
        <Metric label="live-ready" value={String(liveReadyCount)} tone={liveReadyCount > 0 ? 'ok' : 'warn'} />
        <Metric label="mock-mode" value={String(mockModeCount)} tone={mockModeCount > 0 ? 'warn' : 'ok'} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-200">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">records</div>
          <div className="mt-2 leading-7">{recordsState}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-200">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">callbacks / inbound</div>
          <div className="mt-2 leading-7">{callbackState}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {adapters.map((adapter) => (
          <div key={adapter.id} className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-white">{adapter.label}</div>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300">
                {adapter.health}
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {adapter.provider} / {adapter.mode}
              {adapter.isDefault ? ' / default' : ''}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  const toneClass =
    tone === 'ok'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
      : tone === 'warn'
        ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
        : 'border-white/10 bg-black/20 text-slate-200';

  return (
    <div className={cn('rounded-2xl border px-4 py-3 text-sm', toneClass)}>
      <div className="text-[11px] uppercase tracking-[0.18em] opacity-70">{label}</div>
      <div className="mt-2 font-medium">{value}</div>
    </div>
  );
}
