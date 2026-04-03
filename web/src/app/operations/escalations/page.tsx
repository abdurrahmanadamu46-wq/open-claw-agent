'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, SkipForward, RotateCcw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchEscalations, resolveEscalation } from '@/services/endpoints/ai-subservice';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';

const STATUS_OPTIONS = [
  { value: 'pending_human_review', label: '待处理' },
  { value: 'resolved', label: '已解决' },
  { value: '', label: '全部' },
];

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'pending_human_review'
      ? 'bg-amber-400/15 text-amber-200'
      : status === 'resolved'
        ? 'bg-emerald-500/15 text-emerald-200'
        : 'bg-slate-700 text-slate-300';
  const label =
    status === 'pending_human_review' ? '待处理' : status === 'resolved' ? '已解决' : status;
  return <span className={`rounded-full px-3 py-1 text-xs ${tone}`}>{label}</span>;
}

function ResolutionBadge({ resolution }: { resolution?: string }) {
  if (!resolution) return null;
  const tone =
    resolution === 'continue'
      ? 'bg-emerald-500/15 text-emerald-200'
      : resolution === 'skip'
        ? 'bg-slate-700 text-slate-400'
        : 'bg-cyan-400/10 text-cyan-200';
  return <span className={`rounded-full px-3 py-1 text-xs ${tone}`}>{resolution}</span>;
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent || 'text-white'}`}>{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/30 px-4 py-10 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}

type EscalationItem = Record<string, unknown>;

export default function EscalationsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('pending_human_review');
  const [lobsterFilter, setLobsterFilter] = useState('');
  const [resolveTarget, setResolveTarget] = useState<{ id: string; resolution: 'continue' | 'skip' | 'retry' } | null>(null);
  const [resolveNote, setResolveNote] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['escalations', statusFilter],
    queryFn: () => fetchEscalations({ status: statusFilter || undefined, limit: 100 }),
    refetchInterval: 20000,
  });

  const resolveMutation = useMutation({
    mutationFn: (payload: { escalation_id: string; resolution: 'continue' | 'skip' | 'retry'; note?: string }) =>
      resolveEscalation(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['escalations'] });
      setResolveTarget(null);
      setResolveNote('');
    },
  });

  const items: EscalationItem[] = (data?.items ?? []) as EscalationItem[];

  const lobsterOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      const lid = String(item.lobster_id || '');
      if (lid) set.add(lid);
    });
    return ['', ...Array.from(set)];
  }, [items]);

  const filtered = useMemo(() => {
    if (!lobsterFilter) return items;
    return items.filter((item) => String(item.lobster_id || '') === lobsterFilter);
  }, [items, lobsterFilter]);

  const pendingCount = items.filter((item) => item.status === 'pending_human_review').length;
  const resolvedCount = items.filter((item) => item.status === 'resolved').length;

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#07111f] p-6 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-5">
        {/* Header */}
        <section
          className="rounded-[30px] border p-6"
          style={{ background: 'linear-gradient(135deg, rgba(20,34,58,0.98), rgba(11,21,35,0.98))', borderColor: BORDER }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.18em] text-amber-300">Escalations</div>
              <h1 className="mt-3 text-3xl font-semibold text-white">人工干预升级队列</h1>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                显示所有龙虾触发人工审核的升级事件。可按状态和龙虾过滤，并在线执行 continue / skip / retry 决策。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void refetch()}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
              >
                <RefreshCw className="h-4 w-4" />
                {isLoading ? '刷新中...' : '刷新'}
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-4 text-sm text-rose-200">加载失败，请稍后重试</div>
          ) : null}

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <MetricCard label="总升级数" value={String(items.length)} />
            <MetricCard label="待处理" value={String(pendingCount)} accent="text-amber-300" />
            <MetricCard label="已解决" value={String(resolvedCount)} accent="text-emerald-300" />
            <MetricCard label="涉及龙虾" value={String(lobsterOptions.length - 1)} />
          </div>
        </section>

        {/* Filters + List */}
        <section
          className="rounded-[28px] border p-5"
          style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              升级事件列表
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <select
                value={lobsterFilter}
                onChange={(e) => setLobsterFilter(e.target.value)}
                className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              >
                {lobsterOptions.map((lid) => (
                  <option key={lid} value={lid}>
                    {lid || '全部龙虾'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {isLoading ? (
              <EmptyState text="加载中..." />
            ) : filtered.length ? (
              filtered.map((item, idx) => {
                const eid = String(item.escalation_id || item.id || idx);
                const isPending = item.status === 'pending_human_review';
                return (
                  <div key={eid} className="rounded-2xl border border-slate-700/70 bg-slate-950/35 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-xs text-slate-300">
                          {eid}
                        </span>
                        {item.lobster_id ? (
                          <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
                            {String(item.lobster_id)}
                          </span>
                        ) : null}
                        <StatusBadge status={String(item.status || '')} />
                        {item.resolution ? <ResolutionBadge resolution={String(item.resolution)} /> : null}
                      </div>

                      {isPending ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setResolveTarget({ id: eid, resolution: 'continue' })}
                            className="inline-flex items-center gap-1 rounded-xl bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/25"
                          >
                            <CheckCircle className="h-3 w-3" />
                            Continue
                          </button>
                          <button
                            type="button"
                            onClick={() => setResolveTarget({ id: eid, resolution: 'skip' })}
                            className="inline-flex items-center gap-1 rounded-xl bg-slate-700/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                          >
                            <SkipForward className="h-3 w-3" />
                            Skip
                          </button>
                          <button
                            type="button"
                            onClick={() => setResolveTarget({ id: eid, resolution: 'retry' })}
                            className="inline-flex items-center gap-1 rounded-xl bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-400/20"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Retry
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 text-sm text-slate-100">
                      {String(item.reason || item.message || '无描述')}
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
                      {item.task_id ? (
                        <span>任务: <span className="font-mono text-slate-300">{String(item.task_id)}</span></span>
                      ) : null}
                      {item.tenant_id ? (
                        <span>租户: <span className="text-slate-300">{String(item.tenant_id)}</span></span>
                      ) : null}
                      <span>创建: {formatDateTime(String(item.created_at || ''))}</span>
                      {item.resolved_at ? (
                        <span>解决: {formatDateTime(String(item.resolved_at))}</span>
                      ) : null}
                      {item.resolved_by ? (
                        <span>处理人: <span className="text-slate-300">{String(item.resolved_by)}</span></span>
                      ) : null}
                    </div>

                    {item.note ? (
                      <div className="mt-2 rounded-xl bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
                        备注: {String(item.note)}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <EmptyState text="当前筛选条件下没有升级事件。龙虾触发人工干预后会自动出现在这里。" />
            )}
          </div>
        </section>
      </div>

      {/* Resolve Modal */}
      {resolveTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            className="w-full max-w-md rounded-[24px] border p-6"
            style={{ backgroundColor: '#16243b', borderColor: BORDER }}
          >
            <h2 className="text-lg font-semibold text-white">
              确认执行 <span className="text-cyan-300">{resolveTarget.resolution}</span>
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              升级 ID: <span className="font-mono text-slate-200">{resolveTarget.id}</span>
            </p>

            <textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="可选备注..."
              rows={3}
              className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />

            {resolveMutation.isError ? (
              <div className="mt-3 text-sm text-rose-300">操作失败，请重试</div>
            ) : null}

            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setResolveTarget(null); setResolveNote(''); }}
                className="rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800/70"
              >
                取消
              </button>
              <button
                type="button"
                disabled={resolveMutation.isPending}
                onClick={() =>
                  resolveMutation.mutate({
                    escalation_id: resolveTarget.id,
                    resolution: resolveTarget.resolution,
                    note: resolveNote || undefined,
                  })
                }
                className="rounded-2xl bg-cyan-500/20 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
              >
                {resolveMutation.isPending ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
