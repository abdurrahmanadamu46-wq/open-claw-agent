'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Pencil, Sparkles } from 'lucide-react';
import {
  checkFeatureFlag,
  createFeatureFlag,
  disableFeatureFlag,
  enableFeatureFlag,
  fetchFeatureFlagChangelog,
  fetchFeatureFlags,
  updateFeatureFlag,
  updateFeatureFlagStrategies,
} from '@/services/endpoints/feature-flags';
import { FeatureFlagForm, type FeatureFlagFormValues } from '@/components/feature-flags/FeatureFlagForm';
import type { FeatureFlag, FeatureFlagChangelogItem, FlagStrategy } from '@/types/feature-flags';

function buildStrategies(values: FeatureFlagFormValues): FlagStrategy[] {
  if (values.strategyType === 'gradualRollout') {
    return [
      {
        type: 'gradualRollout',
        parameters: {
          rollout: values.rolloutPercent,
          stickiness: 'tenant_id',
        },
      },
    ];
  }
  return [{ type: values.strategyType, parameters: {} }];
}

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [changelog, setChangelog] = useState<FeatureFlagChangelogItem[]>([]);
  const [message, setMessage] = useState('');
  const [checkResult, setCheckResult] = useState('');
  const [editingFlag, setEditingFlag] = useState<FeatureFlag | null>(null);

  async function refresh() {
    try {
      const [flagsRes, logRes] = await Promise.all([
        fetchFeatureFlags(),
        fetchFeatureFlagChangelog({ limit: 20 }),
      ]);
      setFlags(flagsRes.flags ?? []);
      setChangelog(logRes.items ?? []);
      setMessage('Feature Flags 已同步。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载失败');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate(values: FeatureFlagFormValues) {
    await createFeatureFlag({
      name: values.name,
      description: values.description,
      environment: values.environment,
      enabled: values.enabled,
      strategies: buildStrategies(values),
      tags: ['manual'],
    });
    setMessage(`已创建开关 ${values.name}`);
    await refresh();
  }

  async function handleEdit(values: FeatureFlagFormValues) {
    if (!editingFlag) return;
    await updateFeatureFlag(editingFlag.name, {
      description: values.description,
      enabled: values.enabled,
      environment: values.environment,
      tags: editingFlag.tags,
      tenant_id: editingFlag.tenant_id,
      strategies: editingFlag.strategies,
      variants: editingFlag.variants,
      created_by: editingFlag.created_by,
      created_at: editingFlag.created_at,
      updated_at: editingFlag.updated_at,
      name: editingFlag.name,
    });
    await updateFeatureFlagStrategies(editingFlag.name, {
      environment: values.environment,
      tenant_id: editingFlag.tenant_id || undefined,
      strategies: buildStrategies(values),
    });
    setMessage(`已更新开关 ${editingFlag.name}`);
    setEditingFlag(null);
    await refresh();
  }

  async function handleToggle(flag: FeatureFlag) {
    try {
      if (flag.enabled) {
        await disableFeatureFlag(flag.name, { environment: flag.environment, tenant_id: flag.tenant_id || undefined });
      } else {
        await enableFeatureFlag(flag.name, { environment: flag.environment, tenant_id: flag.tenant_id || undefined });
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '切换失败');
    }
  }

  async function handleCheck(flag: FeatureFlag) {
    try {
      const result = await checkFeatureFlag({
        flag_name: flag.name,
        tenant_id: flag.tenant_id || 'tenant_main',
        environment: flag.environment,
        lobster_id: 'inkwriter',
      });
      setCheckResult(`${flag.name}: ${result.enabled ? 'enabled' : 'disabled'}${result.variant?.name ? ` / ${result.variant.name}` : ''}`);
    } catch (error) {
      setCheckResult(error instanceof Error ? error.message : '检查失败');
    }
  }

  const counts = useMemo(
    () => ({
      total: flags.length,
      enabled: flags.filter((flag) => flag.enabled).length,
      gradual: flags.filter((flag) => flag.strategies.some((item) => item.type === 'gradualRollout')).length,
    }),
    [flags],
  );

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Sparkles className="h-4 w-4" />
              shadcn Form + Feature Flags
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-white">Feature Flags</h1>
            <p className="mt-2 text-sm leading-7 text-slate-300">这页已切到统一表单体系：创建和编辑都用同一套 zod + react-hook-form 规则。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="总开关" value={String(counts.total)} />
            <Metric label="已启用" value={String(counts.enabled)} />
            <Metric label="灰度中" value={String(counts.gradual)} />
          </div>
        </div>
        <div className="mt-4 text-sm text-cyan-100">{message}</div>
        {checkResult ? <div className="mt-2 text-sm text-amber-100">{checkResult}</div> : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <div className="mb-4 text-lg font-semibold text-white">{editingFlag ? `编辑开关：${editingFlag.name}` : '新建开关'}</div>
          <FeatureFlagForm
            mode={editingFlag ? 'edit' : 'create'}
            initialFlag={editingFlag}
            onCancel={() => setEditingFlag(null)}
            onSubmit={editingFlag ? handleEdit : handleCreate}
          />
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <div className="text-lg font-semibold text-white">开关列表</div>
            <div className="mt-4 space-y-3">
              {flags.map((flag) => (
                <div key={`${flag.tenant_id || '__global__'}-${flag.environment}-${flag.name}`} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{flag.name}</div>
                      <div className="mt-1 text-xs text-slate-400">{flag.environment} · {flag.tenant_id || 'global'} · {flag.description || '无描述'}</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs ${flag.enabled ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200'}`}>
                      {flag.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(flag.tags || []).map((tag) => (
                      <span key={tag} className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-300">{tag}</span>
                    ))}
                    {flag.strategies.map((strategy, index) => (
                      <span key={`${flag.name}-${index}`} className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-100">
                        {strategy.type}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void handleToggle(flag)} className="rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-200">
                      {flag.enabled ? '关闭' : '开启'}
                    </button>
                    <button type="button" onClick={() => setEditingFlag(flag)} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-100">
                      <Pencil className="h-4 w-4" />
                      编辑
                    </button>
                    <button type="button" onClick={() => void handleCheck(flag)} className="rounded-xl border border-amber-400/35 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-100">
                      调试检查
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <div className="mb-4 text-lg font-semibold text-white">变更历史</div>
            <div className="space-y-3">
              {changelog.map((row, index) => (
                <div key={`${row.id || index}`} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                    {String(row.name || '')}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {String(row['change_type'] || '')} · {String(row['environment'] || '')} · {String(row['changed_at'] || '')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}
