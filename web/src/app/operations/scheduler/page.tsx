'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Bot, Clock3, History, PauseCircle, RefreshCw, Save } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTenant } from '@/contexts/TenantContext';
import {
  createSchedulerTask,
  disableSchedulerTask,
  fetchSchedulerTaskHistory,
  fetchSchedulerTasks,
  type SchedulerRunHistoryItem,
  type SchedulerTask,
} from '@/services/endpoints/ai-subservice';

const BORDER = 'rgba(71,85,105,0.42)';
const CARD_BG = '#111c2d';
const PANEL_BG = '#1c2940';
const MUTED = '#94A3B8';

const LOBSTER_OPTIONS = [
  { id: 'radar', label: '触须虾 Radar' },
  { id: 'strategist', label: '脑虫虾 Strategist' },
  { id: 'inkwriter', label: '吐墨虾 InkWriter' },
  { id: 'visualizer', label: '幻影虾 Visualizer' },
  { id: 'dispatcher', label: '点兵虾 Dispatcher' },
  { id: 'echoer', label: '回声虾 Echoer' },
  { id: 'catcher', label: '铁网虾 Catcher' },
  { id: 'abacus', label: '金算虾 Abacus' },
  { id: 'followup', label: '回访虾 FollowUp' },
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
  });
}

function scheduleHint(kind: 'cron' | 'every' | 'once'): string {
  if (kind === 'cron') return '示例: 0 8 * * *';
  if (kind === 'every') return '示例: 30m / 1h / 15s';
  return '示例: 2026-04-01T10:00:00+08:00';
}

function normalizeAxiosError(error: unknown): string {
  const maybe = error as { response?: { status?: number; data?: { message?: string; detail?: string } }; message?: string };
  const status = maybe?.response?.status;
  const detail = maybe?.response?.data?.message || maybe?.response?.data?.detail;
  if (status && detail) return `请求失败 (${status}): ${detail}`;
  if (status) return `请求失败 (${status})`;
  return maybe?.message || '请求失败';
}

function SchedulerPageContent() {
  const searchParams = useSearchParams();
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';

  const [tasks, setTasks] = useState<SchedulerTask[]>([]);
  const [historyByTask, setHistoryByTask] = useState<Record<string, SchedulerRunHistoryItem[]>>({});
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [notice, setNotice] = useState('');

  const [name, setName] = useState('');
  const [kind, setKind] = useState<'cron' | 'every' | 'once'>('cron');
  const [schedule, setSchedule] = useState('0 8 * * *');
  const [lobsterId, setLobsterId] = useState('radar');
  const [prompt, setPrompt] = useState('');
  const [sessionMode, setSessionMode] = useState<'shared' | 'per-peer' | 'isolated'>('isolated');
  const [deliveryChannel, setDeliveryChannel] = useState('last');
  const [maxRetries, setMaxRetries] = useState(2);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const loadTasks = async () => {
    setLoading(true);
    setErrorText('');
    try {
      const data = await fetchSchedulerTasks(tenantId);
      setTasks(data.tasks || []);
      if (!notice) {
        setNotice(`已同步租户 ${tenantId} 的定时任务。`);
      }
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    const preset = searchParams?.get('preset');
    if (preset !== '1') {
      return;
    }
    const nextName = searchParams?.get('name');
    const nextKind = searchParams?.get('kind');
    const nextSchedule = searchParams?.get('schedule');
    const nextLobsterId = searchParams?.get('lobster_id');
    const nextPrompt = searchParams?.get('prompt');
    const nextSessionMode = searchParams?.get('session_mode');
    const nextDeliveryChannel = searchParams?.get('delivery_channel');

    if (nextName) setName(nextName);
    if (nextKind === 'cron' || nextKind === 'every' || nextKind === 'once') setKind(nextKind);
    if (nextSchedule) setSchedule(nextSchedule);
    if (nextLobsterId) setLobsterId(nextLobsterId);
    if (nextPrompt) setPrompt(nextPrompt);
    if (nextSessionMode === 'shared' || nextSessionMode === 'per-peer' || nextSessionMode === 'isolated') {
      setSessionMode(nextSessionMode);
    }
    if (nextDeliveryChannel) setDeliveryChannel(nextDeliveryChannel);
    setNotice(`已从用例模板预填表单：${nextName || '未命名模板'}。确认后直接创建即可。`);
  }, [searchParams]);

  const resetForm = () => {
    setName('');
    setKind('cron');
    setSchedule('0 8 * * *');
    setLobsterId('radar');
    setPrompt('');
    setSessionMode('isolated');
    setDeliveryChannel('last');
    setMaxRetries(2);
    setEditingTaskId(null);
  };

  const submitTask = async () => {
    if (!name.trim() || !schedule.trim() || !prompt.trim() || !lobsterId.trim()) {
      setErrorText('名称、调度表达式、龙虾和任务描述都不能为空。');
      return;
    }
    setSubmitting(true);
    setErrorText('');
    try {
      const result = await createSchedulerTask({
        tenant_id: tenantId,
        name: name.trim(),
        kind,
        schedule: schedule.trim(),
        lobster_id: lobsterId.trim(),
        prompt: prompt.trim(),
        session_mode: sessionMode,
        delivery_channel: deliveryChannel.trim() || 'last',
        max_retries: maxRetries,
        enabled: true,
      });
      setNotice(
        editingTaskId
          ? `已更新任务 ${name}，下次执行时间 ${formatDateTime(result.next_run_at)}。`
          : `已创建任务 ${name}，下次执行时间 ${formatDateTime(result.next_run_at)}。`,
      );
      resetForm();
      await loadTasks();
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const pauseTask = async (taskId: string) => {
    try {
      await disableSchedulerTask(taskId, tenantId);
      setNotice(`已暂停任务 ${taskId}。`);
      await loadTasks();
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    }
  };

  const openHistory = async (task: SchedulerTask) => {
    if (expandedTaskId === task.task_id) {
      setExpandedTaskId(null);
      return;
    }
    setExpandedTaskId(task.task_id);
    if (historyByTask[task.task_id]) {
      return;
    }
    try {
      const data = await fetchSchedulerTaskHistory(task.task_id, 20);
      setHistoryByTask((prev) => ({ ...prev, [task.task_id]: data.history || [] }));
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    }
  };

  const editTask = (task: SchedulerTask) => {
    setEditingTaskId(task.task_id);
    setName(task.name);
    setKind(task.kind);
    setSchedule(task.schedule);
    setLobsterId(task.lobster_id);
    setPrompt(task.prompt);
    setSessionMode(task.session_mode);
    setDeliveryChannel(task.delivery_channel);
    setMaxRetries(task.max_retries);
    setNotice(`已载入任务 ${task.name}，保持同名提交会覆盖原任务。`);
  };

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section
          className="rounded-[28px] border p-5"
          style={{ background: 'linear-gradient(180deg, rgba(19,34,56,0.98), rgba(12,22,37,0.98))', borderColor: BORDER }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-cyan-300">Scheduler</div>
              <h1 className="mt-2 text-2xl font-semibold text-white">定时任务管理</h1>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                把龙虾从“只能手动点一次”升级成持续巡航。支持 cron、间隔轮询和一次性延迟三种模式。
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600/80 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
              onClick={() => void loadTasks()}
            >
              <RefreshCw size={14} />
              刷新
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="总任务数" value={String(tasks.length)} />
            <Metric label="启用中" value={String(tasks.filter((task) => task.enabled).length)} />
            <Metric label="失败累计" value={String(tasks.reduce((sum, task) => sum + task.fail_count, 0))} />
          </div>

          <div className="mt-5 space-y-3">
            <Field label="任务名称">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                placeholder="例如：每日行业早报"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="调度模式">
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as 'cron' | 'every' | 'once')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="cron">cron 表达式</option>
                  <option value="every">间隔轮询</option>
                  <option value="once">一次性延迟</option>
                </select>
              </Field>
              <Field label="绑定龙虾">
                <select
                  value={lobsterId}
                  onChange={(event) => setLobsterId(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                >
                  {LOBSTER_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="调度表达式">
              <input
                value={schedule}
                onChange={(event) => setSchedule(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                placeholder={scheduleHint(kind)}
              />
              <p className="mt-1 text-xs text-slate-500">{scheduleHint(kind)}</p>
            </Field>

            <Field label="任务 Prompt">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={7}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                placeholder="写清楚定时要做什么，例如：每天 8 点输出昨日竞品动态摘要，并标出需要升级到脑虫虾的趋势。"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="会话模式">
                <select
                  value={sessionMode}
                  onChange={(event) => setSessionMode(event.target.value as 'shared' | 'per-peer' | 'isolated')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="isolated">isolated</option>
                  <option value="per-peer">per-peer</option>
                  <option value="shared">shared</option>
                </select>
              </Field>
              <Field label="结果渠道">
                <input
                  value={deliveryChannel}
                  onChange={(event) => setDeliveryChannel(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                  placeholder="last"
                />
              </Field>
              <Field label="最大重试">
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={maxRetries}
                  onChange={(event) => setMaxRetries(Number(event.target.value || 0))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                />
              </Field>
            </div>

            {notice ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                {notice}
              </div>
            ) : null}
            {errorText ? (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {errorText}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void submitTask()}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
              >
                <Save size={15} />
                {submitting ? '提交中...' : editingTaskId ? '覆盖保存' : '创建任务'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800/70"
              >
                清空表单
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div
            className="rounded-[28px] border p-4"
            style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-amber-300">Task Fleet</div>
                <div className="mt-2 text-lg font-semibold text-white">当前定时任务</div>
              </div>
              <div className="text-sm text-slate-400">
                {loading ? '同步中...' : `租户 ${tenantId} · ${tasks.length} 个任务`}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {tasks.map((task) => {
              const history = historyByTask[task.task_id] || [];
              const expanded = expandedTaskId === task.task_id;
              return (
                <article
                  key={task.task_id}
                  className="rounded-[24px] border p-4"
                  style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
                          <Bot size={12} />
                          {task.lobster_id}
                        </span>
                        <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">
                          {task.kind} · {task.schedule}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs ${
                            task.enabled ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {task.enabled ? '运行中' : '已暂停'}
                        </span>
                      </div>
                      <div className="text-lg font-semibold text-white">{task.name}</div>
                      <p className="max-w-3xl text-sm leading-6 text-slate-300">{task.prompt}</p>
                    </div>

                    <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                      <StatRow label="下次运行" value={formatDateTime(task.next_run_at)} />
                      <StatRow label="上次运行" value={formatDateTime(task.last_run_at)} />
                      <StatRow label="累计执行" value={String(task.run_count)} />
                      <StatRow label="累计失败" value={String(task.fail_count)} />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => editTask(task)}
                      className="rounded-xl border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800/70"
                    >
                      编辑表单
                    </button>
                    <button
                      type="button"
                      onClick={() => void openHistory(task)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800/70"
                    >
                      <History size={14} />
                      {expanded ? '收起历史' : '查看历史'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void pauseTask(task.task_id)}
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/10"
                    >
                      <PauseCircle size={14} />
                      暂停
                    </button>
                  </div>

                  {expanded ? (
                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-700/70">
                      <div className="grid grid-cols-[170px_120px_minmax(0,1fr)] gap-0 bg-slate-950/60 px-4 py-2 text-xs uppercase tracking-[0.16em] text-slate-400">
                        <div>Started</div>
                        <div>Status</div>
                        <div>Summary</div>
                      </div>
                      {(history.length ? history : [{ id: 0, started_at: '', status: 'empty', result_summary: '暂无执行历史。' } as SchedulerRunHistoryItem]).map((item) => (
                        <div
                          key={`${task.task_id}-${item.id}-${item.started_at}`}
                          className="grid grid-cols-[170px_120px_minmax(0,1fr)] gap-0 border-t border-slate-800 px-4 py-3 text-sm text-slate-200"
                        >
                          <div className="inline-flex items-center gap-2 text-slate-300">
                            <Clock3 size={14} />
                            {item.started_at ? formatDateTime(item.started_at) : '-'}
                          </div>
                          <div>
                            <span
                              className={`rounded-full px-2 py-1 text-xs ${
                                item.status === 'success'
                                  ? 'bg-emerald-500/15 text-emerald-200'
                                  : item.status === 'failed'
                                    ? 'bg-rose-500/15 text-rose-200'
                                    : 'bg-slate-700 text-slate-300'
                              }`}
                            >
                              {item.status}
                            </span>
                          </div>
                          <div className="text-slate-300">
                            {item.result_summary || item.error_message || '无摘要'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}

            {!tasks.length && !loading ? (
              <div
                className="rounded-[24px] border p-10 text-center"
                style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
              >
                <div className="text-lg font-semibold text-white">还没有定时任务</div>
                <p className="mt-2 text-sm text-slate-400">
                  先从一条低风险巡检任务开始，例如每天 8 点让 `radar` 输出行业早报，或者每 30 分钟让 `dispatcher` 做库存/发布状态巡检。
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function SchedulerPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-300">正在加载定时任务面板...</div>}>
      <SchedulerPageContent />
    </Suspense>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm text-slate-200">
      <span className="mb-1 block text-xs uppercase tracking-[0.16em]" style={{ color: MUTED }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-950/40 px-3 py-2">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-100">{value}</div>
    </div>
  );
}
