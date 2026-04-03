'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Save } from 'lucide-react';
import {
  fetchWorkflowDefinitions,
  fetchWorkflowDetail,
  updateWorkflowDefinition,
} from '@/services/endpoints/ai-subservice';
import type { WorkflowDefinitionDetail, WorkflowDefinitionSummary } from '@/types/workflow-engine';

const BORDER = 'rgba(71,85,105,0.42)';

function normalizeError(error: unknown, fallback: string): string {
  const maybe = error as { response?: { data?: { message?: string; detail?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.response?.data?.detail || maybe?.message || fallback;
}

export default function WorkflowEditPage() {
  const params = useParams<{ id: string }>();
  const workflowId = String(params?.id || '');

  const [workflow, setWorkflow] = useState<WorkflowDefinitionDetail | null>(null);
  const [definitions, setDefinitions] = useState<WorkflowDefinitionSummary[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errorWorkflowId, setErrorWorkflowId] = useState('');
  const [notifyChannels, setNotifyChannels] = useState('');
  const [notice, setNotice] = useState('');
  const [errorText, setErrorText] = useState('');
  const [busy, setBusy] = useState(false);

  const loadAll = async () => {
    const [workflowData, definitionsData] = await Promise.all([
      fetchWorkflowDetail(workflowId),
      fetchWorkflowDefinitions(),
    ]);
    const detail = workflowData.workflow || null;
    setWorkflow(detail);
    setDefinitions(definitionsData.workflows || []);
    setName(detail?.name || '');
    setDescription(detail?.description || '');
    setErrorWorkflowId(detail?.error_workflow_id || '');
    setNotifyChannels((detail?.error_notify_channels || []).join(', '));
  };

  useEffect(() => {
    void loadAll().catch((error) => setErrorText(normalizeError(error, '工作流配置加载失败')));
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const errorWorkflowOptions = useMemo(
    () => definitions.filter((item) => item.id !== workflowId),
    [definitions, workflowId],
  );

  const handleSave = async () => {
    setBusy(true);
    setErrorText('');
    try {
      const channels = notifyChannels
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const data = await updateWorkflowDefinition(workflowId, {
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        error_workflow_id: errorWorkflowId || null,
        error_notify_channels: channels.length ? channels : null,
      });
      setWorkflow(data.workflow);
      setNotice('工作流配置已保存');
    } catch (error) {
      setErrorText(normalizeError(error, '保存工作流配置失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#07111f] p-6 text-slate-100">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[480px_minmax(0,1fr)]">
        <section className="rounded-[28px] border p-5" style={{ background: 'linear-gradient(180deg, rgba(19,34,56,0.98), rgba(12,22,37,0.98))', borderColor: BORDER }}>
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-cyan-300">Workflow Settings</div>
            <h1 className="mt-2 text-2xl font-semibold text-white">{workflow?.name || workflowId}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">在这里配置失败补偿工作流、通知渠道和当前模板来源，给生产工作流补上 n8n 风格的错误兜底能力。</p>
          </div>

          <div className="mt-5 space-y-4">
            <Field label="工作流名称">
              <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100" />
            </Field>

            <Field label="描述">
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100" />
            </Field>

            <Field label="失败补偿工作流">
              <select value={errorWorkflowId} onChange={(event) => setErrorWorkflowId(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
                <option value="">不启用</option>
                <option value="system_error_notifier">system_error_notifier</option>
                {errorWorkflowOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.id})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="通知渠道">
              <input
                value={notifyChannels}
                onChange={(event) => setNotifyChannels(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                placeholder="用逗号分隔，例如：feishu, telegram"
              />
            </Field>

            {workflow?.source_template_id ? (
              <div className="rounded-xl border border-slate-700/60 bg-black/20 px-3 py-2 text-sm text-slate-300">
                来源模板: {workflow.source_template_id}
              </div>
            ) : null}

            {notice ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{notice}</div> : null}
            {errorText ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{errorText}</div> : null}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void handleSave()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60">
                <Save className="h-4 w-4" />
                {busy ? '保存中...' : '保存'}
              </button>
              <Link href={`/operations/workflows/${encodeURIComponent(workflowId)}/executions`} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/70">
                执行历史
              </Link>
              <Link href={`/operations/workflows/${encodeURIComponent(workflowId)}/triggers`} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/70">
                Webhook 触发器
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-700 bg-[#1c2940] p-5">
          <div className="text-sm font-semibold text-white">步骤概览</div>
          <div className="mt-1 text-sm text-slate-400">这里展示当前工作流的步骤、期望输出和重试摘要，便于判断错误补偿的接入位置。</div>

          <div className="mt-5 space-y-3">
            {workflow?.steps.map((step, index) => (
              <div key={step.step_id} className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {index + 1}. {step.step_id}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {step.agent} · {step.step_type}
                    </div>
                  </div>
                  <div className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200">
                    最大重试 {step.max_retries} 次
                  </div>
                </div>
                <div className="mt-3 rounded-xl border border-slate-700/60 bg-black/20 px-3 py-2 text-sm text-slate-200">
                  {step.expects || '未设置 expects'}
                </div>
                {typeof step.retry_delay_seconds === 'number' && step.retry_delay_seconds > 0 ? (
                  <div className="mt-2 text-xs text-slate-400">
                    每次重试延迟 {step.retry_delay_seconds} 秒
                  </div>
                ) : null}
              </div>
            ))}
            {!workflow?.steps.length ? <div className="text-sm text-slate-400">当前工作流没有可展示的步骤。</div> : null}
          </div>
        </section>
      </div>
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
