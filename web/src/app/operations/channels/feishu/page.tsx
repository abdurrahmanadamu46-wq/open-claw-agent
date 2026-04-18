'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessageSquare, RefreshCw, Save, Send } from 'lucide-react';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import { dispatchGroupCollab, fetchGroupCollabAdapters, type GroupCollabRecord } from '@/services/endpoints/group-collab';
import { fetchIntegrations, updateIntegrations } from '@/services/endpoints/integrations';
import type { GroupCollabAdapterConfig, TenantGroupCollabConfig, TenantIntegrations } from '@/types/integrations';

function normalizeError(error: unknown): string {
  const maybe = error as { response?: { data?: { message?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.message || '请求失败';
}

function upsertFeishuAdapter(config: TenantGroupCollabConfig, patch: Partial<GroupCollabAdapterConfig>): TenantGroupCollabConfig {
  const adapters = [...(config.adapters || [])];
  const index = adapters.findIndex((item) => item.id === 'feishu-default');
  const defaultCapabilities: GroupCollabAdapterConfig['capabilities'] = ['message', 'report', 'approval', 'confirmation', 'reminder'];
  const current: GroupCollabAdapterConfig = index >= 0
    ? adapters[index]
    : {
      id: 'feishu-default',
      label: 'Feishu Group Bot',
      provider: 'feishu' as const,
      enabled: false,
      mode: 'live' as const,
      capabilities: defaultCapabilities,
    };
  const next = {
    ...current,
    ...patch,
    id: 'feishu-default',
    provider: 'feishu' as const,
    mode: 'live' as const,
    capabilities: current.capabilities ?? defaultCapabilities,
  };
  if (index >= 0) {
    adapters[index] = next;
  } else {
    adapters.push(next);
  }
  return {
    ...config,
    adapters,
    defaultAdapterId: next.enabled ? next.id : config.defaultAdapterId,
    provider: next.enabled ? 'feishu' : config.provider,
  };
}

export default function FeishuWebhookPage() {
  const queryClient = useQueryClient();
  const integrationsQuery = useQuery({
    queryKey: ['integrations', 'tenant'],
    queryFn: fetchIntegrations,
    staleTime: 60 * 1000,
  });
  const adaptersQuery = useQuery({
    queryKey: ['collab', 'adapters'],
    queryFn: fetchGroupCollabAdapters,
    staleTime: 60 * 1000,
  });

  const [enabled, setEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [defaultTargetName, setDefaultTargetName] = useState('');
  const [defaultChatId, setDefaultChatId] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [lastRecord, setLastRecord] = useState<GroupCollabRecord | null>(null);

  useEffect(() => {
    if (initialized) return;
    const groupCollab = integrationsQuery.data?.group_collab;
    const adapter = groupCollab?.adapters?.find((item) => item.id === 'feishu-default');
    if (!groupCollab || !adapter) return;
    setEnabled(!!adapter.enabled);
    setWebhookUrl(adapter.webhookUrl || '');
    setSecret(adapter.secret || '');
    setDefaultTargetName(adapter.defaultTargetName || '');
    setDefaultChatId(adapter.defaultChatId || '');
    setInitialized(true);
  }, [initialized, integrationsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const integrations = integrationsQuery.data as TenantIntegrations | undefined;
      const groupCollab = integrations?.group_collab;
      if (!groupCollab) {
        throw new Error('group_collab config is missing');
      }
      return updateIntegrations({
        group_collab: upsertFeishuAdapter(groupCollab, {
          enabled,
          webhookUrl: webhookUrl.trim() || undefined,
          secret: secret.trim() || undefined,
          defaultTargetName: defaultTargetName.trim() || undefined,
          defaultChatId: defaultChatId.trim() || undefined,
        }),
      });
    },
    onSuccess: async () => {
      triggerSuccessToast('Feishu 群协作配置已保存');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations', 'tenant'] }),
        queryClient.invalidateQueries({ queryKey: ['collab', 'adapters'] }),
        queryClient.invalidateQueries({ queryKey: ['collab', 'summary'] }),
      ]);
    },
    onError: (error) => {
      triggerErrorToast(normalizeError(error));
    },
  });

  const testMutation = useMutation({
    mutationFn: () => dispatchGroupCollab({
      objectType: 'report',
      title: 'Feishu live 测试播报',
      summary: '这条消息用于验证 Feishu group collab adapter 最小真实链路。',
      body: '如果你在 Feishu 群里看到了这条测试播报，说明前端 -> NestJS 控制面 -> Feishu adapter 的最小真实链路已经打通。',
      adapterId: 'feishu-default',
      deliveryMode: 'live',
      tags: ['feishu', 'live-test'],
      target: {
        chatId: defaultChatId.trim() || undefined,
        targetName: defaultTargetName.trim() || undefined,
      },
    }),
    onSuccess: async (result) => {
      setLastRecord(result.record);
      triggerSuccessToast(result.fallbackUsed ? '当前仍走回退链路，请检查 Feishu 配置' : 'Feishu live 测试已发出');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['collab', 'summary'] }),
        queryClient.invalidateQueries({ queryKey: ['collab', 'adapters'] }),
      ]);
    },
    onError: (error) => {
      triggerErrorToast(normalizeError(error));
    },
  });

  const feishuAdapter = adaptersQuery.data?.find((item) => item.id === 'feishu-default');

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 text-slate-100">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
          <MessageSquare className="h-4 w-4" />
          Feishu Group Collab
        </div>
        <h1 className="mt-4 text-3xl font-semibold text-white">把 Feishu 接到统一群协作 adapter，而不是单页自拼 webhook</h1>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          这页保存的是 `group_collab.adapters.feishu-default`。前端不再直接碰 Python 或第三方接口，所有播报、审批、确认、催办都先过 NestJS 控制面。
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="text-lg font-semibold text-white">Feishu live 配置</div>
          <div className="mt-4 space-y-4">
            <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-white">启用 live adapter</div>
                <div className="mt-1 text-xs text-slate-400">关闭后依然能走 mock adapter，方便前端联调。</div>
              </div>
              <button
                type="button"
                onClick={() => setEnabled((value) => !value)}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition"
                style={{ backgroundColor: enabled ? '#22d3ee' : 'rgba(71,85,105,0.7)' }}
              >
                <span
                  className="inline-block h-4 w-4 rounded-full bg-white transition"
                  style={{ transform: enabled ? 'translateX(24px)' : 'translateX(4px)' }}
                />
              </button>
            </label>

            <Field label="Webhook URL" value={webhookUrl} onChange={setWebhookUrl} placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
            <Field label="Secret（可选）" value={secret} onChange={setSecret} placeholder="留作后续加签与配置审计" />
            <Field label="默认群名称" value={defaultTargetName} onChange={setDefaultTargetName} placeholder="例如：客户运营群" />
            <Field label="默认 Chat ID（可选）" value={defaultChatId} onChange={setDefaultChatId} placeholder="例如：oc_xxx" />

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/15 disabled:opacity-60"
              >
                {saveMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存配置
              </button>
              <button
                type="button"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-60"
              >
                {testMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                发送 live 测试
              </button>
            </div>
          </div>
        </article>

        <article className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
            <div className="text-lg font-semibold text-white">当前 adapter 状态</div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{feishuAdapter?.label || 'Feishu Group Bot'}</div>
                  <div className="mt-1 text-xs text-slate-400">provider: feishu · mode: live</div>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs ${
                  feishuAdapter?.health === 'ready'
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                    : feishuAdapter?.health === 'needs_config'
                      ? 'border-amber-500/25 bg-amber-500/10 text-amber-100'
                      : 'border-white/10 bg-white/[0.04] text-slate-200'
                }`}>
                  {feishuAdapter?.health || 'unknown'}
                </span>
              </div>
              <div className="mt-3 text-sm text-slate-300">
                默认目标: {feishuAdapter?.defaultTargetName || feishuAdapter?.defaultChatId || '未设置'}
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
            <div className="text-lg font-semibold text-white">最近测试结果</div>
            {lastRecord ? (
              <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-100">
                  <CheckCircle2 className="h-4 w-4" />
                  {lastRecord.title}
                </div>
                <div className="mt-2 text-sm leading-6 text-emerald-50/90">{lastRecord.summary}</div>
                <div className="mt-3 text-xs text-emerald-100/80">
                  status: {lastRecord.status} · trace: {lastRecord.traceId}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                还没有发送 live 测试消息。
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
              最小真实链路定义：
              前端调用 `api/v1/collab/dispatch`，NestJS 解析统一对象模型，命中 `feishu-default` adapter，
              成功后写入一条群协作记录和一条 receipt 记录。
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm text-slate-300">{label}</div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
      />
    </label>
  );
}
