'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw, ShieldCheck, UserCircle2 } from 'lucide-react';
import { fetchActivities } from '@/services/endpoints/ai-subservice';
import type { ActivityStreamDetails, ActivityStreamItem } from '@/types/activity-stream';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';

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

export default function ActivitiesPage() {
  const searchParams = useSearchParams();
  const queryType = searchParams?.get('type') ?? '';
  const [activityType, setActivityType] = useState(queryType);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [selectedActivityId, setSelectedActivityId] = useState('');

  useEffect(() => {
    setActivityType(queryType);
    setOffset(0);
    setSelectedActivityId('');
  }, [queryType]);

  const activitiesQuery = useQuery({
    queryKey: ['activities', activityType, limit, offset],
    queryFn: () =>
      fetchActivities({
        limit,
        offset,
        type: activityType || undefined,
      }),
  });

  const items = useMemo(() => activitiesQuery.data?.items ?? [], [activitiesQuery.data?.items]);
  const selectedActivity = items.find((item) => item.activity_id === selectedActivityId) ?? items[0] ?? null;
  const uniqueTypes = useMemo(() => Array.from(new Set(items.map((item) => item.activity_type))).sort(), [items]);
  const actorCount = useMemo(() => Array.from(new Set(items.map((item) => item.actor_id || item.actor_name).filter(Boolean))).length, [items]);

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-[30px] border p-6" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Activity Stream</div>
              <h1 className="mt-3 text-3xl font-semibold text-white">活动流</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
                统一查看租户最近发生的系统活动，包括龙虾执行、规则变更、边缘节点状态变化和任务完成情况。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void activitiesQuery.refetch()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
            >
              <RefreshCw className={`h-4 w-4 ${activitiesQuery.isFetching ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[220px_120px_120px]">
            <input
              value={activityType}
              onChange={(event) => setActivityType(event.target.value)}
              className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              placeholder="按 activity_type 过滤"
            />
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value || 50))}
              className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              placeholder="limit"
            />
            <input
              type="number"
              min={0}
              value={offset}
              onChange={(event) => setOffset(Number(event.target.value || 0))}
              className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              placeholder="offset"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <QuickFilterButton
              active={!activityType}
              label="All activities"
              onClick={() => {
                setActivityType('');
                setOffset(0);
                setSelectedActivityId('');
              }}
            />
            <QuickFilterButton
              active={activityType === 'xhs_commander_queue'}
              label="XHS Commander queue"
              onClick={() => {
                setActivityType('xhs_commander_queue');
                setOffset(0);
                setSelectedActivityId('');
              }}
            />
            <QuickFilterButton
              active={activityType === 'xhs_commander_task'}
              label="XHS Commander task"
              onClick={() => {
                setActivityType('xhs_commander_task');
                setOffset(0);
                setSelectedActivityId('');
              }}
            />
            <QuickFilterButton
              active={activityType === 'xhs_commander_reminder_policy_change'}
              label="XHS reminder policy"
              onClick={() => {
                setActivityType('xhs_commander_reminder_policy_change');
                setOffset(0);
                setSelectedActivityId('');
              }}
            />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard label="活动总数" value={String(items.length)} />
          <MetricCard label="活动类型" value={String(uniqueTypes.length)} icon={<Activity className="h-4 w-4" />} />
          <MetricCard label="参与主体" value={String(actorCount)} icon={<UserCircle2 className="h-4 w-4" />} />
          <MetricCard label="当前筛选" value={activityType || '全部'} icon={<ShieldCheck className="h-4 w-4" />} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-[28px] border p-5" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
              <Activity className="h-4 w-4" />
              Recent Activities
            </div>

            {activitiesQuery.isLoading ? (
              <EmptyState text="正在加载活动流..." />
            ) : items.length > 0 ? (
              <div className="mt-4 space-y-3">
                {items.map((item) => {
                  const selected = item.activity_id === selectedActivity?.activity_id;
                  return (
                    <button
                      key={item.activity_id}
                      type="button"
                      onClick={() => setSelectedActivityId(item.activity_id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        selected
                          ? 'border-cyan-400/35 bg-cyan-400/10'
                          : 'border-white/10 bg-slate-950/35 hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">{item.activity_type}</span>
                        <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">{item.actor_type}</span>
                        <span className="ml-auto text-xs text-slate-500">{formatDateTime(item.created_at)}</span>
                      </div>
                      <div className="mt-3 text-sm text-white">
                        {item.actor_name || item.actor_id || 'system'} → {item.target_name || item.target_id || 'unknown target'}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState text="当前筛选条件下没有活动记录。" />
            )}
          </div>

          <div className="rounded-[28px] border p-5" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              <ShieldCheck className="h-4 w-4" />
              Activity Detail
            </div>
            {selectedActivity ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-200">
                  <Row label="Activity ID" value={selectedActivity.activity_id} mono />
                  <Row label="Tenant" value={selectedActivity.tenant_id} />
                  <Row label="Type" value={selectedActivity.activity_type} />
                  <Row label="Actor" value={selectedActivity.actor_name || selectedActivity.actor_id || 'system'} />
                  <Row label="Target" value={selectedActivity.target_name || selectedActivity.target_id || '-'} />
                  <Row label="Time" value={formatDateTime(selectedActivity.created_at)} />
                </div>

                {selectedActivity.activity_type === 'xhs_commander_queue' ? (
                  <XhsCommanderActivityDetail activity={selectedActivity} />
                ) : null}

                {selectedActivity.activity_type === 'xhs_commander_task' ? (
                  <XhsCommanderTaskActivityDetail activity={selectedActivity} />
                ) : null}

                {selectedActivity.activity_type === 'xhs_commander_reminder_policy_change' ? (
                  <XhsReminderPolicyChangeActivityDetail activity={selectedActivity} />
                ) : null}

                <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                  <div className="text-sm font-semibold text-white">Details JSON</div>
                  <pre className="mt-3 overflow-x-auto rounded-xl bg-black/20 p-3 text-xs text-slate-300">
                    {JSON.stringify(selectedActivity.details || {}, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <EmptyState text="选择左侧一条活动记录查看详情。" />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function QuickFilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-2 text-sm ${
        active
          ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-100'
          : 'border-slate-700 bg-slate-950/50 text-slate-200 hover:bg-slate-800/70'
      }`}
    >
      {label}
    </button>
  );
}

function XhsCommanderActivityDetail({ activity }: { activity: ActivityStreamItem }) {
  const details = (activity.details ?? {}) as ActivityStreamDetails & {
    priority?: string;
    reason?: string;
    latest_action?: string;
    source_action_id?: string;
    assignee?: string;
    note?: string;
    actor?: {
      tenant_id?: string;
      roles?: string[];
      is_admin?: boolean;
    };
    updated_at?: string;
  };

  return (
    <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4">
      <div className="text-sm font-semibold text-rose-100">XHS Commander Queue</div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
        <Row label="Pack" value={activity.target_id} mono />
        <Row label="Status" value={String(details.status || '-')} />
        <Row label="Priority" value={String(details.priority || '-')} />
        <Row label="Latest action" value={String(details.latest_action || '-')} />
        <Row label="Assignee" value={String(details.assignee || '-')} />
        <Row label="Updated" value={formatDateTime(details.updated_at)} />
      </div>
      {details.reason ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-rose-50">
          {String(details.reason)}
        </div>
      ) : null}
      {details.note ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-rose-50">
          {String(details.note)}
        </div>
      ) : null}
    </div>
  );
}

function XhsCommanderTaskActivityDetail({ activity }: { activity: ActivityStreamItem }) {
  const details = (activity.details ?? {}) as ActivityStreamDetails & {
    status?: string;
    priority?: string;
    assignee?: string;
    source?: string;
    pack_id?: string;
    queue_id?: string;
    note?: string;
    details?: {
      queue_status?: string;
      latest_action?: string;
      latest_task_action?: string;
      reason?: string;
      source_action_id?: string;
    };
  };
  const nested = details.details ?? {};

  return (
    <div className="rounded-2xl border border-violet-500/25 bg-violet-500/10 p-4">
      <div className="text-sm font-semibold text-violet-100">XHS Commander Task</div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
        <Row label="Task" value={activity.target_id} mono />
        <Row label="Pack" value={String(details.pack_id || activity.trace_id || '-')} mono />
        <Row label="Status" value={String(details.status || '-')} />
        <Row label="Priority" value={String(details.priority || '-')} />
        <Row label="Assignee" value={String(details.assignee || '-')} />
        <Row label="Queue status" value={String(nested.queue_status || '-')} />
        <Row label="Task action" value={String(nested.latest_task_action || '-')} />
        <Row label="Updated" value={formatDateTime(activity.created_at)} />
      </div>
      {nested.reason ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-violet-50">
          {String(nested.reason)}
        </div>
      ) : null}
      {details.note ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-violet-50">
          {String(details.note)}
        </div>
      ) : null}
    </div>
  );
}

function XhsReminderPolicyChangeActivityDetail({ activity }: { activity: ActivityStreamItem }) {
  const details = (activity.details ?? {}) as ActivityStreamDetails & {
    change_source?: string;
    from_preset_id?: string;
    to_preset_id?: string;
    changed_fields?: Array<{
      field?: string;
      before?: unknown;
      after?: unknown;
    }>;
    actor?: {
      tenant_id?: string;
      roles?: string[];
      is_admin?: boolean;
    };
  };
  const changedFields = Array.isArray(details.changed_fields) ? details.changed_fields : [];

  return (
    <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-4">
      <div className="text-sm font-semibold text-cyan-100">XHS Reminder Policy Change</div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
        <Row label="Source" value={String(details.change_source || '-')} />
        <Row label="From preset" value={String(details.from_preset_id || '-')} />
        <Row label="To preset" value={String(details.to_preset_id || '-')} />
        <Row label="Actor roles" value={(details.actor?.roles ?? []).join(', ') || '-'} />
        <Row label="Admin" value={details.actor?.is_admin ? 'yes' : 'no'} />
        <Row label="Changed at" value={formatDateTime(activity.created_at)} />
      </div>
      <div className="mt-3 space-y-2">
        {changedFields.length ? (
          changedFields.map((field, index) => (
            <div key={`${field.field || 'field'}-${index}`} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-cyan-50">
              {String(field.field || '-')} : {String(field.before)} to {String(field.after)}
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-sm text-cyan-100/70">
            No changed field detail captured.
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
      <div className="text-slate-500">{label}</div>
      <div className={`${mono ? 'font-mono break-all' : ''} text-slate-100`}>{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/30 px-4 py-10 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}
