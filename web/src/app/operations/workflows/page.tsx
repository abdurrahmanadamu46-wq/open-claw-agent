'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PauseCircle, PlayCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { DangerActionGuard } from '@/components/DangerActionGuard';
import { DataTable } from '@/components/data-table/DataTable';
import { selectColumn } from '@/components/data-table/columns';
import { WorkflowContextMenu } from '@/components/entity-menus/WorkflowContextMenu';
import { ConcurrencyLimitBanner, ConcurrencyStatusBar } from '@/components/layout/ConcurrencyStatusBar';
import { Button } from '@/components/ui/Button';
import { useTenant } from '@/contexts/TenantContext';
import {
  fetchWorkflowDefinitions,
  fetchWorkflowLifecycle,
  fetchWorkflowRun,
  fetchWorkflowRuns,
  pauseWorkflowRun,
  resumeWorkflowRun,
  startWorkflowRun,
  updateWorkflowLifecycle,
} from '@/services/endpoints/ai-subservice';
import type { WorkflowDefinitionSummary, WorkflowLifecycle, WorkflowRunStatus } from '@/types/workflow-engine';

const BORDER = 'rgba(71,85,105,0.42)';

function lifecycleTone(lifecycle?: WorkflowLifecycle): string {
  switch (lifecycle) {
    case 'paused':
      return 'border-amber-400/35 bg-amber-400/10 text-amber-100';
    case 'archived':
      return 'border-rose-400/35 bg-rose-400/10 text-rose-100';
    case 'draft':
      return 'border-slate-500/35 bg-slate-500/10 text-slate-200';
    default:
      return 'border-emerald-400/35 bg-emerald-400/10 text-emerald-100';
  }
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizeError(error: unknown, fallback: string): string {
  const maybe = error as { response?: { status?: number; data?: { message?: string; detail?: string } }; message?: string };
  const detail = maybe?.response?.data?.message || maybe?.response?.data?.detail;
  return detail || maybe?.message || fallback;
}

export default function WorkflowsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const t = useTranslations('operations.workflows');
  const common = useTranslations('common');
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';

  const [definitions, setDefinitions] = useState<WorkflowDefinitionSummary[]>([]);
  const [runs, setRuns] = useState<Array<{ run_id: string; workflow_id: string; task: string; status: string; run_number: number; current_step_id?: string | null; updated_at: string }>>([]);
  const [selectedRun, setSelectedRun] = useState<WorkflowRunStatus | null>(null);
  const [selectedWorkflows, setSelectedWorkflows] = useState<WorkflowDefinitionSummary[]>([]);
  const [workflowId, setWorkflowId] = useState('content-campaign');
  const [task, setTask] = useState('为 618 活动生成小红书和抖音内容工作流。');
  const [contextJson, setContextJson] = useState(
    JSON.stringify(
      {
        account_info: { brand: '龙虾池官方账号', objective: '618 拉新' },
        account_config: { owner: 'content-team', priority: 'high' },
        platforms: [
          { name: '小红书', features: '种草笔记、标题钩子、评论区承接' },
          { name: '抖音', features: '短视频脚本、前三秒强钩子、互动引导' }
        ]
      },
      null,
      2
    )
  );
  const [notice, setNotice] = useState('');
  const [errorText, setErrorText] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedRunId = selectedRun?.run_id;
  const selectedWorkflow = useMemo(
    () => definitions.find((item) => item.id === workflowId) || null,
    [definitions, workflowId]
  );

  const loadDefinitions = async () => {
    const data = await fetchWorkflowDefinitions();
    const workflows = await Promise.all(
      (data.workflows || []).map(async (item) => {
        try {
          const lifecycle = await fetchWorkflowLifecycle(item.id);
          return { ...item, lifecycle: lifecycle.lifecycle };
        } catch {
          return { ...item, lifecycle: 'active' as WorkflowLifecycle };
        }
      }),
    );
    setDefinitions(workflows);
    if (!workflowId && data.workflows?.[0]?.id) {
      setWorkflowId(data.workflows[0].id);
    }
  };

  const loadRuns = async () => {
    const data = await fetchWorkflowRuns(30);
    setRuns(data.runs || []);
  };

  const loadRunDetail = async (runId: string) => {
    const data = await fetchWorkflowRun(runId);
    setSelectedRun(data.run || null);
  };

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadDefinitions(), loadRuns()]);
      } catch (error) {
        setErrorText(normalizeError(error, t('messages.requestFailed')));
      }
    })();
  }, [tenantId, t]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedRunId || selectedRun?.status !== 'running') return;
    const timer = window.setInterval(() => {
      void loadRunDetail(selectedRunId).catch((error) => setErrorText(normalizeError(error, t('messages.requestFailed'))));
      void loadRuns().catch((error) => setErrorText(normalizeError(error, t('messages.requestFailed'))));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [selectedRunId, selectedRun?.status, t]);

  const summary = useMemo(
    () => ({
      total: runs.length,
      running: runs.filter((item) => item.status === 'running').length,
      paused: runs.filter((item) => item.status === 'paused').length
    }),
    [runs]
  );

  const handleStart = async () => {
    setBusy(true);
    setErrorText('');
    try {
      const parsed = contextJson.trim() ? JSON.parse(contextJson) : {};
      const data = await startWorkflowRun({
        workflow_id: workflowId,
        task,
        context: parsed
      });
      setNotice(t('messages.started', { workflowId, runNumber: data.run.run_number }));
      setSelectedRun(data.run);
      await loadRuns();
    } catch (error) {
      setErrorText(normalizeError(error, t('messages.requestFailed')));
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async (runId: string) => {
    try {
      await resumeWorkflowRun(runId);
      setNotice(t('messages.resumed', { runId }));
      await Promise.all([loadRuns(), loadRunDetail(runId)]);
    } catch (error) {
      setErrorText(normalizeError(error, t('messages.requestFailed')));
    }
  };

  const handlePause = async (runId: string) => {
    try {
      await pauseWorkflowRun(runId);
      setNotice(t('messages.paused', { runId }));
      await Promise.all([loadRuns(), loadRunDetail(runId)]);
    } catch (error) {
      setErrorText(normalizeError(error, t('messages.requestFailed')));
    }
  };

  const handleBatchLifecycle = async (nextLifecycle: WorkflowLifecycle) => {
    try {
      await Promise.all(
        selectedWorkflows.map((workflow) =>
          updateWorkflowLifecycle(workflow.id, {
            new_lifecycle: nextLifecycle,
            reason: 'datatable_batch_action',
          }),
        ),
      );
      setNotice(`已批量更新 ${selectedWorkflows.length} 个工作流为 ${nextLifecycle}`);
      setSelectedWorkflows([]);
      await loadDefinitions();
    } catch (error) {
      setErrorText(normalizeError(error, t('messages.requestFailed')));
    }
  };

  const workflowColumns = useMemo<ColumnDef<WorkflowDefinitionSummary>[]>(
    () => [
      selectColumn<WorkflowDefinitionSummary>(),
      {
        accessorKey: 'name',
        header: '工作流',
      },
      {
        accessorKey: 'step_count',
        header: '步骤数',
      },
      {
        accessorKey: 'lifecycle',
        header: '生命周期',
        cell: ({ row }) => (
          <span className={`rounded-full border px-3 py-1 text-xs ${lifecycleTone(row.original.lifecycle)}`}>
            {row.original.lifecycle || 'active'}
          </span>
        ),
      },
    ],
    [],
  );

  if (!mounted) return <div className="p-6"><div className="h-96 animate-pulse rounded-[28px] bg-slate-900/60" /></div>;

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto mb-4 flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <ConcurrencyStatusBar />
      </div>
      <div className="mx-auto mb-4 max-w-7xl">
        <ConcurrencyLimitBanner />
      </div>
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
        <section className="rounded-[28px] border p-5" style={{ background: 'linear-gradient(180deg, rgba(19,34,56,0.98), rgba(12,22,37,0.98))', borderColor: BORDER }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-cyan-300">{t('badge')}</div>
              <h1 className="mt-2 text-2xl font-semibold text-white">{t('title')}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-300">{t('description')}</p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600/80 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
              onClick={() => {
                void loadDefinitions().catch((error) => setErrorText(normalizeError(error, t('messages.requestFailed'))));
                void loadRuns().catch((error) => setErrorText(normalizeError(error, t('messages.requestFailed'))));
              }}
            >
              <RefreshCw size={14} />
              {common('refresh')}
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label={t('metrics.total')} value={String(summary.total)} />
            <Metric label={t('metrics.running')} value={String(summary.running)} />
            <Metric label={t('metrics.paused')} value={String(summary.paused)} />
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Workflow Catalog</div>
              <div className="text-xs text-slate-500">支持右键操作，也支持批量暂停 / 归档</div>
            </div>
            <DataTable
              columns={workflowColumns}
              data={definitions}
              selectable
              onSelectionChange={setSelectedWorkflows}
              onRowClick={(row) => setWorkflowId(row.id)}
              batchActions={
                <>
                  <Button variant="ghost" onClick={() => void handleBatchLifecycle('paused')}>
                    批量暂停
                  </Button>
                  <Button variant="ghost" onClick={() => void handleBatchLifecycle('active')}>
                    批量恢复
                  </Button>
                  <DangerActionGuard
                    trigger={<Button variant="danger">批量归档</Button>}
                    title={`批量归档 ${selectedWorkflows.length} 个工作流`}
                    description="归档后这些工作流不会再参与新的调度。请确认当前没有依赖它们的人工编排流程。"
                    confirmText="ARCHIVE"
                    confirmLabel="确认归档"
                    successMessage="批量归档完成"
                    onConfirm={async () => {
                      await handleBatchLifecycle('archived');
                    }}
                    disabled={selectedWorkflows.length === 0}
                  />
                </>
              }
            />
          </div>

          <div className="mt-5 space-y-3">
            <Field label={t('fields.workflow')}>
              <select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
                {definitions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.id})
                  </option>
                ))}
              </select>
            </Field>

            <div className="flex flex-wrap gap-2">
              <Link href="/operations/workflows/templates" className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/10">
                从模板创建
              </Link>
              {selectedWorkflow ? (
                <>
                  <Link href={`/operations/workflows/${encodeURIComponent(selectedWorkflow.id)}/edit`} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/70">
                    编辑补偿配置
                  </Link>
                  <Link href={`/operations/workflows/${encodeURIComponent(selectedWorkflow.id)}/executions`} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/70">
                    执行历史
                  </Link>
                  <Link href={`/operations/workflows/${encodeURIComponent(selectedWorkflow.id)}/triggers`} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/70">
                    Webhook 触发器
                  </Link>
                </>
              ) : null}
            </div>

            <Field label={t('fields.task')}>
              <textarea value={task} onChange={(event) => setTask(event.target.value)} rows={4} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100" />
            </Field>

            <Field label={t('fields.context')}>
              <textarea value={contextJson} onChange={(event) => setContextJson(event.target.value)} rows={14} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-100" />
            </Field>

            {notice ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{notice}</div> : null}
            {errorText ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{errorText}</div> : null}

            <button type="button" onClick={() => void handleStart()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60">
              <PlayCircle size={15} />
              {busy ? t('buttons.starting') : t('buttons.start')}
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-[28px] border bg-[#111c2d] p-4" style={{ borderColor: BORDER }}>
            <div className="text-xs uppercase tracking-[0.2em] text-amber-300">{t('badge')}</div>
            <div className="mt-2 text-lg font-semibold text-white">{t('sections.runs')}</div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
            <div className="space-y-3">
              {runs.map((item) => (
                <button
                  type="button"
                  key={item.run_id}
                  onClick={() => void loadRunDetail(item.run_id).catch((error) => setErrorText(normalizeError(error, t('messages.requestFailed'))))}
                  className={`w-full rounded-[22px] border p-4 text-left ${
                    selectedRunId === item.run_id ? 'border-cyan-400 bg-cyan-500/8' : 'border-slate-700 bg-[#1c2940]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">#{item.run_number} · {item.workflow_id}</div>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200">{item.status}</span>
                  </div>
                  <div className="mt-2 text-sm text-slate-300">{item.task}</div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                    <span>{t('sections.currentStep')}：{item.current_step_id || '-'}</span>
                    <span>{formatDateTime(item.updated_at)}</span>
                  </div>
                </button>
              ))}
              {!runs.length ? (
                <div className="rounded-[22px] border border-slate-700 bg-[#1c2940] p-6 text-sm text-slate-400">
                  {t('sections.emptyRuns')}
                </div>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-slate-700 bg-[#1c2940] p-4">
              {!selectedRun ? (
                <div className="text-sm text-slate-400">{t('sections.emptyDetail')}</div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Run #{selectedRun.run_number}</div>
                      <div className="mt-1 text-xs text-slate-400">{selectedRun.workflow_id} · {selectedRun.run_id}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void loadRunDetail(selectedRun.run_id).catch((error) => setErrorText(normalizeError(error, t('messages.requestFailed'))))} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800/70">
                        <RefreshCw size={14} />
                        {t('buttons.refreshDetail')}
                      </button>
                      <button type="button" onClick={() => void handleResume(selectedRun.run_id)} disabled={selectedRun.status !== 'paused'} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50">
                        <RotateCcw size={14} />
                        {t('buttons.resume')}
                      </button>
                      <button type="button" onClick={() => void handlePause(selectedRun.run_id)} disabled={selectedRun.status !== 'running'} className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/10 disabled:opacity-50">
                        <PauseCircle size={14} />
                        {t('buttons.pause')}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{t('sections.task')}</div>
                    <div className="mt-2 text-sm text-slate-200">{selectedRun.task}</div>
                    {selectedRun.failure_reason ? (
                      <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                        {t('sections.failureReason')}：{selectedRun.failure_reason}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    {selectedRun.steps.map((step, index) => (
                      <div key={step.step_id} className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {index + 1}. {step.step_id} · {step.lobster_id}
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              {step.step_type} · retries {step.retry_count}/{step.max_retries} · updated {formatDateTime(step.updated_at)}
                            </div>
                          </div>
                          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200">{step.status}</span>
                        </div>

                        <div className="mt-3 rounded-xl border border-slate-700/60 bg-black/20 px-3 py-2 text-sm text-slate-200">
                          {step.output_preview || t('sections.noOutput')}
                        </div>

                        {step.error_message ? (
                          <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                            {step.error_message}
                          </div>
                        ) : null}

                        {step.stories.length ? (
                          <div className="mt-3 space-y-2">
                            {step.stories.map((story) => (
                              <div key={story.story_id} className="rounded-xl border border-slate-700/60 bg-black/20 px-3 py-2">
                                <div className="flex items-center justify-between gap-3 text-sm text-slate-200">
                                  <span>{story.title}</span>
                                  <span className="text-xs text-slate-400">{story.status}</span>
                                </div>
                                <div className="mt-1 text-xs text-slate-400">{story.output_preview || story.error_message || t('sections.noOutput')}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
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
      <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}
