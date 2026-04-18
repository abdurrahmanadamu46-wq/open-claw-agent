'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Copy, RefreshCw, Webhook } from 'lucide-react';
import { DangerActionGuard } from '@/components/DangerActionGuard';
import {
  createWorkflowWebhook,
  deleteWorkflowWebhook,
  fetchWorkflowDetail,
  fetchWorkflowWebhooks,
} from '@/services/endpoints/ai-subservice';
import type { WorkflowDefinitionDetail, WorkflowWebhook as WorkflowWebhookItem } from '@/types/workflow-engine';

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

export default function WorkflowTriggersPage() {
  const params = useParams<{ id: string }>();
  const workflowId = String(params?.id || '');

  const [workflow, setWorkflow] = useState<WorkflowDefinitionDetail | null>(null);
  const [items, setItems] = useState<WorkflowWebhookItem[]>([]);
  const [notice, setNotice] = useState('');
  const [errorText, setErrorText] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState('');

  const [name, setName] = useState('');
  const [httpMethod, setHttpMethod] = useState<'POST' | 'GET' | 'ANY'>('POST');
  const [authType, setAuthType] = useState<'none' | 'header_token' | 'basic_auth'>('none');
  const [responseMode, setResponseMode] = useState<'immediate' | 'wait_for_completion'>('immediate');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const loadAll = async () => {
    const [workflowData, webhooksData] = await Promise.all([
      fetchWorkflowDetail(workflowId),
      fetchWorkflowWebhooks(workflowId),
    ]);
    setWorkflow(workflowData.workflow || null);
    setItems(webhooksData.items || []);
  };

  useEffect(() => {
    void loadAll().catch((error) => setErrorText(normalizeError(error, 'Webhook 列表加载失败')));
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(
    () => ({
      total: items.length,
      triggered: items.reduce((sum, item) => sum + item.trigger_count, 0),
      active: items.filter((item) => item.is_active).length,
    }),
    [items],
  );

  const resolveWebhookUrl = (item: WorkflowWebhookItem): string => {
    if (item.webhook_url?.startsWith('http')) return item.webhook_url;
    if (typeof window !== 'undefined') {
      const path = item.webhook_path || item.webhook_url || `/webhook/workflows/${item.webhook_id}`;
      return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
    }
    return item.webhook_url || item.webhook_path || '';
  };

  const handleCreate = async () => {
    setBusy(true);
    setErrorText('');
    try {
      let authConfig: Record<string, string> = {};
      if (authType === 'header_token') {
        authConfig = { token };
      } else if (authType === 'basic_auth') {
        authConfig = { username, password };
      }
      const data = await createWorkflowWebhook(workflowId, {
        name: name.trim(),
        http_method: httpMethod,
        auth_type: authType,
        auth_config: authConfig,
        response_mode: responseMode,
      });
      setNotice(`已创建 Webhook：${data.webhook.name}`);
      setName('');
      setToken('');
      setUsername('');
      setPassword('');
      await loadAll();
    } catch (error) {
      setErrorText(normalizeError(error, '创建 Webhook 失败'));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (item: WorkflowWebhookItem) => {
    const url = resolveWebhookUrl(item);
    await navigator.clipboard.writeText(url);
    setCopiedId(item.webhook_id);
    setNotice('已复制 Webhook URL');
    window.setTimeout(() => setCopiedId(''), 1500);
  };

  const handleDelete = async (item: WorkflowWebhookItem) => {
    await deleteWorkflowWebhook(workflowId, item.webhook_id);
    setNotice(`已删除 Webhook：${item.name}`);
    await loadAll();
  };

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="rounded-[28px] border p-5" style={{ background: 'linear-gradient(180deg, rgba(19,34,56,0.98), rgba(12,22,37,0.98))', borderColor: BORDER }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-cyan-300">Webhook Triggers</div>
              <h1 className="mt-2 text-2xl font-semibold text-white">{workflow?.name || workflowId}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-300">为工作流生成专属外部触发 URL，支持公开调用、Header Token 和 Basic Auth 三种模式。</p>
            </div>
            <button
              type="button"
              onClick={() => void loadAll().catch((error) => setErrorText(normalizeError(error, 'Webhook 列表加载失败')))}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600/80 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Webhook 数" value={String(summary.total)} />
            <Metric label="累计触发" value={String(summary.triggered)} />
            <Metric label="激活中" value={String(summary.active)} />
          </div>

          <div className="mt-5 space-y-3">
            <Field label="名称">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                placeholder="例如：来自 CRM 的线索推送"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="HTTP 方法">
                <select value={httpMethod} onChange={(event) => setHttpMethod(event.target.value as 'POST' | 'GET' | 'ANY')} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                  <option value="ANY">ANY</option>
                </select>
              </Field>

              <Field label="响应模式">
                <select value={responseMode} onChange={(event) => setResponseMode(event.target.value as 'immediate' | 'wait_for_completion')} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
                  <option value="immediate">立即响应</option>
                  <option value="wait_for_completion">等待执行完成</option>
                </select>
              </Field>
            </div>

            <Field label="认证方式">
              <select value={authType} onChange={(event) => setAuthType(event.target.value as 'none' | 'header_token' | 'basic_auth')} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
                <option value="none">无需认证</option>
                <option value="header_token">Header Token</option>
                <option value="basic_auth">Basic Auth</option>
              </select>
            </Field>

            {authType === 'header_token' ? (
              <Field label="Token">
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                  placeholder="X-Webhook-Token"
                />
              </Field>
            ) : null}

            {authType === 'basic_auth' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="用户名">
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                  />
                </Field>
                <Field label="密码">
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                  />
                </Field>
              </div>
            ) : null}

            {notice ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{notice}</div> : null}
            {errorText ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{errorText}</div> : null}

            <button type="button" onClick={() => void handleCreate()} disabled={busy || !name.trim()} className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60">
              <Webhook className="h-4 w-4" />
              {busy ? '创建中...' : '创建 Webhook'}
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Link href={`/operations/workflows/${encodeURIComponent(workflowId)}/executions`} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/70">
              执行历史
            </Link>
            <Link href={`/operations/workflows/${encodeURIComponent(workflowId)}/edit`} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/70">
              编辑配置
            </Link>
          </div>

          <div className="grid gap-4">
            {items.map((item) => (
              <article key={item.webhook_id} className="rounded-[24px] border border-slate-700 bg-[#1c2940] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{item.name}</div>
                    <div className="mt-1 text-xs text-slate-400">{item.webhook_id}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200">{item.http_method}</span>
                    <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">{item.response_mode}</span>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-700/60 bg-black/20 px-3 py-2 break-all text-sm text-slate-200">
                  {resolveWebhookUrl(item)}
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                  <span>认证方式: {item.auth_type}</span>
                  <span>触发次数: {item.trigger_count}</span>
                  <span>上次触发: {formatDateTime(item.last_triggered_at)}</span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void handleCopy(item)} className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/10">
                    <Copy className="h-4 w-4" />
                    {copiedId === item.webhook_id ? '已复制' : '复制 URL'}
                  </button>
                  <DangerActionGuard
                    trigger={<button type="button" className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/10">删除</button>}
                    title={`删除 Webhook：${item.name}`}
                    description="删除后外部系统再调用该 URL 将直接失败，请先确认上游系统已完成切换。"
                    confirmText="DELETE"
                    confirmLabel="删除"
                    successMessage={`已删除 Webhook：${item.name}`}
                    onConfirm={() => handleDelete(item)}
                  />
                </div>
              </article>
            ))}
            {!items.length ? (
              <div className="rounded-[24px] border border-slate-700 bg-[#1c2940] p-6 text-sm text-slate-400">当前还没有配置任何 Webhook。</div>
            ) : null}
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
