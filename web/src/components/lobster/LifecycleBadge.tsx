'use client';

import type { Lifecycle } from '@/types/lobster';

const CONFIG: Record<Lifecycle, { label: string; className: string }> = {
  experimental: { label: '实验中', className: 'border-yellow-300 bg-yellow-100 text-yellow-800' },
  production: { label: '生产', className: 'border-green-300 bg-green-100 text-green-800' },
  deprecated: { label: '废弃中', className: 'border-red-300 bg-red-100 text-red-800' },
};

export function LifecycleBadge({ lifecycle }: { lifecycle: Lifecycle }) {
  const meta = CONFIG[lifecycle];
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}
