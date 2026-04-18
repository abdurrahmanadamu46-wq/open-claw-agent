'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import { fetchAutopilotStatus, resetAutopilotCircuit, triggerAutopilotProbe } from '@/services/endpoints/autopilot';
import {
  type AiKernelRolloutPolicy,
  type AiKernelRolloutRiskEntry,
  deleteAiKernelRolloutTemplate,
  exportAiKernelRolloutTemplates,
  fetchAiKernelMetricsDashboard,
  getAiKernelRolloutPolicy,
  importAiKernelRolloutTemplates,
  listAiKernelRolloutTemplates,
  renameAiKernelRolloutTemplate,
  saveAiKernelRolloutTemplate,
  updateAiKernelRolloutPolicy,
} from '@/services/endpoints/ai-subservice';

const RISK_LEVELS = ['P0', 'P1', 'P2', 'P3'] as const;
type RiskLevel = (typeof RISK_LEVELS)[number];
type RiskConfig = { rollout_ratio: number; strategy_version: string; block_mode: 'hitl' | 'deny' };
type RiskRollout = Record<RiskLevel, RiskConfig>;

const DEFAULT_ROLLOUT: RiskRollout = {
  P0: { rollout_ratio: 5, strategy_version: 'strict_v1', block_mode: 'deny' },
  P1: { rollout_ratio: 25, strategy_version: 'guarded_v1', block_mode: 'hitl' },
  P2: { rollout_ratio: 60, strategy_version: 'balanced_v1', block_mode: 'hitl' },
  P3: { rollout_ratio: 100, strategy_version: 'explore_v1', block_mode: 'hitl' },
};

const PRESET_TEMPLATES: Record<'conservative' | 'balanced' | 'aggressive', { label: string; rollout: RiskRollout }> = {
  conservative: {
    label: '保守',
    rollout: {
      P0: { rollout_ratio: 0, strategy_version: 'strict_v2', block_mode: 'deny' },
      P1: { rollout_ratio: 10, strategy_version: 'guarded_v2', block_mode: 'hitl' },
      P2: { rollout_ratio: 35, strategy_version: 'balanced_v2', block_mode: 'hitl' },
      P3: { rollout_ratio: 70, strategy_version: 'explore_v2', block_mode: 'hitl' },
    },
  },
  balanced: {
    label: '平衡',
    rollout: {
      P0: { rollout_ratio: 5, strategy_version: 'strict_v2', block_mode: 'deny' },
      P1: { rollout_ratio: 25, strategy_version: 'guarded_v2', block_mode: 'hitl' },
      P2: { rollout_ratio: 60, strategy_version: 'balanced_v2', block_mode: 'hitl' },
      P3: { rollout_ratio: 100, strategy_version: 'explore_v2', block_mode: 'hitl' },
    },
  },
  aggressive: {
    label: '激进',
    rollout: {
      P0: { rollout_ratio: 20, strategy_version: 'strict_v3', block_mode: 'hitl' },
      P1: { rollout_ratio: 60, strategy_version: 'guarded_v3', block_mode: 'hitl' },
      P2: { rollout_ratio: 90, strategy_version: 'balanced_v3', block_mode: 'hitl' },
      P3: { rollout_ratio: 100, strategy_version: 'explore_v3', block_mode: 'hitl' },
    },
  },
};

const STRATEGY_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#f97316', '#a855f7', '#ef4444'];

function toIso(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function asPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function normalizeRollout(raw?: Record<string, AiKernelRolloutRiskEntry>): RiskRollout {
  const next: RiskRollout = { ...DEFAULT_ROLLOUT };
  for (const level of RISK_LEVELS) {
    const entry = raw?.[level];
    if (!entry) continue;
    next[level] = {
      rollout_ratio: Math.max(0, Math.min(100, Number(entry.rollout_ratio ?? next[level].rollout_ratio))),
      strategy_version: String(entry.strategy_version ?? next[level].strategy_version),
      block_mode: String(entry.block_mode ?? next[level].block_mode) === 'deny' ? 'deny' : 'hitl',
    };
  }
  return next;
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename: string, rows: string[][]) {
  const csvBody = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AutopilotPage() {
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [from, setFrom] = useState<string | undefined>();
  const [to, setTo] = useState<string | undefined>();
  const [granularity, setGranularity] = useState<'hour' | 'day'>('day');

  const [preset, setPreset] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [templateKey, setTemplateKey] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateAlias, setTemplateAlias] = useState('');
  const [savePolicyBusy, setSavePolicyBusy] = useState(false);
  const [saveTemplateBusy, setSaveTemplateBusy] = useState(false);

  const [managerOpen, setManagerOpen] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editingName, setEditingName] = useState('');
  const [editingAlias, setEditingAlias] = useState('');
  const [editingNote, setEditingNote] = useState('');
  const [templateActionBusy, setTemplateActionBusy] = useState(false);
  const [importMode, setImportMode] = useState<'upsert' | 'skip_existing' | 'replace_all'>('upsert');
  const [importTargetTenant, setImportTargetTenant] = useState('');

  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [draft, setDraft] = useState({
    enabled: true,
    rollout_ratio: 100,
    block_mode: 'hitl' as 'hitl' | 'deny',
    note: '',
    risk_rollout: { ...DEFAULT_ROLLOUT },
  });

  const statusQuery = useQuery({ queryKey: ['autopilot-status'], queryFn: fetchAutopilotStatus, refetchInterval: 15_000 });
  const metricsQuery = useQuery({
    queryKey: ['kernel-metrics', from, to, granularity],
    queryFn: () => fetchAiKernelMetricsDashboard({ from, to, granularity }),
    refetchInterval: 15_000,
  });
  const policyQuery = useQuery({
    queryKey: ['kernel-policy'],
    queryFn: () => getAiKernelRolloutPolicy(),
    refetchInterval: 30_000,
  });
  const templatesQuery = useQuery({
    queryKey: ['kernel-templates'],
    queryFn: () => listAiKernelRolloutTemplates({ limit: 200 }),
    refetchInterval: 30_000,
  });

  const currentTenantId = String(policyQuery.data?.tenant_id ?? templatesQuery.data?.tenant_id ?? '').trim();

  useEffect(() => {
    const policy: AiKernelRolloutPolicy | undefined = policyQuery.data?.policy;
    if (!policy) return;
    setDraft({
      enabled: Boolean(policy.enabled ?? true),
      rollout_ratio: Number(policy.rollout_ratio ?? 100),
      block_mode: String(policy.block_mode ?? 'hitl') === 'deny' ? 'deny' : 'hitl',
      note: String(policy.note ?? ''),
      risk_rollout: normalizeRollout(policy.risk_rollout),
    });
  }, [policyQuery.data]);

  const strategyVersions = useMemo(
    () => (metricsQuery.data?.byStrategyVersion ?? []).map((item) => item.strategy_version),
    [metricsQuery.data?.byStrategyVersion],
  );
  useEffect(() => {
    if (!strategyVersions.length) {
      setSelectedVersions([]);
      return;
    }
    setSelectedVersions((prev) => {
      const filtered = prev.filter((item) => strategyVersions.includes(item));
      return filtered.length > 0 ? filtered : strategyVersions.slice(0, 3);
    });
  }, [strategyVersions]);

  const trendSeries = metricsQuery.data?.strategyTrendSeries ?? [];
  const totals = metricsQuery.data?.totals;

  function buildPath(version: string): string {
    const values = trendSeries.map((row) => Number(row.by_strategy.find((item) => item.strategy_version === version)?.hit_rate ?? 0));
    if (values.length === 0) return '';
    const width = 560;
    const height = 100;
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    return values
      .map((value, index) => {
        const x = index * step;
        const y = height - Math.max(0, Math.min(1, value)) * height;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  async function applyPreset() {
    const selected = PRESET_TEMPLATES[preset];
    setDraft((prev) => ({ ...prev, risk_rollout: { ...selected.rollout }, note: `${selected.label}模板` }));
    triggerSuccessToast(`已应用预置模板：${selected.label}`);
  }

  function applySelectedTemplate() {
    const row = (templatesQuery.data?.templates ?? []).find((item) => item.template_key === templateKey);
    if (!row) {
      triggerErrorToast('请先选择租户模板');
      return;
    }
    setDraft((prev) => ({
      ...prev,
      risk_rollout: normalizeRollout(row.risk_rollout),
      note: String(row.note ?? `模板：${row.template_name}`),
    }));
    triggerSuccessToast(`已应用模板：${row.template_name}`);
  }

  async function saveTemplate() {
    if (!templateName.trim()) {
      triggerErrorToast('请填写模板名称');
      return;
    }
    setSaveTemplateBusy(true);
    try {
      const result = await saveAiKernelRolloutTemplate({
        template_name: templateName.trim(),
        template_key: templateAlias.trim() || undefined,
        risk_rollout: draft.risk_rollout,
        note: draft.note || undefined,
      });
      setTemplateKey(result.template.template_key);
      triggerSuccessToast(`模板已保存：${result.template.template_name}`);
      await templatesQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '保存模板失败');
    } finally {
      setSaveTemplateBusy(false);
    }
  }

  async function savePolicy() {
    setSavePolicyBusy(true);
    try {
      await updateAiKernelRolloutPolicy({
        enabled: draft.enabled,
        rollout_ratio: draft.rollout_ratio,
        block_mode: draft.block_mode,
        note: draft.note || undefined,
        risk_rollout: draft.risk_rollout,
      });
      triggerSuccessToast('灰度策略已保存');
      await Promise.all([policyQuery.refetch(), metricsQuery.refetch()]);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '保存策略失败');
    } finally {
      setSavePolicyBusy(false);
    }
  }

  function openTemplateManager(template: { template_key: string; template_name: string; note?: string }) {
    setEditingKey(template.template_key);
    setEditingAlias(template.template_key);
    setEditingName(template.template_name);
    setEditingNote(String(template.note ?? ''));
    setImportTargetTenant(currentTenantId);
    setManagerOpen(true);
  }

  async function renameTemplate() {
    if (!editingKey.trim() || !editingName.trim()) {
      triggerErrorToast('模板名称不能为空');
      return;
    }
    setTemplateActionBusy(true);
    try {
      await renameAiKernelRolloutTemplate(editingKey.trim(), {
        new_template_key: editingAlias.trim() || undefined,
        template_name: editingName.trim(),
        note: editingNote.trim() || undefined,
      });
      triggerSuccessToast('模板已重命名');
      setManagerOpen(false);
      await templatesQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '重命名失败');
    } finally {
      setTemplateActionBusy(false);
    }
  }

  async function deleteTemplate() {
    if (!editingKey.trim()) {
      triggerErrorToast('缺少模板标识');
      return;
    }
    if (!window.confirm('确认删除该模板吗？')) return;
    setTemplateActionBusy(true);
    try {
      await deleteAiKernelRolloutTemplate(editingKey.trim(), { tenant_id: currentTenantId || undefined });
      if (templateKey === editingKey.trim()) setTemplateKey('');
      triggerSuccessToast('模板已删除');
      setManagerOpen(false);
      await templatesQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '删除失败');
    } finally {
      setTemplateActionBusy(false);
    }
  }

  async function exportTemplatesJson() {
    try {
      const result = await exportAiKernelRolloutTemplates({ tenant_id: currentTenantId || undefined, limit: 2000 });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadJson(`kernel-rollout-templates-${result.source_tenant_id}-${stamp}.json`, result);
      triggerSuccessToast(`已导出 ${result.count} 条模板`);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '导出失败');
    }
  }

  async function importTemplatesJson(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as {
        source_tenant_id?: string;
        templates?: Array<{
          template_key?: string;
          template_name: string;
          risk_rollout?: Record<string, AiKernelRolloutRiskEntry>;
          note?: string;
        }>;
      };
      const templates = Array.isArray(payload.templates) ? payload.templates : [];
      if (templates.length === 0) {
        triggerErrorToast('导入文件中没有模板数据');
        return;
      }
      const targetTenant = importTargetTenant.trim() || currentTenantId;
      if (!targetTenant) {
        triggerErrorToast('请填写目标租户 tenant_id');
        return;
      }
      const result = await importAiKernelRolloutTemplates({
        tenant_id: targetTenant,
        source_tenant_id: payload.source_tenant_id,
        mode: importMode,
        templates,
      });
      triggerSuccessToast(`导入完成：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`);
      await templatesQuery.refetch();
      setManagerOpen(false);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '导入失败，请检查 JSON 格式');
    }
  }

  function exportTrendCsv() {
    if (selectedVersions.length === 0 || trendSeries.length === 0) {
      triggerErrorToast('暂无可导出的趋势数据');
      return;
    }
    const header = ['bucket_label'];
    for (const version of selectedVersions) {
      header.push(`${version}_hit_rate`, `${version}_applied`, `${version}_total`);
    }
    const rows: string[][] = [header];
    for (const row of trendSeries) {
      const line: string[] = [String(row.bucket_label ?? row.bucket_start_utc ?? '')];
      for (const version of selectedVersions) {
        const found = row.by_strategy.find((item) => item.strategy_version === version);
        line.push(
          found ? String(found.hit_rate) : '',
          found ? String(found.applied) : '',
          found ? String(found.total) : '',
        );
      }
      rows.push(line);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadCsv(`strategy-trend-${granularity}-${stamp}.csv`, rows);
    triggerSuccessToast('趋势 CSV 已导出');
  }

  return (
    <div className="min-h-[calc(100vh-6rem)] p-6" style={{ backgroundColor: '#0F172A' }}>
      <div className="mx-auto max-w-7xl space-y-6 text-slate-100">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">自动发布控制台</h1>
          <div className="flex gap-3 text-sm">
            <Link href="/operations/autopilot/modes" style={{ color: '#67e8f9' }}>Mode 预览</Link>
            <Link href="/operations/autopilot/trace" style={{ color: '#E5A93D' }}>Trace 排障</Link>
            <Link href="/operations/autopilot/alerts" style={{ color: '#fca5a5' }}>告警面板</Link>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>引擎状态</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <div>{statusQuery.data?.circuitOpen ? '熔断中' : '运行正常'}</div>
            <Button onClick={async () => {
              try {
                const result = await triggerAutopilotProbe();
                triggerSuccessToast(`探针已触发：${result.jobId}`);
              } catch (error) {
                triggerErrorToast(error instanceof Error ? error.message : '触发探针失败');
              }
            }}>
              触发探针
            </Button>
            {statusQuery.data?.circuitOpen ? (
              <Button variant="ghost" onClick={async () => {
                try {
                  await resetAutopilotCircuit();
                  triggerSuccessToast('熔断已恢复');
                } catch (error) {
                  triggerErrorToast(error instanceof Error ? error.message : '恢复熔断失败');
                }
              }}>
                恢复熔断
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>指标时间窗与趋势维度</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <input className="rounded border bg-slate-900 px-3 py-2" type="datetime-local" value={fromInput} onChange={(event) => setFromInput(event.target.value)} />
            <input className="rounded border bg-slate-900 px-3 py-2" type="datetime-local" value={toInput} onChange={(event) => setToInput(event.target.value)} />
            <select className="rounded border bg-slate-900 px-3 py-2" value={granularity} onChange={(event) => setGranularity(event.target.value === 'hour' ? 'hour' : 'day')}>
              <option value="hour">按小时</option>
              <option value="day">按天</option>
            </select>
            <Button onClick={() => { setFrom(toIso(fromInput)); setTo(toIso(toInput)); }}>应用时间窗</Button>
            <div className="text-xs text-slate-400">范围：{metricsQuery.data?.query?.from ?? '全量'} ~ {metricsQuery.data?.query?.to ?? '最新'}</div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card><CardHeader><CardTitle className="text-sm text-slate-300">策略命中率</CardTitle></CardHeader><CardContent className="text-2xl">{asPercent(Number(totals?.strategy_hit_rate ?? 0))}</CardContent></Card>
          <Card><CardHeader><CardTitle className="text-sm text-slate-300">回滚触发率</CardTitle></CardHeader><CardContent className="text-2xl">{asPercent(Number(totals?.rollback_trigger_count ?? 0) / Math.max(1, Number(totals?.kernel_reports_total ?? 0)))}</CardContent></Card>
          <Card><CardHeader><CardTitle className="text-sm text-slate-300">回滚成功率</CardTitle></CardHeader><CardContent className="text-2xl">{asPercent(Number(totals?.rollback_success_rate ?? 0))}</CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>租户灰度策略与模板</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <label className="flex items-center gap-2"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((prev) => ({ ...prev, enabled: event.target.checked }))} />启用 Kernel</label>
              <input className="rounded border bg-slate-900 px-3 py-2" type="number" min={0} max={100} value={draft.rollout_ratio} onChange={(event) => setDraft((prev) => ({ ...prev, rollout_ratio: Math.max(0, Math.min(100, Number(event.target.value || 0))) }))} />
              <select className="rounded border bg-slate-900 px-3 py-2" value={draft.block_mode} onChange={(event) => setDraft((prev) => ({ ...prev, block_mode: event.target.value === 'deny' ? 'deny' : 'hitl' }))}>
                <option value="hitl">hitl</option>
                <option value="deny">deny</option>
              </select>
              <div className="flex gap-2">
                <select className="w-full rounded border bg-slate-900 px-3 py-2" value={preset} onChange={(event) => setPreset(event.target.value as 'conservative' | 'balanced' | 'aggressive')}>
                  <option value="conservative">保守</option>
                  <option value="balanced">平衡</option>
                  <option value="aggressive">激进</option>
                </select>
                <Button variant="ghost" onClick={applyPreset}>应用预置</Button>
              </div>
              <div className="flex gap-2">
                <select className="w-full rounded border bg-slate-900 px-3 py-2" value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>
                  <option value="">租户模板</option>
                  {(templatesQuery.data?.templates ?? []).map((item) => <option key={item.template_key} value={item.template_key}>{item.template_name}</option>)}
                </select>
                <Button variant="ghost" onClick={applySelectedTemplate}>应用</Button>
              </div>
              <input className="rounded border bg-slate-900 px-3 py-2" value={draft.note} onChange={(event) => setDraft((prev) => ({ ...prev, note: event.target.value }))} placeholder="备注" />
            </div>

            <div className="overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead>
                  <tr><th className="px-2 py-1 text-left">风险</th><th className="px-2 py-1 text-left">ratio</th><th className="px-2 py-1 text-left">strategy</th><th className="px-2 py-1 text-left">block</th></tr>
                </thead>
                <tbody>
                  {RISK_LEVELS.map((level) => (
                    <tr key={level}>
                      <td className="px-2 py-1">{level}</td>
                      <td className="px-2 py-1"><input className="w-full rounded border bg-slate-900 px-2 py-1" type="number" min={0} max={100} value={draft.risk_rollout[level].rollout_ratio} onChange={(event) => setDraft((prev) => ({ ...prev, risk_rollout: { ...prev.risk_rollout, [level]: { ...prev.risk_rollout[level], rollout_ratio: Math.max(0, Math.min(100, Number(event.target.value || 0))) } } }))} /></td>
                      <td className="px-2 py-1"><input className="w-full rounded border bg-slate-900 px-2 py-1" value={draft.risk_rollout[level].strategy_version} onChange={(event) => setDraft((prev) => ({ ...prev, risk_rollout: { ...prev.risk_rollout, [level]: { ...prev.risk_rollout[level], strategy_version: event.target.value } } }))} /></td>
                      <td className="px-2 py-1"><select className="w-full rounded border bg-slate-900 px-2 py-1" value={draft.risk_rollout[level].block_mode} onChange={(event) => setDraft((prev) => ({ ...prev, risk_rollout: { ...prev.risk_rollout, [level]: { ...prev.risk_rollout[level], block_mode: event.target.value === 'deny' ? 'deny' : 'hitl' } } }))}><option value="hitl">hitl</option><option value="deny">deny</option></select></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input className="rounded border bg-slate-900 px-3 py-2" placeholder="模板名称（必填）" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
              <input className="rounded border bg-slate-900 px-3 py-2" placeholder="模板别名（可选）" value={templateAlias} onChange={(event) => setTemplateAlias(event.target.value)} />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={saveTemplate} disabled={saveTemplateBusy}>{saveTemplateBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}保存模板</Button>
                <Button onClick={savePolicy} disabled={savePolicyBusy}>{savePolicyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}保存策略</Button>
              </div>
            </div>

            <div className="rounded border p-3 space-y-2">
              <div className="text-sm text-slate-300">模板管理（重命名 / 删除 / 批量导入导出）</div>
              {(templatesQuery.data?.templates ?? []).length === 0 ? <div className="text-xs text-slate-400">暂无模板</div> : (templatesQuery.data?.templates ?? []).map((item) => (
                <div key={item.template_key} className="flex items-center justify-between rounded border px-3 py-2">
                  <div>
                    <div>{item.template_name}</div>
                    <div className="text-xs text-slate-400">key={item.template_key}</div>
                  </div>
                  <Button variant="ghost" onClick={() => openTemplateManager({ template_key: item.template_key, template_name: item.template_name, note: item.note })}>管理</Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>风险命中分布</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-4 gap-2 text-center">
              {RISK_LEVELS.map((level) => <div key={level} className="rounded border p-2"><div className="text-xs text-slate-400">{level}</div><div className="text-xl">{metricsQuery.data?.byRisk?.[level] ?? 0}</div></div>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>策略版本趋势对比（{granularity === 'hour' ? '按小时' : '按天'}）</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-2">
                  {strategyVersions.map((version) => {
                    const active = selectedVersions.includes(version);
                    return (
                      <button
                        key={version}
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        style={{
                          borderColor: active ? '#22c55e' : 'rgba(148,163,184,0.35)',
                          backgroundColor: active ? 'rgba(34,197,94,0.18)' : 'transparent',
                          color: active ? '#bbf7d0' : '#cbd5e1',
                        }}
                        onClick={() => setSelectedVersions((prev) => prev.includes(version) ? prev.filter((item) => item !== version) : [...prev, version])}
                      >
                        {version}
                      </button>
                    );
                  })}
                </div>
                <Button variant="ghost" onClick={exportTrendCsv}>
                  <Download className="mr-1 h-4 w-4" />
                  导出 CSV
                </Button>
              </div>
              {trendSeries.length === 0 ? <div className="text-sm text-slate-400">暂无趋势数据</div> : (
                <>
                  <svg viewBox="0 0 560 100" className="h-28 w-full rounded border bg-slate-950/60 p-2">
                    {selectedVersions.map((version, index) => {
                      const path = buildPath(version);
                      if (!path) return null;
                      return <path key={version} d={path} fill="none" stroke={STRATEGY_COLORS[index % STRATEGY_COLORS.length]} strokeWidth={2} />;
                    })}
                  </svg>
                  <div className="max-h-48 overflow-auto rounded border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="px-2 py-1 text-left">时间桶</th>
                          {selectedVersions.map((version) => <th key={version} className="px-2 py-1 text-left">{version}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {trendSeries.map((row) => (
                          <tr key={row.bucket_start_utc} className="border-t border-slate-800">
                            <td className="px-2 py-1">{row.bucket_label}</td>
                            {selectedVersions.map((version) => {
                              const found = row.by_strategy.find((item) => item.strategy_version === version);
                              return <td key={`${row.bucket_start_utc}:${version}`} className="px-2 py-1">{found ? `${asPercent(found.hit_rate)} (${found.applied}/${found.total})` : '-'}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {managerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded border border-slate-700 bg-slate-900 p-4">
            <div className="mb-3 text-lg font-semibold text-slate-100">模板管理与迁移</div>
            <div className="space-y-3">
              <input className="w-full rounded border bg-slate-950 px-3 py-2" placeholder="模板名称" value={editingName} onChange={(event) => setEditingName(event.target.value)} />
              <input className="w-full rounded border bg-slate-950 px-3 py-2" placeholder="模板别名（template_key）" value={editingAlias} onChange={(event) => setEditingAlias(event.target.value)} />
              <input className="w-full rounded border bg-slate-950 px-3 py-2" placeholder="备注" value={editingNote} onChange={(event) => setEditingNote(event.target.value)} />

              <div className="rounded border border-slate-700 p-3">
                <div className="mb-2 text-sm text-slate-300">批量导入/导出（JSON，多租户迁移）</div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input className="rounded border bg-slate-950 px-3 py-2" placeholder="目标租户 tenant_id" value={importTargetTenant} onChange={(event) => setImportTargetTenant(event.target.value)} />
                  <select className="rounded border bg-slate-950 px-3 py-2" value={importMode} onChange={(event) => setImportMode(event.target.value as 'upsert' | 'skip_existing' | 'replace_all')}>
                    <option value="upsert">upsert（同 key 覆盖）</option>
                    <option value="skip_existing">skip_existing（跳过已存在）</option>
                    <option value="replace_all">replace_all（清空后导入）</option>
                  </select>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={exportTemplatesJson}>
                    <Download className="mr-1 h-4 w-4" />
                    导出 JSON
                  </Button>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
                    <Upload className="h-4 w-4" />
                    导入 JSON
                    <input type="file" accept="application/json,.json" className="hidden" onChange={importTemplatesJson} />
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-between">
              <Button variant="ghost" onClick={deleteTemplate} disabled={templateActionBusy} style={{ color: '#fca5a5' }}>删除模板</Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setManagerOpen(false)} disabled={templateActionBusy}>取消</Button>
                <Button onClick={renameTemplate} disabled={templateActionBusy}>
                  {templateActionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  保存修改
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
