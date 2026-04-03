'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, PlusCircle, Save, Search, Trash2, Wrench } from 'lucide-react';
import {
  fetchIntegrations,
  sendTestWebhook,
  testPluginAdapter,
  updateIntegrations,
} from '@/services/endpoints/integrations';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import type {
  CapabilityRouteMode,
  IntegrationCapability,
  PluginAdapterConfig,
  TenantIntegrations,
  TenantPluginHub,
} from '@/types/integrations';

const BORDER = 'rgba(71,85,105,0.45)';
const MUTED = '#94A3B8';
const TITLE = '#F8FAFC';
const ACCENT = '#22D3EE';

const CAPABILITIES: IntegrationCapability[] = [
  'llm.chat',
  'llm.reasoning',
  'audio.tts',
  'audio.asr',
  'voice.call',
  'webhook.lead_capture',
  'storage.object',
  'proxy.routing',
  'crm.push',
  'workflow.automation',
  'mcp.tools',
];

const MODE_OPTIONS: CapabilityRouteMode[] = ['auto', 'force', 'fallback'];

type TemplateItem = {
  id: string;
  displayName: string;
  provider: string;
  capabilities: IntegrationCapability[];
  authType: 'none' | 'api_key' | 'bearer' | 'basic';
  defaultBaseUrl?: string;
  defaultModel?: string;
};

const TEMPLATE_MARKET: TemplateItem[] = [
  { id: 'openai', displayName: 'OpenAI', provider: 'openai', capabilities: ['llm.chat', 'llm.reasoning'], authType: 'bearer', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { id: 'deepseek', displayName: 'DeepSeek', provider: 'deepseek', capabilities: ['llm.chat', 'llm.reasoning'], authType: 'bearer', defaultBaseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  { id: 'dashscope', displayName: 'DashScope', provider: 'dashscope', capabilities: ['llm.chat', 'llm.reasoning'], authType: 'bearer', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
  { id: 'n8n', displayName: 'n8n Automations', provider: 'n8n', capabilities: ['workflow.automation', 'webhook.lead_capture', 'crm.push'], authType: 'none' },
  { id: 'mcp_gateway', displayName: 'MCP Gateway', provider: 'mcp_gateway', capabilities: ['mcp.tools'], authType: 'bearer' },
  { id: 'aliyun_oss', displayName: 'Aliyun OSS', provider: 'aliyun_oss', capabilities: ['storage.object'], authType: 'api_key' },
  { id: 'lead_webhook', displayName: 'Lead Webhook', provider: 'webhook', capabilities: ['webhook.lead_capture', 'crm.push'], authType: 'none' },
];

const emptyHub: TenantPluginHub = {
  adapters: [],
  routing: {},
  updatedAt: new Date().toISOString(),
};

function safeHub(integrations: TenantIntegrations): TenantPluginHub {
  return {
    adapters: integrations.plugin_hub?.adapters ?? [],
    routing: integrations.plugin_hub?.routing ?? {},
    updatedAt: integrations.plugin_hub?.updatedAt ?? new Date().toISOString(),
  };
}

function newAdapterFromTemplate(template: TemplateItem): PluginAdapterConfig {
  return {
    id: template.id,
    provider: template.provider,
    displayName: template.displayName,
    enabled: true,
    capabilities: template.capabilities,
    authType: template.authType,
    baseUrl: template.defaultBaseUrl,
    model: template.defaultModel,
    apiKey: '',
    health: { status: 'unknown' },
  };
}

function capabilityAlias(capability: IntegrationCapability) {
  switch (capability) {
    case 'llm.chat':
      return '对话模型';
    case 'llm.reasoning':
      return '推理模型';
    case 'audio.tts':
      return '语音合成';
    case 'audio.asr':
      return '语音识别';
    case 'voice.call':
      return '语音外呼';
    case 'webhook.lead_capture':
      return '线索 Webhook';
    case 'storage.object':
      return '对象存储';
    case 'proxy.routing':
      return '代理路由';
    case 'crm.push':
      return 'CRM 回推';
    case 'workflow.automation':
      return '自动化工作流';
    case 'mcp.tools':
      return 'MCP 工具';
    default:
      return capability;
  }
}

function routeModeLabel(mode: CapabilityRouteMode): string {
  switch (mode) {
    case 'auto':
      return '自动';
    case 'force':
      return '强制';
    case 'fallback':
      return '兜底';
    default:
      return mode;
  }
}

function healthStatusLabel(status?: string): string {
  switch (status) {
    case 'healthy':
      return '健康';
    case 'degraded':
      return '降级';
    case 'unknown':
    default:
      return '待确认';
  }
}

export default function IntegrationsListPage() {
  const queryClient = useQueryClient();
  const [editingAdapterId, setEditingAdapterId] = useState<string | null>(null);
  const [editingCapability, setEditingCapability] = useState<IntegrationCapability | null>(null);
  const [search, setSearch] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [localHub, setLocalHub] = useState<TenantPluginHub>(emptyHub);
  const [saveLoading, setSaveLoading] = useState<Record<string, boolean>>({});
  const [testLoading, setTestLoading] = useState<Record<string, boolean>>({});
  const [webhookSending, setWebhookSending] = useState(false);

  const { data: integrations = {} as TenantIntegrations, isLoading } = useQuery({
    queryKey: ['tenant', 'integrations'],
    queryFn: fetchIntegrations,
  });

  useEffect(() => {
    setLocalHub(safeHub(integrations));
  }, [integrations]);

  const patchMutation = useMutation({
    mutationFn: (payload: Partial<TenantIntegrations>) => updateIntegrations(payload),
    onSuccess: (next) => {
      queryClient.setQueryData(['tenant', 'integrations'], next);
      triggerSuccessToast('已保存集成配置');
    },
    onError: () => triggerErrorToast('保存失败，请稍后重试'),
  });

  const coverageRate = useMemo(() => {
    const enabled = localHub.adapters.filter((item) => item.enabled);
    const unique = new Set(enabled.flatMap((item) => item.capabilities ?? []));
    return Math.round((unique.size / CAPABILITIES.length) * 100);
  }, [localHub.adapters]);

  const adapterOptions = useMemo(
    () => localHub.adapters.map((item) => ({ id: item.id, name: item.displayName || item.id })),
    [localHub.adapters],
  );

  const filteredTemplates = useMemo(() => {
    const key = templateSearch.trim().toLowerCase();
    if (!key) return TEMPLATE_MARKET;
    return TEMPLATE_MARKET.filter((item) =>
      [item.displayName, item.provider, ...(item.capabilities ?? [])].join(' ').toLowerCase().includes(key),
    );
  }, [templateSearch]);

  const filteredAdapters = useMemo(() => {
    const key = search.trim().toLowerCase();
    if (!key) return localHub.adapters;
    return localHub.adapters.filter((item) =>
      [item.displayName, item.provider, item.id, ...(item.capabilities ?? [])].join(' ').toLowerCase().includes(key),
    );
  }, [search, localHub.adapters]);

  const persistHub = async (nextHub: TenantPluginHub) => {
    await patchMutation.mutateAsync({
      plugin_hub: {
        adapters: nextHub.adapters,
        routing: nextHub.routing,
        updatedAt: new Date().toISOString(),
      },
    });
  };

  const updateAdapter = (adapterId: string, patch: Partial<PluginAdapterConfig>) => {
    setLocalHub((prev) => ({
      ...prev,
      adapters: prev.adapters.map((item) => (item.id === adapterId ? { ...item, ...patch } : item)),
    }));
  };

  const handleInstallTemplate = (template: TemplateItem) => {
    setLocalHub((prev) => {
      const exists = prev.adapters.find((item) => item.id === template.id);
      if (exists) {
        setEditingAdapterId(template.id);
        return prev;
      }
      return { ...prev, adapters: [...prev.adapters, newAdapterFromTemplate(template)] };
    });
    setEditingAdapterId(template.id);
  };

  const handleSaveAdapter = async (adapterId: string) => {
    setSaveLoading((prev) => ({ ...prev, [adapterId]: true }));
    try {
      await persistHub(localHub);
      setEditingAdapterId(null);
    } finally {
      setSaveLoading((prev) => ({ ...prev, [adapterId]: false }));
    }
  };

  const handleDeleteAdapter = async (adapterId: string) => {
    const nextHub: TenantPluginHub = {
      ...localHub,
      adapters: localHub.adapters.filter((item) => item.id !== adapterId),
    };
    setLocalHub(nextHub);
    await persistHub(nextHub);
  };

  const handleTestAdapter = async (adapter: PluginAdapterConfig) => {
    setTestLoading((prev) => ({ ...prev, [adapter.id]: true }));
    try {
      const res = await testPluginAdapter(adapter);
      if (res.code === 0 && res.data?.ok) {
        triggerSuccessToast(`${adapter.displayName || adapter.id} 测试成功`);
      } else {
        triggerErrorToast(res.data?.reason || res.message || '测试失败');
      }
    } finally {
      setTestLoading((prev) => ({ ...prev, [adapter.id]: false }));
    }
  };

  const updateRouting = (
    capability: IntegrationCapability,
    patch: Partial<{ mode: CapabilityRouteMode; primaryAdapterId: string; fallbackAdapterIds: string[] }>,
  ) => {
    setLocalHub((prev) => {
      const current = prev.routing[capability] || { mode: 'auto' as CapabilityRouteMode };
      return {
        ...prev,
        routing: {
          ...prev.routing,
          [capability]: {
            ...current,
            ...patch,
          },
        },
      };
    });
  };

  const saveRouting = async () => {
    await persistHub(localHub);
  };

  const sendWebhookPayload = async () => {
    setWebhookSending(true);
    try {
      const res = await sendTestWebhook();
      if (res.code === 0) triggerSuccessToast('测试线索已发送');
      else triggerErrorToast(res.message || '发送失败');
    } finally {
      setWebhookSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Wrench className="h-4 w-4" />
              集成中心
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-5xl">统一管理模型、存储、Webhook 和自动化适配器</h1>
            <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">
              这里不是旧式配置页集合，而是一张完整的接入面板：装什么、测什么、哪些能力走哪条路，都在同一页完成。
            </p>
            <p className="mt-3 text-sm font-semibold text-cyan-200">能力覆盖率：{coverageRate}%</p>
          </div>
          <Link href="/" className="rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-amber-200">
            返回控制台首页
          </Link>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">模板市场</h2>
          <label className="relative block w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 py-2 pl-9 pr-3 text-sm text-white"
              placeholder="搜索模板"
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
            />
          </label>
        </div>

        <div className="space-y-2">
          {filteredTemplates.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-white">{item.displayName}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {item.provider} · {item.capabilities.map((cap) => capabilityAlias(cap)).join(' / ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleInstallTemplate(item)}
                className="inline-flex items-center gap-1 rounded-2xl border border-amber-400/40 px-3 py-2 text-sm text-amber-200"
              >
                <PlusCircle className="h-4 w-4" />
                安装
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">已安装适配器</h2>
          <label className="relative block w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 py-2 pl-9 pr-3 text-sm text-white"
              placeholder="搜索适配器"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-400">加载中...</p>
        ) : filteredAdapters.length === 0 ? (
          <p className="text-sm text-slate-400">当前还没有适配器，先从上方模板市场安装。</p>
        ) : (
          <div className="space-y-2">
            {filteredAdapters.map((adapter) => {
              const expanded = editingAdapterId === adapter.id;
              return (
                <div key={adapter.id} className="rounded-2xl border border-white/10 bg-slate-950/45">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                    onClick={() => setEditingAdapterId(expanded ? null : adapter.id)}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {adapter.displayName || adapter.id}
                        <span className="ml-2 text-xs font-normal text-slate-500">({adapter.provider})</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {adapter.enabled ? '已启用' : '未启用'} · {(adapter.capabilities || []).map((cap) => capabilityAlias(cap)).join(' / ')} · {healthStatusLabel(adapter.health?.status)}
                      </div>
                    </div>
                    {expanded ? <ChevronUp className="h-4 w-4 text-slate-300" /> : <ChevronDown className="h-4 w-4 text-slate-300" />}
                  </button>

                  {expanded && (
                    <div className="space-y-3 border-t border-white/10 px-4 pb-4 pt-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-sm text-slate-400">
                          显示名称
                          <input
                            className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white"
                            value={adapter.displayName}
                            onChange={(e) => updateAdapter(adapter.id, { displayName: e.target.value })}
                          />
                        </label>
                        <label className="text-sm text-slate-400">
                          服务商标识
                          <input
                            className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white"
                            value={adapter.provider}
                            onChange={(e) => updateAdapter(adapter.id, { provider: e.target.value })}
                          />
                        </label>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-sm text-slate-400">
                          接口地址
                          <input
                            className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white"
                            value={adapter.baseUrl || ''}
                            onChange={(e) => updateAdapter(adapter.id, { baseUrl: e.target.value })}
                          />
                        </label>
                        <label className="text-sm text-slate-400">
                          默认模型
                          <input
                            className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white"
                            value={adapter.model || ''}
                            onChange={(e) => updateAdapter(adapter.id, { model: e.target.value })}
                          />
                        </label>
                      </div>

                      <label className="text-sm text-slate-400">
                        访问密钥（留空则不更新）
                        <input
                          type="password"
                          className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white"
                          value={adapter.apiKey || ''}
                          onChange={(e) => updateAdapter(adapter.id, { apiKey: e.target.value })}
                        />
                      </label>

                      <div className="flex flex-wrap gap-2">
                        {CAPABILITIES.map((cap) => {
                          const active = (adapter.capabilities || []).includes(cap);
                          return (
                            <button
                              key={cap}
                              type="button"
                              onClick={() => {
                                const next = active
                                  ? (adapter.capabilities || []).filter((item) => item !== cap)
                                  : [...(adapter.capabilities || []), cap];
                                updateAdapter(adapter.id, { capabilities: next });
                              }}
                              className="rounded-full border px-2 py-1 text-xs"
                              style={{
                                borderColor: active ? ACCENT : BORDER,
                                color: active ? '#67E8F9' : MUTED,
                                backgroundColor: active ? 'rgba(34,211,238,0.16)' : 'transparent',
                              }}
                            >
                              {capabilityAlias(cap)}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-2 text-sm text-slate-400">
                          <input
                            type="checkbox"
                            checked={adapter.enabled}
                            onChange={(e) => updateAdapter(adapter.id, { enabled: e.target.checked })}
                          />
                          启用
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleTestAdapter(adapter)}
                            className="rounded-2xl border border-cyan-400/40 px-3 py-2 text-sm text-cyan-200"
                            disabled={!!testLoading[adapter.id]}
                          >
                            {testLoading[adapter.id] ? '测试中...' : '测试'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSaveAdapter(adapter.id)}
                            className="inline-flex items-center gap-1 rounded-2xl border border-amber-400/40 px-3 py-2 text-sm text-amber-200"
                            disabled={!!saveLoading[adapter.id]}
                          >
                            <Save className="h-4 w-4" />
                            {saveLoading[adapter.id] ? '保存中...' : '保存'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteAdapter(adapter.id)}
                            className="inline-flex items-center gap-1 rounded-2xl border border-rose-500/40 px-3 py-2 text-sm text-rose-200"
                          >
                            <Trash2 className="h-4 w-4" />
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">能力路由</h2>
          <button
            type="button"
            onClick={() => void saveRouting()}
            className="inline-flex items-center gap-1 rounded-2xl border border-amber-400/40 px-3 py-2 text-sm text-amber-200"
          >
            <Save className="h-4 w-4" />
            保存全部
          </button>
        </div>
        <div className="space-y-2">
          {CAPABILITIES.map((capability) => {
            const row = localHub.routing[capability] || { mode: 'auto' as CapabilityRouteMode };
            const expanded = editingCapability === capability;
            const primaryLabel = row.primaryAdapterId
              ? adapterOptions.find((item) => item.id === row.primaryAdapterId)?.name || row.primaryAdapterId
              : '未设置';
            return (
              <div key={capability} className="rounded-2xl border border-white/10 bg-slate-950/45">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                  onClick={() => setEditingCapability(expanded ? null : capability)}
                >
                  <div>
                    <div className="text-sm font-semibold text-white">{capabilityAlias(capability)}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      模式 {routeModeLabel(row.mode)} · 主适配器 {primaryLabel}
                      {row.fallbackAdapterIds?.length ? ` · 兜底 ${row.fallbackAdapterIds.join(', ')}` : ' · 未设置兜底'}
                    </div>
                  </div>
                  {expanded ? <ChevronUp className="h-4 w-4 text-slate-300" /> : <ChevronDown className="h-4 w-4 text-slate-300" />}
                </button>
                {expanded && (
                  <div className="space-y-3 border-t border-white/10 px-4 pb-4 pt-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-sm text-slate-400">
                        路由模式
                        <select
                          className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-2 py-2 text-sm text-white"
                          value={row.mode}
                          onChange={(e) => updateRouting(capability, { mode: e.target.value as CapabilityRouteMode })}
                        >
                          {MODE_OPTIONS.map((mode) => (
                            <option key={mode} value={mode}>
                              {routeModeLabel(mode)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm text-slate-400">
                        主适配器
                        <select
                          className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-2 py-2 text-sm text-white"
                          value={row.primaryAdapterId || ''}
                          onChange={(e) => updateRouting(capability, { primaryAdapterId: e.target.value || undefined })}
                        >
                          <option value="">未设置</option>
                          {adapterOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm text-slate-400">
                        兜底适配器（逗号分隔）
                        <input
                          className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-2 py-2 text-sm text-white"
                          placeholder="id1,id2"
                          value={(row.fallbackAdapterIds || []).join(',')}
                          onChange={(e) =>
                            updateRouting(capability, {
                              fallbackAdapterIds: e.target.value
                                .split(',')
                                .map((item) => item.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void saveRouting()}
                        className="inline-flex items-center gap-1 rounded-2xl border border-amber-400/40 px-3 py-2 text-sm text-amber-200"
                      >
                        <Save className="h-4 w-4" />
                        保存该项
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void sendWebhookPayload()}
            className="rounded-2xl border border-cyan-400/40 px-3 py-2 text-sm text-cyan-200"
            disabled={webhookSending}
          >
            {webhookSending ? '发送中...' : '发送测试线索'}
          </button>
        </div>
      </section>
    </div>
  );
}
