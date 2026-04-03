'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { fetchTenantConcurrencyStats } from '@/services/endpoints/ai-subservice';
import type { TenantConcurrencyStats } from '@/types/tenant-concurrency';

function normalizeError(error: unknown): string {
  const maybe = error as { response?: { data?: { message?: string; detail?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.response?.data?.detail || maybe?.message || 'concurrency_failed';
}

export function ConcurrencyStatusBar() {
  const [stats, setStats] = useState<TenantConcurrencyStats | null>(null);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchTenantConcurrencyStats();
        if (!cancelled) {
          setStats(data);
          setErrorText('');
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(normalizeError(error));
        }
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (errorText || !stats) return null;
  if (stats.current.concurrent_workflows <= 0 && stats.queue_depth <= 0) return null;

  const high = stats.usage_pct.workflows >= 80;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
        high
          ? 'border-amber-400/35 bg-amber-400/10 text-amber-100'
          : 'border-slate-600/60 bg-slate-900/40 text-slate-300'
      }`}
    >
      <Activity className="h-3.5 w-3.5" />
      <span>
        并发中 {stats.current.concurrent_workflows}/{stats.limits.max_concurrent_workflows} · 队列 {stats.queue_depth}/{stats.limits.max_queue_depth}
      </span>
      {high ? <span className="font-medium">当前租户并发占用较高</span> : null}
    </div>
  );
}

export function ConcurrencyLimitBanner() {
  const [stats, setStats] = useState<TenantConcurrencyStats | null>(null);

  useEffect(() => {
    void fetchTenantConcurrencyStats().then(setStats).catch(() => null);
  }, []);

  if (!stats || stats.usage_pct.workflows < 100) return null;

  return (
    <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
      当前租户工作流并发已满，新任务将排队等待。若这是常态，建议升级更高配额套餐。
    </div>
  );
}
