'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PlayCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { useWorkflowExecutionStream } from '@/hooks/useWorkflowExecutionStream';
import {
  fetchWorkflowDetail,
  fetchWorkflowExecution,
  fetchWorkflowExecutions,
  replayWorkflowExecution,
} from '@/services/endpoints/ai-subservice';
import type { WorkflowDefinitionDetail, WorkflowRunListItem, WorkflowRunStatus, WorkflowRunStep } from '@/types/workflow-engine';

const BORDER = 'rgba(71,85,105,0.42)';

function normalizeError(error: unknown, fallback: string): string {
  const maybe = error as { response?: { data?: { message?: string; detail?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.response?.data?.detail || maybe?.message || fallback;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatStructuredOutput(value: WorkflowRunStep['output_json']): string {
  if (value === null || value === undefined) return '-';
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

export default function WorkflowExecutionsPage() {
  const params = useParams<{ id: string }>();
  const workflowId = String(params?.id || '');

  const [workflow, setWorkflow] = useState<WorkflowDefinitionDetail | null>(null);
  const [items, setItems] = useState<WorkflowRunListItem[]>([]);
  const [selectedExecutionId, setSelectedExecutionId] = useState('');
  const [selectedExecution, setSelectedExecution] = useState<WorkflowRunStatus | null>(null);
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState('');
  const [errorText, setErrorText] = useState('');
  const [busy, setBusy] = useState(false);
  const stream = useWorkflowExecutionStream(
    selectedExecution?.status === 'running' || selectedExecution?.status === 'queued'
      ? selectedExecutionId
      : null,
  );

  const loadExecutions = async (preferredExecutionId?: string) => {
    const data = await fetchWorkflowExecutions(workflowId, {
      status: status || undefined,
      page: 1,
      page_size: 50,
    });
    const nextItems = data.items || [];
    setItems(nextItems);
    const targetId = preferredExecutionId || selectedExecutionId || nextItems[0]?.run_id || '';
    if (targetId) {
      setSelectedExecutionId(targetId);
      const detail = await fetchWorkflowExecution(targetId);
      setSelectedExecution(detail.execution || null);
    } else {
      setSelectedExecutionId('');
      setSelectedExecution(null);
    }
  };

  const loadWorkflow = async () => {
    const data = await fetchWorkflowDetail(workflowId);
    setWorkflow(data.workflow || null);
  };

  useEffect(() => {
    void (async () => {
      try {
        await loadWorkflow();
        await loadExecutions();
      } catch (error) {
        setErrorText(normalizeError(error, '执行历史加载失败'));
      }
    })();
  }, [status, workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(
    () => ({
      total: items.length,
      failed: items.filter((item) => item.status === 'failed').length,
      replayed: items.filter((item) => item.trigger_type === 'replay').length,
    }),
    [items],
  );

  const handleSelectExecution = async (executionId: string) => {
    setSelectedExecutionId(executionId);
    try {
      const detail = await fetchWorkflowExecution(executionId);
      setSelectedExecution(detail.execution || null);
    } catch (error) {
      setErrorText(normalizeError(error, '执行详情加载失败'));
    }
  };

  const handleReplay = async (fromStepId?: string) => {
    if (!selectedExecutionId) return;
    setBusy(true);
    setErrorText('');
    try {
      const data = await replayWorkflowExecution(selectedExecutionId, {
        from_step_id: fromStepId || undefined,
      });
      setNotice(`已创建重放执行 ${data.new_execution_id}`);
      await loadExecutions(data.new_execution_id);
    } catch (error) {
      setErrorText(normalizeError(error, '重放执行失败'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const latest = stream.events[stream.events.length - 1];
    if (!latest) return;
    if (latest.type === 'execution_completed' || latest.type === 'execution_failed' || latest.type === 'execution_cancelled') {
      void loadExecutions(selectedExecutionId || latest.execution_id).catch(() => null);
    }
  }, [selectedExecutionId, stream.events]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveProgress = useMemo(() => {
    const stepMap: Record<string, { status: string; duration_ms?: number; error?: string }> = {};
    for (const step of selectedExecution?.steps || []) {
      stepMap[step.step_id] = { status: step.status, error: step.error_message || undefined };
    }
    for (const event of stream.events) {
      if (!('step_id' in event) || !event.step_id) continue;
      if (event.type === 'step_started') {
        stepMap[event.step_id] = { status: 'running' };
      } else if (event.type === 'step_completed') {
        stepMap[event.step_id] = { status: 'done', duration_ms: event.duration_ms };
      } else if (event.type === 'step_failed') {
        stepMap[event.step_id] = { status: 'failed', duration_ms: event.duration_ms, error: event.error };
      } else if (event.type === 'step_skipped') {
        stepMap[event.step_id] = { status: 'skipped' };
      }
    }
    const total = selectedExecution?.steps.length || 0;
    const completed = Object.values(stepMap).filter((item) => item.status === 'done' || item.status === 'skipped').length;
    return {
      stepMap,
      total,
      completed,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [selectedExecution?.steps, stream.events]);

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto space-y-4">
        <section className="rounded-[28px] border p-5" style={{ background: 'linear-gradient(180deg, rgba(19,34,56,0.98), rgba(12,22,37,0.98))', borderColor: BORDER }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-cyan-300">Workflow Executions</div>
              <h1 className="mt-2 text-2xl font-semibold text-white">{workflow?.name || workflowId}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-300">查看该工作流的历史执行、逐步输出快照，并从任意失败节点直接发起重放。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/operations/workflows/${encodeURIComponent(workflowId)}/edit`} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/70">
                编辑配置
              </Link>
              <Link href={`/operations/workflows/${encodeURIComponent(workflowId)}/triggers`} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/70">
                Webhook 触发器
              </Link>
              <button
                type="button"
                onClick={() => void loadExecutions(selectedExecutionId).catch((error) => setErrorText(normalizeError(error, '执行历史加载失败')))}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-600/80 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="执行数" value={String(summary.total)} />
            <Metric label="失败数" value={String(summary.failed)} />
            <Metric label="重放数" value={String(summary.replayed)} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">全部状态</option>
              <option value="running">运行中</option>
              <option value="done">已完成</option>
              <option value="failed">失败</option>
              <option value="paused">已暂停</option>
            </select>
          </div>

          {notice ? <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{notice}</div> : null}
          {errorText ? <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{errorText}</div> : null}
        </section>

        <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-3">
            {items.map((item) => (
              <button
                type="button"
                key={item.run_id}
                onClick={() => void handleSelectExecution(item.run_id)}
                className={`w-full rounded-[22px] border p-4 text-left ${
                  selectedExecutionId === item.run_id ? 'border-cyan-400 bg-cyan-500/8' : 'border-slate-700 bg-[#1c2940]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">#{item.run_number}</div>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200">{item.status}</span>
                </div>
                <div className="mt-2 text-sm text-slate-300">{item.task}</div>
                <div className="mt-2 text-xs text-slate-400">
                  触发方式: {item.trigger_type}
                </div>
                {item.source_execution_id ? (
                  <div className="mt-1 text-xs text-slate-400">
                    来源执行: {item.source_execution_id}
                  </div>
                ) : null}
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                  <span>当前步骤: {item.current_step_id || '-'}</span>
                  <span>{formatDateTime(item.updated_at)}</span>
                </div>
              </button>
            ))}
            {!items.length ? (
              <div className="rounded-[22px] border border-slate-700 bg-[#1c2940] p-6 text-sm text-slate-400">
                当前筛选条件下没有执行记录。
              </div>
            ) : null}
          </div>

          <div className="rounded-[24px] border border-slate-700 bg-[#1c2940] p-4">
            {!selectedExecution ? (
              <div className="text-sm text-slate-400">点击左侧任一执行查看详细快照。</div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">#{selectedExecution.run_number}</div>
                    <div className="mt-1 text-xs text-slate-400">{selectedExecution.run_id}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleReplay()}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      全量重放
                    </button>
                    <Link href="/operations/workflows" className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800/70">
                      <PlayCircle className="h-4 w-4" />
                      返回控制台
                    </Link>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <InfoCard label="触发方式" value={selectedExecution.trigger_type} />
                  <InfoCard label="当前步骤" value={selectedExecution.current_step_id || '-'} />
                  <InfoCard label="状态" value={selectedExecution.status} />
                </div>

                {selectedExecution.source_execution_id ? (
                  <div className="rounded-xl border border-slate-700/60 bg-black/20 px-3 py-2 text-sm text-slate-300">
                    来源执行: {selectedExecution.source_execution_id}
                    {selectedExecution.replay_from_step_id ? ` · 重放起点: ${selectedExecution.replay_from_step_id}` : ''}
                  </div>
                ) : null}

                {selectedExecution.failure_reason ? (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    失败原因: {selectedExecution.failure_reason}
                  </div>
                ) : null}

                {selectedExecution.status === 'running' || selectedExecution.status === 'queued' ? (
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-white">实时执行流</div>
                      <div className="text-xs text-cyan-200">
                        {stream.connected ? '实时连接中' : '等待新事件'}
                        {stream.errorText ? ` · ${stream.errorText}` : ''}
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-cyan-400 transition-all"
                        style={{ width: `${liveProgress.percent}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-slate-300">
                      已完成 {liveProgress.completed}/{liveProgress.total} 步
                    </div>
                    <div className="mt-4 space-y-2">
                      {(selectedExecution.steps || []).map((step) => {
                        const live = liveProgress.stepMap[step.step_id];
                        return (
                          <div key={`live-${step.step_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700/60 bg-black/20 px-3 py-2">
                            <div className="text-sm text-slate-100">
                              {step.step_id} · {step.lobster_id}
                            </div>
                            <div className="text-xs text-slate-300">
                              {live?.status || step.status}
                              {typeof live?.duration_ms === 'number' ? ` · ${live.duration_ms}ms` : ''}
                              {live?.error ? ` · ${live.error}` : ''}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {stream.events.length ? (
                      <div className="mt-4 rounded-xl border border-slate-700/60 bg-black/20 p-3">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">事件流</div>
                        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto text-xs text-slate-200">
                          {stream.events.slice(-20).map((event, index) => (
                            <div key={`${event.type}-${event.ts}-${index}`} className="rounded-lg bg-slate-900/50 px-2 py-1.5">
                              <span className="font-medium text-cyan-200">{event.type}</span>
                              {'step_id' in event && event.step_id ? ` · ${event.step_id}` : ''}
                              {'error' in event && event.error ? ` · ${event.error}` : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-3">
                  {selectedExecution.steps.map((step, index) => (
                    <div key={step.step_id} className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            {index + 1}. {step.step_id} · {step.lobster_id}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {step.step_type} · retries {step.retry_count}/{step.max_retries} · {formatDateTime(step.updated_at)}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200">{step.status}</span>
                          <button
                            type="button"
                            onClick={() => void handleReplay(step.step_id)}
                            disabled={busy}
                            className="rounded-xl border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-50"
                          >
                            从这里重放
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 xl:grid-cols-3">
                        <Panel title="实际输入" content={step.rendered_input || '暂无输出'} />
                        <Panel title="文本输出" content={step.output_text || step.output_preview || '暂无输出'} />
                        <Panel title="结构化输出" content={formatStructuredOutput(step.output_json)} />
                      </div>

                      {step.error_message ? (
                        <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                          {step.error_message}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
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

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/40 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm text-slate-200">{value}</div>
    </div>
  );
}

function Panel({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-black/20 p-3">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-slate-200">{content}</pre>
    </div>
  );
}
