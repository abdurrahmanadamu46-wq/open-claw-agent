'use client';

type LobsterStatusTone = {
  className: string;
  label: string;
};

const STATUS_TONES: Record<string, LobsterStatusTone> = {
  healthy: { className: 'border-green-500/30 bg-green-500/15 text-green-300', label: 'Healthy' },
  active: { className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300', label: 'Active' },
  degraded: { className: 'border-yellow-500/30 bg-yellow-500/15 text-yellow-300', label: 'Degraded' },
  training: { className: 'border-cyan-500/30 bg-cyan-500/15 text-cyan-300', label: 'Training' },
  critical: { className: 'border-red-500/30 bg-red-500/15 text-red-300', label: 'Critical' },
  error: { className: 'border-red-500/30 bg-red-500/15 text-red-300', label: 'Error' },
  offline: { className: 'border-rose-500/30 bg-rose-500/15 text-rose-300', label: 'Offline' },
  idle: { className: 'border-slate-500/30 bg-slate-500/15 text-slate-300', label: 'Idle' },
};

export function LobsterStatusBadge({ status }: { status: string }) {
  const normalized = String(status || '').toLowerCase();
  const tone = STATUS_TONES[normalized] ?? {
    className: 'border-slate-500/30 bg-slate-500/15 text-slate-300',
    label: status || 'Unknown',
  };

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${tone.className}`}>
      {tone.label}
    </span>
  );
}
