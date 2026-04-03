'use client';

import type { LobsterHealthState } from '@/lib/lobster-api';

const TONES: Record<LobsterHealthState, string> = {
  healthy: 'border-green-500/30 bg-green-500/15 text-green-300',
  degraded: 'border-yellow-500/30 bg-yellow-500/15 text-yellow-300',
  critical: 'border-red-500/30 bg-red-500/15 text-red-300',
  idle: 'border-slate-500/30 bg-slate-500/15 text-slate-300',
};

const LABELS: Record<LobsterHealthState, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  critical: 'Critical',
  idle: 'Idle',
};

export function LobsterStatusBadge({ status }: { status: LobsterHealthState }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${TONES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
