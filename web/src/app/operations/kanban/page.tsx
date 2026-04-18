'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, CheckCircle2, Clock, Kanban, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { fetchKanbanTasks } from '@/services/endpoints/tasks';
import { createTenantXhsCommanderTaskAction } from '@/services/endpoints/tenant-xhs';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import type { KanbanTaskItem, KanbanTaskStatus } from '@/types/kanban';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';

const COLUMNS: Array<{
  id: KanbanTaskStatus;
  label: string;
  color: string;
}> = [
  { id: 'pending', label: '待执行', color: '#94a3b8' },
  { id: 'running', label: '运行中', color: '#22d3ee' },
  { id: 'done', label: '已完成', color: '#34d399' },
  { id: 'blocked', label: '已阻塞', color: '#fb7185' },
];

function normalizeStatus(status: string): KanbanTaskStatus {
  if (status === 'running') return 'running';
  if (status === 'done' || status === 'completed') return 'done';
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'blocked') return 'blocked';
  return 'pending';
}

function normalizeLobsterLabel(name: string) {
  const normalized = String(name || '').trim();
  return normalized || 'unassigned';
}

function formatElapsed(task: KanbanTaskItem): string {
  const createdAt =
    typeof task.created_at === 'number'
      ? task.created_at * 1000
      : Date.parse(String(task.created_at || ''));
  const endAt = task.updated_at ? Date.parse(String(task.updated_at)) : Date.now();
  if (!Number.isFinite(createdAt) || !Number.isFinite(endAt)) return '-';
  const diffMinutes = Math.max(1, Math.round((endAt - createdAt) / 60000));
  if (diffMinutes < 60) return `${diffMinutes} 分钟`;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return `${hours} 小时 ${minutes} 分钟`;
}

function progressForTask(task: KanbanTaskItem): number {
  const status = normalizeStatus(task.status);
  if (status === 'done') return 100;
  if (status === 'blocked') return 100;
  if (status === 'running') return 65;
  return 20;
}

function priorityTone(priority: string): string {
  switch (priority) {
    case 'urgent':
      return 'bg-rose-500/15 text-rose-200';
    case 'high':
      return 'bg-amber-500/15 text-amber-200';
    case 'low':
      return 'bg-slate-700 text-slate-300';
    default:
      return 'bg-cyan-500/10 text-cyan-100';
  }
}

function KanbanCard({
  task,
  onXhsTaskAction,
  busy,
}: {
  task: KanbanTaskItem;
  onXhsTaskAction: (packId: string, action: 'start' | 'complete') => Promise<void>;
  busy: boolean;
}) {
  const status = normalizeStatus(task.status);
  const lobsterLabel = normalizeLobsterLabel(task.lobster_name);
  const progress = progressForTask(task);
  const isXhsCommanderTask = task.task_type === 'xhs_commander_task';

  return (
    <div
      className="rounded-xl border p-3 transition hover:border-cyan-400/30 hover:bg-white/[0.03]"
      style={{
        borderColor: isXhsCommanderTask ? 'rgba(244,63,94,0.5)' : BORDER,
        backgroundColor: isXhsCommanderTask ? 'rgba(127,29,29,0.28)' : 'rgba(15,23,42,0.5)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{lobsterLabel}</div>
          <div className="mt-1 text-xs leading-5 text-slate-400">{task.title}</div>
        </div>
        <div className="flex items-center gap-2">
          {status === 'running' ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-300" /> : null}
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${priorityTone(task.priority)}`}>{task.priority}</span>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
        <span>{task.task_type || 'task'}</span>
        <span>{formatElapsed(task)}</span>
      </div>

      {isXhsCommanderTask ? (
        <div className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/10 px-2 py-2 text-xs text-rose-100">
          <div>XHS Commander Queue</div>
          {task.pack_id ? <div className="mt-1 break-all">pack: {task.pack_id}</div> : null}
          {task.queue_id ? <div className="mt-1 break-all">queue: {task.queue_id}</div> : null}
          <Link
            href="/operations/channels/xiaohongshu"
            className="mt-2 inline-flex rounded-lg border border-rose-300/30 px-2 py-1 text-[11px] text-rose-50"
          >
            Open XHS supervisor
          </Link>
          {task.pack_id ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || normalizeStatus(task.status) !== 'pending'}
                onClick={() => void onXhsTaskAction(task.pack_id!, 'start')}
                className="rounded-lg border border-cyan-300/30 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-60"
              >
                {busy ? 'Saving...' : 'Start'}
              </button>
              <button
                type="button"
                disabled={busy || normalizeStatus(task.status) === 'done'}
                onClick={() => void onXhsTaskAction(task.pack_id!, 'complete')}
                className="rounded-lg border border-emerald-300/30 px-2 py-1 text-[11px] text-emerald-50 disabled:opacity-60"
              >
                {busy ? 'Saving...' : 'Complete'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {task.error_msg ? (
        <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2 py-2 text-xs text-rose-200">
          {task.error_msg}
        </div>
      ) : null}
    </div>
  );
}

export default function KanbanPage() {
  const [refreshTick, setRefreshTick] = useState(0);
  const [busyTaskId, setBusyTaskId] = useState('');

  const kanbanQuery = useQuery({
    queryKey: ['kanban', 'tasks', refreshTick],
    queryFn: () => fetchKanbanTasks(24),
    refetchInterval: 10_000,
  });

  const columns = useMemo(() => {
    const grouped: Record<KanbanTaskStatus, KanbanTaskItem[]> = {
      pending: [],
      running: [],
      done: [],
      blocked: [],
    };
    for (const item of kanbanQuery.data?.items || []) {
      grouped[normalizeStatus(String(item.status || 'pending'))].push(item);
    }
    return grouped;
  }, [kanbanQuery.data?.items]);

  const stats = useMemo(
    () => ({
      total: (kanbanQuery.data?.items || []).length,
      pending: columns.pending.length,
      running: columns.running.length,
      done: columns.done.length,
      blocked: columns.blocked.length,
    }),
    [columns, kanbanQuery.data?.items],
  );

  const runXhsTaskAction = async (packId: string, action: 'start' | 'complete') => {
    setBusyTaskId(packId);
    try {
      await createTenantXhsCommanderTaskAction({
        pack_id: packId,
        action,
        note: action === 'complete' ? 'Completed from global Kanban.' : 'Started from global Kanban.',
      });
      await kanbanQuery.refetch();
      triggerSuccessToast(`XHS Commander task ${action} recorded`);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : 'XHS Commander task action failed');
    } finally {
      setBusyTaskId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border p-5" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/10">
              <Kanban className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <div className="text-lg font-semibold text-white">任务看板</div>
              <div className="mt-0.5 text-sm text-slate-400">
                基于最近 24 小时任务队列数据，实时查看龙虾任务的待执行、运行中、已完成和已阻塞分布。
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRefreshTick(Date.now())}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.08]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${kanbanQuery.isFetching ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: '总任务', value: stats.total, color: '#e2e8f0' },
          { label: '待执行', value: stats.pending, color: '#94a3b8' },
          { label: '运行中', value: stats.running, color: '#22d3ee' },
          { label: '已完成', value: stats.done, color: '#34d399' },
          { label: '已阻塞', value: stats.blocked, color: '#fb7185' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border px-4 py-3" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
            <div className="text-xs uppercase tracking-widest text-slate-500">{stat.label}</div>
            <div className="mt-1 text-2xl font-semibold" style={{ color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {kanbanQuery.isError ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {kanbanQuery.error instanceof Error ? kanbanQuery.error.message : '任务看板加载失败'}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((column) => {
          const items = columns[column.id];
          return (
            <div key={column.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
                {column.id === 'pending' ? <Clock className="h-3.5 w-3.5" style={{ color: column.color }} /> : null}
                {column.id === 'running' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" style={{ color: column.color }} /> : null}
                {column.id === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" style={{ color: column.color }} /> : null}
                {column.id === 'blocked' ? <AlertTriangle className="h-3.5 w-3.5" style={{ color: column.color }} /> : null}
                <span className="text-sm font-medium" style={{ color: column.color }}>
                  {column.label}
                </span>
                <span className="ml-auto text-xs text-slate-500">{items.length}</span>
              </div>

              <div className="flex flex-col gap-2">
                {kanbanQuery.isLoading ? (
                  <div className="flex items-center justify-center rounded-xl border border-dashed py-8 text-xs text-slate-500" style={{ borderColor: 'rgba(71,85,105,0.3)' }}>
                    加载中...
                  </div>
                ) : items.length > 0 ? (
                  items.map((item) => (
                    <KanbanCard
                      key={item.task_id}
                      task={item}
                      busy={busyTaskId === item.pack_id}
                      onXhsTaskAction={runXhsTaskAction}
                    />
                  ))
                ) : (
                  <div className="flex items-center justify-center rounded-xl border border-dashed py-8 text-xs text-slate-600" style={{ borderColor: 'rgba(71,85,105,0.3)' }}>
                    暂无
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border p-5" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
        <div className="mb-4 text-sm font-medium text-slate-300">快速导航</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {['commander', 'radar', 'strategist', 'inkwriter', 'visualizer', 'dispatcher', 'echoer', 'catcher', 'abacus', 'followup'].map((lobsterId) => (
            <Link
              key={lobsterId}
              href={`/lobsters/${lobsterId}`}
              className="flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-center transition hover:border-cyan-400/30"
              style={{ borderColor: BORDER }}
            >
              <span className="mx-auto mb-1 inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              <div className="text-xs font-semibold text-white">{lobsterId}</div>
              <div className="text-[11px] text-slate-500">
                <Bot className="mx-auto h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
