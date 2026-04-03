'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Pencil, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { DangerActionGuard } from '@/components/DangerActionGuard';
import {
  createProvider,
  deleteProviderConfig,
  fetchAiLlmAgentBindings,
  fetchAiLlmModelCatalog,
  fetchAiLlmProviderConfigs,
  fetchProviders,
  reloadProviderConfig,
  smokeProviderConfig,
  updateAiLlmAgentBinding,
  updateProviderConfig,
  type LlmAgentBindingRow,
  type LlmProviderConfigRow,
} from '@/services/endpoints/ai-subservice';
import type { ProviderConfig } from '@/types/provider-registry';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';

const BORDER = 'rgba(71,85,105,0.35)';

type ProviderFormState = {
  name: string;
  type: 'openai_compatible' | 'anthropic' | 'gemini' | 'local';
  enabled: boolean;
  route: 'local' | 'cloud';
  base_url: string;
  default_model: string;
  models_text: string;
  api_key: string;
  note: string;
  priority: number;
  weight: number;
};

type ProviderCatalogItem = {
  provider_id: string;
  label?: string;
  route: 'local' | 'cloud';
  base_url: string;
  default_model: string;
  model_options?: string[];
};

const EMPTY_CREATE_FORM: ProviderFormState & { id: string } = {
  id: '',
  name: '',
  type: 'openai_compatible',
  enabled: true,
  route: 'cloud',
  base_url: '',
  default_model: '',
  models_text: '',
  api_key: '',
  note: '',
  priority: 100,
  weight: 1,
};

function routeLabel(route: 'local' | 'cloud'): string {
  return route === 'local' ? '本地优先' : '云端兜底';
}

function typeLabel(type: ProviderConfig['type']): string {
  switch (type) {
    case 'local':
      return '本地';
    case 'anthropic':
      return 'Anthropic';
    case 'gemini':
      return 'Gemini';
    default:
      return 'OpenAI 兼容';
  }
}

function statusLabel(status: ProviderConfig['status']): string {
  switch (status) {
    case 'healthy':
      return '健康';
    case 'degraded':
      return '降级';
    default:
      return '离线';
  }
}

function statusTone(status: ProviderConfig['status']): string {
  switch (status) {
    case 'healthy':
      return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100';
    case 'degraded':
      return 'border-amber-400/25 bg-amber-400/10 text-amber-100';
    default:
      return 'border-rose-400/25 bg-rose-400/10 text-rose-100';
  }
}

function providerSummary(provider: ProviderConfig): string {
  return provider.enabled
    ? `${statusLabel(provider.status)} · ${provider.default_model || '未设置模型'}`
    : '已禁用';
}

function toModelsArray(input: string, fallbackModel: string): string[] {
  const normalized = input
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (fallbackModel && !normalized.includes(fallbackModel)) {
    normalized.unshift(fallbackModel);
  }
  return normalized;
}

export default function ModelProvidersSettingsPage() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [bindingProviders, setBindingProviders] = useState<LlmProviderConfigRow[]>([]);
  const [providerForms, setProviderForms] = useState<Record<string, ProviderFormState>>({});
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [providerCatalog, setProviderCatalog] = useState<Record<string, ProviderCatalogItem>>({});
  const [hotModels, setHotModels] = useState<string[]>([]);
  const [bindings, setBindings] = useState<Record<string, LlmAgentBindingRow>>({});
  const [loading, setLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [savingProvider, setSavingProvider] = useState<Record<string, boolean>>({});
  const [savingBinding, setSavingBinding] = useState<Record<string, boolean>>({});
  const [busyProviderAction, setBusyProviderAction] = useState<Record<string, string>>({});
  const [creatingProvider, setCreatingProvider] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);

  const providerOptions = useMemo(
    () =>
      bindingProviders
        .filter((provider) => provider.enabled)
        .map((provider) => ({
          value: provider.provider_id,
          label: `${provider.label || provider.provider_id} · ${provider.default_model || '未设置模型'}`,
        })),
    [bindingProviders],
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const [providerRes, bindingProviderRes, bindingRes, catalogRes] = await Promise.all([
        fetchProviders(),
        fetchAiLlmProviderConfigs(),
        fetchAiLlmAgentBindings(),
        fetchAiLlmModelCatalog().catch(() => null),
      ]);

      const providerRows = providerRes.providers ?? [];
      const tenantProviderRows = bindingProviderRes.providers ?? [];
      const bindingRows = bindingRes.bindings ?? [];
      const catalogProviders = catalogRes?.catalog?.providers ?? [];
      const catalogMap: Record<string, ProviderCatalogItem> = {};

      catalogProviders.forEach((item) => {
        catalogMap[item.provider_id] = item;
      });

      const formMap: Record<string, ProviderFormState> = {};
      providerRows.forEach((provider) => {
        const fromCatalog = catalogMap[provider.id];
        formMap[provider.id] = {
          name: provider.name,
          type: provider.type,
          enabled: provider.enabled,
          route: provider.route,
          base_url: provider.base_url || fromCatalog?.base_url || '',
          default_model: provider.default_model || fromCatalog?.default_model || '',
          models_text: (provider.models ?? []).join(', '),
          api_key: '',
          note: provider.note || '',
          priority: provider.priority ?? 100,
          weight: provider.weight ?? 1,
        };
      });

      const bindingMap: Record<string, LlmAgentBindingRow> = {};
      bindingRows.forEach((row) => {
        bindingMap[row.agent_id] = row;
      });

      setProviders(providerRows);
      setBindingProviders(tenantProviderRows);
      setProviderForms(formMap);
      setProviderCatalog(catalogMap);
      setHotModels(catalogRes?.catalog?.hot_models ?? []);
      setBindings(bindingMap);
      setSyncMessage('Provider 热重载注册表与龙虾绑定信息已同步。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取失败';
      setSyncMessage(`同步失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onProviderFieldChange = <K extends keyof ProviderFormState>(
    providerId: string,
    key: K,
    value: ProviderFormState[K],
  ) => {
    setProviderForms((prev) => ({
      ...prev,
      [providerId]: {
        ...(prev[providerId] || {
          name: providerId,
          type: 'openai_compatible',
          enabled: true,
          route: 'cloud',
          base_url: '',
          default_model: '',
          models_text: '',
          api_key: '',
          note: '',
          priority: 100,
          weight: 1,
        }),
        [key]: value,
      },
    }));
  };

  const saveProvider = async (providerId: string) => {
    const row = providerForms[providerId];
    if (!row) return;

    setSavingProvider((prev) => ({ ...prev, [providerId]: true }));
    try {
      const models = toModelsArray(row.models_text, row.default_model.trim());
      await updateProviderConfig(providerId, {
        name: row.name.trim(),
        type: row.type,
        enabled: row.enabled,
        route: row.route,
        base_url: row.base_url.trim(),
        default_model: row.default_model.trim(),
        models,
        api_key: row.api_key.trim() || null,
        note: row.note.trim(),
        priority: row.priority,
        weight: row.weight,
      });
      setSyncMessage(`已热更新 ${providerId}，新请求会立即使用新配置。`);
      await refresh();
      setEditingProviderId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败';
      setSyncMessage(`保存 ${providerId} 失败：${message}`);
    } finally {
      setSavingProvider((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const createNewProvider = async () => {
    if (!createForm.id.trim() || !createForm.name.trim()) {
      setSyncMessage('新增 Provider 需要填写 ID 和名称。');
      return;
    }
    setCreatingProvider(true);
    try {
      const models = toModelsArray(createForm.models_text, createForm.default_model.trim());
      await createProvider({
        id: createForm.id.trim(),
        name: createForm.name.trim(),
        type: createForm.type,
        route: createForm.route,
        base_url: createForm.base_url.trim(),
        default_model: createForm.default_model.trim(),
        models,
        api_key: createForm.api_key.trim() || null,
        priority: createForm.priority,
        weight: createForm.weight,
        enabled: createForm.enabled,
        note: createForm.note.trim(),
      });
      setCreateForm(EMPTY_CREATE_FORM);
      setSyncMessage('新 Provider 已注册并热生效，无需重启服务。');
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建失败';
      setSyncMessage(`新增 Provider 失败：${message}`);
    } finally {
      setCreatingProvider(false);
    }
  };

  const runProviderAction = async (providerId: string, action: 'reload' | 'smoke' | 'delete') => {
    setBusyProviderAction((prev) => ({ ...prev, [providerId]: action }));
    try {
      if (action === 'reload') {
        await reloadProviderConfig(providerId);
        setSyncMessage(`已重新加载 ${providerId} 的持久化配置。`);
      } else if (action === 'smoke') {
        const result = await smokeProviderConfig(providerId);
        setSyncMessage(
          result.ok
            ? `${providerId} 冒烟测试通过，耗时 ${result.latency_ms} ms。`
            : `${providerId} 冒烟测试失败：${result.error || '未知错误'}`,
        );
      } else {
        await deleteProviderConfig(providerId);
        setSyncMessage(`已删除 ${providerId}。`);
      }
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      setSyncMessage(`${providerId} ${action} 失败：${message}`);
    } finally {
      setBusyProviderAction((prev) => ({ ...prev, [providerId]: '' }));
    }
  };

  const saveBinding = async (agentId: string, patch: Partial<LlmAgentBindingRow>) => {
    const current = bindings[agentId];
    if (!current) return;

    const payload = {
      enabled: patch.enabled ?? current.enabled,
      task_type: (patch.task_type ?? current.task_type).trim(),
      provider_id: (patch.provider_id ?? current.provider_id).trim(),
      model_name: (patch.model_name ?? current.model_name).trim(),
      temperature: typeof patch.temperature === 'number' ? patch.temperature : current.temperature,
      max_tokens: typeof patch.max_tokens === 'number' ? patch.max_tokens : current.max_tokens,
      note: patch.note ?? current.note ?? '',
    };

    if (!payload.task_type || !payload.provider_id || !payload.model_name) {
      setSyncMessage(`岗位 ${agentId} 的绑定参数不完整。`);
      return;
    }

    setSavingBinding((prev) => ({ ...prev, [agentId]: true }));
    try {
      const updated = await updateAiLlmAgentBinding(agentId, payload);
      setBindings((prev) => ({ ...prev, [agentId]: updated.binding }));
      setSyncMessage(`已更新 ${agentId} 的模型绑定。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新失败';
      setSyncMessage(`更新 ${agentId} 失败：${message}`);
    } finally {
      setSavingBinding((prev) => ({ ...prev, [agentId]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="commercial"
        step="主线第 6 步 · 商业化支撑"
        title="模型服务商设置"
        description="这里已经升级为 Provider 热重载控制面。你可以直接新增、修改、删除或重载 LLM Provider，新请求立即吃到新配置，不需要重启服务。"
        previous={{ href: '/operations/autopilot/trace', label: '回到 Trace 复盘' }}
        next={{ href: '/settings/integrations', label: '前往集成中心' }}
        actions={
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新配置
          </button>
        }
      />

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="text-lg font-semibold text-white">Provider 热重载总览</div>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              注册表配置写入持久化文件，新的请求实时生效。上方看总体健康度，下方看每个 Provider 的模型、路由、权重和近 24 小时调用表现。
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {loading ? '正在同步配置...' : syncMessage || '配置已就绪'}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Provider 数量</div>
            <div className="mt-2 text-2xl font-semibold text-white">{providers.length}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">健康 Provider</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-100">
              {providers.filter((provider) => provider.status === 'healthy').length}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">降级 Provider</div>
            <div className="mt-2 text-2xl font-semibold text-amber-100">
              {providers.filter((provider) => provider.status === 'degraded').length}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">本地优先链路</div>
            <div className="mt-2 text-2xl font-semibold text-cyan-100">
              {providers.filter((provider) => provider.route === 'local').length}
            </div>
          </div>
        </div>

        {hotModels.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {hotModels.slice(0, 12).map((model) => (
              <span
                key={model}
                className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100"
              >
                {model}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
          <Plus className="h-4 w-4" />
          注册新 Provider
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-slate-200">
            Provider ID
            <input
              value={createForm.id}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, id: e.target.value }))}
              className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
              style={{ borderColor: BORDER }}
              placeholder="例如 openrouter-cn"
            />
          </label>

          <label className="text-sm text-slate-200">
            显示名称
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
              className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
              style={{ borderColor: BORDER }}
              placeholder="例如 OpenRouter 中国网关"
            />
          </label>

          <label className="text-sm text-slate-200">
            Provider 类型
            <select
              value={createForm.type}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, type: e.target.value as ProviderFormState['type'] }))}
              className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
              style={{ borderColor: BORDER }}
            >
              <option value="openai_compatible">OpenAI 兼容</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
              <option value="local">本地</option>
            </select>
          </label>

          <label className="text-sm text-slate-200">
            路由策略
            <select
              value={createForm.route}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, route: e.target.value as 'local' | 'cloud' }))}
              className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
              style={{ borderColor: BORDER }}
            >
              <option value="cloud">云端兜底</option>
              <option value="local">本地优先</option>
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-slate-200">
            Base URL
            <input
              value={createForm.base_url}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, base_url: e.target.value }))}
              className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
              style={{ borderColor: BORDER }}
              placeholder="例如 https://api.openai.com/v1"
            />
          </label>

          <label className="text-sm text-slate-200">
            默认模型
            <input
              value={createForm.default_model}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, default_model: e.target.value }))}
              className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
              style={{ borderColor: BORDER }}
              placeholder="例如 gpt-4o-mini"
            />
          </label>

          <label className="text-sm text-slate-200">
            模型列表（逗号分隔）
            <input
              value={createForm.models_text}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, models_text: e.target.value }))}
              className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
              style={{ borderColor: BORDER }}
              placeholder="gpt-4o-mini, gpt-4.1"
            />
          </label>

          <label className="text-sm text-slate-200">
            API Key
            <input
              value={createForm.api_key}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, api_key: e.target.value }))}
              className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
              style={{ borderColor: BORDER }}
              type="password"
              placeholder="sk-..."
            />
          </label>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <label className="text-sm text-slate-200">
            优先级
            <input
              type="number"
              value={createForm.priority}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, priority: Number(e.target.value || 0) }))}
              className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
              style={{ borderColor: BORDER }}
            />
          </label>
          <label className="text-sm text-slate-200">
            权重
            <input
              type="number"
              step="0.1"
              value={createForm.weight}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, weight: Number(e.target.value || 0) }))}
              className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
              style={{ borderColor: BORDER }}
            />
          </label>
          <label className="text-sm text-slate-200 md:col-span-2">
            备注
            <input
              value={createForm.note}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, note: e.target.value }))}
              className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
              style={{ borderColor: BORDER }}
              placeholder="例如：仅用于高风险审查任务"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={createForm.enabled}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            立即启用
          </label>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15"
            disabled={creatingProvider}
            onClick={() => void createNewProvider()}
          >
            <Plus size={14} />
            {creatingProvider ? '正在注册...' : '注册并热生效'}
          </button>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
          <Settings2 className="h-4 w-4" />
          Provider 列表
        </div>

        <div className="space-y-3">
          {providers.map((provider) => {
            const form = providerForms[provider.id];
            if (!form) return null;

            const isEditing = editingProviderId === provider.id;
            const catalog = providerCatalog[provider.id];
            const modelOptions = catalog?.model_options ?? [];
            const action = busyProviderAction[provider.id];

            return (
              <div
                key={provider.id}
                className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/45"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                  onClick={() => setEditingProviderId(isEditing ? null : provider.id)}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                      <span>{provider.name}</span>
                      <span className="text-xs text-slate-500">({provider.id})</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone(provider.status)}`}>
                        {statusLabel(provider.status)}
                      </span>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-300">
                        {typeLabel(provider.type)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                      <span>{providerSummary(provider)}</span>
                      <span>{routeLabel(form.route)}</span>
                      <span>成功率 {provider.success_rate_1h ?? 0}%</span>
                      <span>24h 调用 {provider.total_calls_24h ?? 0}</span>
                      <span>延迟 {provider.avg_latency_ms ?? 0} ms</span>
                    </div>
                  </div>
                  {isEditing ? <ChevronUp size={16} className="text-slate-300" /> : <ChevronDown size={16} className="text-slate-300" />}
                </button>

                {isEditing && (
                  <div className="space-y-4 border-t border-white/10 px-5 pb-5 pt-4">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <label className="text-sm text-slate-200">
                        显示名称
                        <input
                          value={form.name}
                          onChange={(e) => onProviderFieldChange(provider.id, 'name', e.target.value)}
                          className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          style={{ borderColor: BORDER }}
                        />
                      </label>

                      <label className="text-sm text-slate-200">
                        Provider 类型
                        <select
                          value={form.type}
                          onChange={(e) => onProviderFieldChange(provider.id, 'type', e.target.value as ProviderFormState['type'])}
                          className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          style={{ borderColor: BORDER }}
                        >
                          <option value="openai_compatible">OpenAI 兼容</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="gemini">Gemini</option>
                          <option value="local">本地</option>
                        </select>
                      </label>

                      <label className="text-sm text-slate-200">
                        路由策略
                        <select
                          value={form.route}
                          onChange={(e) => onProviderFieldChange(provider.id, 'route', e.target.value as 'local' | 'cloud')}
                          className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          style={{ borderColor: BORDER }}
                        >
                          <option value="local">本地优先</option>
                          <option value="cloud">云端兜底</option>
                        </select>
                      </label>

                      <label className="inline-flex items-center gap-2 self-end text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={form.enabled}
                          onChange={(e) => onProviderFieldChange(provider.id, 'enabled', e.target.checked)}
                        />
                        启用 Provider
                      </label>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="text-sm text-slate-200">
                        默认模型
                        <input
                          value={form.default_model}
                          onChange={(e) => onProviderFieldChange(provider.id, 'default_model', e.target.value)}
                          className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          style={{ borderColor: BORDER }}
                          placeholder="例如 deepseek-chat / gpt-4o-mini"
                        />
                      </label>

                      <label className="text-sm text-slate-200">
                        Base URL
                        <input
                          value={form.base_url}
                          onChange={(e) => onProviderFieldChange(provider.id, 'base_url', e.target.value)}
                          className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          style={{ borderColor: BORDER }}
                          placeholder="例如 https://api.deepseek.com/v1"
                        />
                      </label>
                    </div>

                    <label className="text-sm text-slate-200">
                      模型列表（逗号分隔）
                      <input
                        value={form.models_text}
                        onChange={(e) => onProviderFieldChange(provider.id, 'models_text', e.target.value)}
                        className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                        style={{ borderColor: BORDER }}
                        placeholder="deepseek-chat, deepseek-reasoner"
                      />
                    </label>

                    {modelOptions.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {modelOptions.slice(0, 10).map((model) => (
                          <button
                            key={model}
                            type="button"
                            className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:border-cyan-400/25 hover:text-cyan-100"
                            onClick={() => onProviderFieldChange(provider.id, 'default_model', model)}
                          >
                            {model}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-4">
                      <label className="text-sm text-slate-200">
                        优先级
                        <input
                          type="number"
                          value={form.priority}
                          onChange={(e) => onProviderFieldChange(provider.id, 'priority', Number(e.target.value || 0))}
                          className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          style={{ borderColor: BORDER }}
                        />
                      </label>

                      <label className="text-sm text-slate-200">
                        权重
                        <input
                          type="number"
                          step="0.1"
                          value={form.weight}
                          onChange={(e) => onProviderFieldChange(provider.id, 'weight', Number(e.target.value || 0))}
                          className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          style={{ borderColor: BORDER }}
                        />
                      </label>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                        Key 状态
                        <div className="mt-2 font-mono text-xs text-slate-100">
                          {provider.api_key_masked || '未配置'}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                        更新时间
                        <div className="mt-2 text-xs text-slate-100">{provider.updated_at || '-'}</div>
                      </div>
                    </div>

                    <label className="text-sm text-slate-200">
                      API Key（留空表示不更新）
                      <input
                        value={form.api_key}
                        onChange={(e) => onProviderFieldChange(provider.id, 'api_key', e.target.value)}
                        className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                        style={{ borderColor: BORDER }}
                        type="password"
                        placeholder="sk-..."
                      />
                    </label>

                    <label className="text-sm text-slate-200">
                      备注
                      <input
                        value={form.note}
                        onChange={(e) => onProviderFieldChange(provider.id, 'note', e.target.value)}
                        className="mt-2 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                        style={{ borderColor: BORDER }}
                        placeholder="例如：只在高成本任务中启用"
                      />
                    </label>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                          disabled={action === 'reload'}
                          onClick={() => void runProviderAction(provider.id, 'reload')}
                        >
                          {action === 'reload' ? '重载中...' : '重载配置'}
                        </button>
                        <button
                          type="button"
                          className="rounded-xl border border-amber-400/35 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-400/15"
                          disabled={action === 'smoke'}
                          onClick={() => void runProviderAction(provider.id, 'smoke')}
                        >
                          {action === 'smoke' ? '测试中...' : '冒烟测试'}
                        </button>
                        <DangerActionGuard
                          trigger={
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-xl border border-rose-400/35 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/15 disabled:opacity-50"
                              disabled={action === 'delete'}
                            >
                              <Trash2 size={14} />
                              {action === 'delete' ? '删除中...' : '删除'}
                            </button>
                          }
                          title={`删除 Provider：${provider.name}`}
                          description="删除后新的模型调用将不再命中这个 Provider。请先确认没有绑定仍依赖它的龙虾岗位。"
                          confirmText="DELETE"
                          confirmLabel="确认删除"
                          successMessage={`Provider ${provider.id} 已删除`}
                          onConfirm={async () => {
                            await runProviderAction(provider.id, 'delete');
                          }}
                          disabled={action === 'delete'}
                        />
                      </div>

                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                          onClick={() => setEditingProviderId(null)}
                        >
                          收起
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15"
                          disabled={savingProvider[provider.id]}
                          onClick={() => void saveProvider(provider.id)}
                        >
                          <Pencil size={14} />
                          {savingProvider[provider.id] ? '正在保存...' : '保存配置'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-4 text-lg font-semibold text-white">9 只龙虾模型绑定</div>
        <p className="mb-4 text-sm leading-7 text-slate-300">
          这里保留每只龙虾的默认模型绑定。绑定层和 Provider 注册表分离，适合控制具体岗位优先使用哪条供给链。
        </p>

        <div className="space-y-3">
          {Object.values(bindings).map((binding) => (
            <div
              key={binding.agent_id}
              className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-4 md:grid-cols-[140px_1fr_1fr_112px]"
            >
              <div className="self-center text-sm font-semibold text-white">{binding.agent_id}</div>

              <select
                value={binding.provider_id}
                onChange={(e) =>
                  void saveBinding(binding.agent_id, {
                    provider_id: e.target.value,
                    model_name:
                      bindingProviders.find((provider) => provider.provider_id === e.target.value)?.default_model ||
                      binding.model_name,
                  })
                }
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {providerOptions.length === 0 ? (
                  <option value={binding.provider_id}>{binding.provider_id}</option>
                ) : (
                  providerOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))
                )}
              </select>

              <input
                value={binding.model_name}
                onChange={(e) =>
                  setBindings((prev) => ({
                    ...prev,
                    [binding.agent_id]: { ...prev[binding.agent_id], model_name: e.target.value },
                  }))
                }
                onBlur={() =>
                  void saveBinding(binding.agent_id, {
                    model_name: bindings[binding.agent_id]?.model_name || binding.model_name,
                  })
                }
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                placeholder="输入模型名"
              />

              <button
                type="button"
                className="rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15"
                onClick={() => void saveBinding(binding.agent_id, {})}
                disabled={savingBinding[binding.agent_id]}
              >
                {savingBinding[binding.agent_id] ? '保存中...' : '保存'}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
