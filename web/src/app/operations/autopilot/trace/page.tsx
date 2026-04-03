'use client';

import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, History, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';
import {
  fetchAutopilotTraceSnapshot,
  type AutopilotTraceDlqItem,
  type AutopilotTraceReplayAuditItem,
} from '@/services/endpoints/autopilot';
import {
  fetchAiHitlStatus,
  fetchAiKernelMetricsDashboard,
  fetchAiKernelReport,
  rollbackAiKernelReport,
  type KernelApprovalJournalItem,
} from '@/services/endpoints/ai-subservice';

const QUEUES = ['', 'radar_sniffing_queue', 'content_forge_queue', 'matrix_dispatch_queue', 'lead_harvest_queue'];

function toIso(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const dt = new Date(normalized);
  return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
}

function asPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function localText(value?: string): string {
  if (!value) return '-';
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? value : new Date(ts).toLocaleString();
}

function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const axiosLike = error as { response?: { data?: { detail?: unknown; message?: string } }; message?: string };
    const detail = axiosLike.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (detail && typeof detail === 'object') return JSON.stringify(detail);
    if (axiosLike.response?.data?.message) return axiosLike.response.data.message;
    if (axiosLike.message) return axiosLike.message;
  }
  if (typeof error === 'string') return error;
  return '请求失败';
}

function inputClassName() {
  return 'h-10 rounded-2xl border border-slate-700 bg-slate-950/60 px-4 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400';
}

function riskBadgeStyle(riskLevel: string) {
  const level = riskLevel.toUpperCase();
  if (level === 'P0' || level === 'P1') return 'border-rose-500/35 bg-rose-500/10 text-rose-200';
  if (level === 'P2') return 'border-amber-500/35 bg-amber-500/10 text-amber-200';
  return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200';
}

function TracePageInner() {
  const searchParams = useSearchParams();
  const initialTrace = searchParams.get('traceId') ?? '';

  const [traceIdInput, setTraceIdInput] = useState(initialTrace);
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [errorsOnlyInput, setErrorsOnlyInput] = useState(false);
  const [sourceQueueInput, setSourceQueueInput] = useState('');

  const [traceId, setTraceId] = useState(initialTrace);
  const [from, setFrom] = useState<string | undefined>();
  const [to, setTo] = useState<string | undefined>();
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [sourceQueue, setSourceQueue] = useState<string | undefined>();

  const [rollbackStage, setRollbackStage] = useState<'preflight' | 'postgraph'>('preflight');
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [approvalId, setApprovalId] = useState('');
  const [rollbackPreview, setRollbackPreview] = useState<Record<string, unknown> | null>(null);
  const [rollbackResult, setRollbackResult] = useState<Record<string, unknown> | null>(null);
  const [showKbDetails, setShowKbDetails] = useState(false);

  const traceQuery = useQuery({
    queryKey: ['autopilot-trace', traceId, from, to, errorsOnly, sourceQueue],
    queryFn: () => fetchAutopilotTraceSnapshot(traceId, { from, to, errorsOnly, sourceQueue }),
    enabled: traceId.length > 0,
    refetchInterval: 15000,
  });

  const kernelQuery = useQuery({
    queryKey: ['ai-kernel-report', traceId],
    queryFn: () => fetchAiKernelReport(traceId),
    enabled: traceId.length > 0,
    refetchInterval: 15000,
  });

  const metricsQuery = useQuery({
    queryKey: ['ai-kernel-metrics-trace', traceId],
    queryFn: () => fetchAiKernelMetricsDashboard(),
    enabled: traceId.length > 0,
    refetchInterval: 30000,
  });

  const approvalStatusQuery = useQuery({
    queryKey: ['ai-hitl-status', approvalId.trim()],
    queryFn: () => fetchAiHitlStatus(approvalId.trim()),
    enabled: approvalId.trim().length > 0,
    refetchInterval: 5000,
  });

  const traceData = traceQuery.data;
  const kernelReport = (kernelQuery.data?.kernel_report ?? {}) as Record<string, unknown>;
  const riskTaxonomy = (kernelReport.risk_taxonomy as Record<string, unknown> | undefined) ?? {};
  const autonomy = (kernelReport.autonomy as Record<string, unknown> | undefined) ?? {};
  const industryKb = (((kernelQuery.data as Record<string, unknown> | undefined)?.industry_kb ??
    (traceData as Record<string, unknown> | undefined)?.industry_kb ??
    {}) as Record<string, unknown>);
  const industryKbMetrics = ((industryKb.metrics as Record<string, unknown> | undefined) ?? {});
  const industryKbReferences = Array.isArray(industryKbMetrics.references)
    ? (industryKbMetrics.references as Array<Record<string, unknown>>)
    : [];

  const approvalDecision = String(approvalStatusQuery.data?.status?.decision ?? 'pending').toLowerCase();
  const riskLevel = String(kernelReport.risk_level ?? 'P2');
  const riskFamily = String(riskTaxonomy.primary_family ?? 'single_agent');
  const autonomyRoute = String(autonomy.route ?? 'unknown');
  const score = Number((kernelReport.runtime as Record<string, unknown> | undefined)?.score ?? kernelReport.score ?? 0);
  const leadCount = Array.isArray(kernelReport.leads) ? kernelReport.leads.length : 0;
  const edgeCount = Array.isArray(kernelReport.edge_targets) ? kernelReport.edge_targets.length : 0;
  const metricsTotals = metricsQuery.data?.totals;
  const approvalLatencySec = Number(metricsTotals?.average_approval_latency_sec ?? autonomy.approval_latency_sec ?? 0);

  const timeline = useMemo(() => {
    const rows: Array<{ ts: string; label: string; detail: string }> = [];
    const approvals = (kernelQuery.data?.approval_journal ?? []) as KernelApprovalJournalItem[];
    approvals.forEach((row) => {
      rows.push({
        ts: row.ts ?? new Date().toISOString(),
        label: `审批事件 ${row.event_type ?? '-'}`,
        detail: `decision=${row.decision ?? '-'} / reason=${row.reason ?? '-'}`,
      });
    });
    (traceData?.replayAudits ?? []).forEach((row) => {
      rows.push({
        ts: row.completedAt || row.requestedAt,
        label: `重放 ${row.result}`,
        detail: `${row.sourceQueue} / ${row.stage || '-'} / ${row.operatorName || row.operatorId}`,
      });
    });
    (traceData?.taskStates ?? []).slice(0, 10).forEach((row) => {
      rows.push({
        ts: row.updatedAt || row.createdAt,
        label: `任务 ${row.state}`,
        detail: `${row.sourceQueue} / ${row.stage} / ${row.taskId}`,
      });
    });
    return rows.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 12);
  }, [kernelQuery.data?.approval_journal, traceData]);

  function applyFilters() {
    setTraceId(traceIdInput.trim());
    setFrom(toIso(fromInput));
    setTo(toIso(toInput));
    setErrorsOnly(errorsOnlyInput);
    setSourceQueue(sourceQueueInput.trim() || undefined);
    setRollbackPreview(null);
    setRollbackResult(null);
  }

  async function previewRollback() {
    if (!traceId) return triggerErrorToast('请先输入 traceId');
    setRollbackBusy(true);
    try {
      const result = await rollbackAiKernelReport(traceId, { stage: rollbackStage, dry_run: true });
      setRollbackPreview(result as Record<string, unknown>);
      triggerSuccessToast('回滚预演已完成');
    } catch (error) {
      triggerErrorToast(extractErrorMessage(error));
    } finally {
      setRollbackBusy(false);
    }
  }

  async function requestApproval() {
    if (!traceId) return triggerErrorToast('请先输入 traceId');
    setRollbackBusy(true);
    try {
      const result = await rollbackAiKernelReport(traceId, { stage: rollbackStage, dry_run: false });
      const id = String(result.approval_id ?? '');
      if (!id) return triggerErrorToast('审批单创建失败，缺少 approval_id');
      setApprovalId(id);
      triggerSuccessToast(`审批申请已提交：${id}`);
      await approvalStatusQuery.refetch();
    } catch (error) {
      triggerErrorToast(extractErrorMessage(error));
    } finally {
      setRollbackBusy(false);
    }
  }

  async function executeRollback() {
    if (!traceId) return triggerErrorToast('请先输入 traceId');
    if (!approvalId.trim()) return triggerErrorToast('请先申请审批并填写 approval_id');
    setRollbackBusy(true);
    try {
      const result = await rollbackAiKernelReport(traceId, {
        stage: rollbackStage,
        dry_run: false,
        approval_id: approvalId.trim(),
      });
      setRollbackResult(result as Record<string, unknown>);
      triggerSuccessToast(result.pending_approval ? '审批尚未通过，系统继续轮询状态' : '回滚执行成功');
      await Promise.all([traceQuery.refetch(), kernelQuery.refetch(), metricsQuery.refetch(), approvalStatusQuery.refetch()]);
    } catch (error) {
      triggerErrorToast(extractErrorMessage(error));
    } finally {
      setRollbackBusy(false);
    }
  }

  const taskStates = traceData?.taskStates ?? [];
  const dlqItems = traceData?.dlqItems ?? [];
  const replayAudits = traceData?.replayAudits ?? [];

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="trace"
        step="主线第 5 步 · 复盘"
        title="先判断这次执行为什么会这样"
        description="Trace 不再是旧日志堆。这里要帮助你判断：问题来自哪里、影响多大、需不需要审批回滚，以及下一步回到哪条链。"
        previous={{ href: '/operations/leads', label: '回到线索池' }}
        next={{ href: '/settings/billing', label: '前往商业化' }}
        actions={
          <>
            <Link href="/operations/autopilot/alerts" className="rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]">
              查看告警
            </Link>
            <Link href="/operations/log-audit" className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15">
              打开日志审核
            </Link>
          </>
        }
      />

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-4 text-lg font-semibold text-white">先定位这次复盘的 trace</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <input className={`${inputClassName()} md:col-span-4`} placeholder="traceId" value={traceIdInput} onChange={(e) => setTraceIdInput(e.target.value)} />
          <input className={`${inputClassName()} md:col-span-2`} type="datetime-local" value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
          <input className={`${inputClassName()} md:col-span-2`} type="datetime-local" value={toInput} onChange={(e) => setToInput(e.target.value)} />
          <select className={`${inputClassName()} md:col-span-2`} value={sourceQueueInput} onChange={(e) => setSourceQueueInput(e.target.value)}>
            {QUEUES.map((queue) => (
              <option key={queue || 'all'} value={queue}>{queue || '全部队列'}</option>
            ))}
          </select>
          <div className="md:col-span-2 flex items-center justify-end gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={errorsOnlyInput} onChange={(e) => setErrorsOnlyInput(e.target.checked)} />
              只看异常
            </label>
            <Button className="h-10 rounded-2xl px-4" onClick={applyFilters}>查询</Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="风险等级" value={riskLevel} helper="先判断这次属于高风险还是一般异常" badgeClass={riskBadgeStyle(riskLevel)} />
        <SummaryCard label="风险家族" value={riskFamily} helper="这次问题更像单 Agent、联动还是系统级异常" />
        <SummaryCard label="自治路由" value={autonomyRoute} helper="这次到底是自动放行、阻断还是要求复核" />
        <SummaryCard label="影响范围" value={`线索 ${leadCount} / 节点 ${edgeCount}`} helper={`评分 ${score.toFixed(2)} / 审批延迟 ${approvalLatencySec.toFixed(0)}s`} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
            <ShieldCheck className="h-4 w-4 text-cyan-300" />
            回滚与审批
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr_auto]">
            <select className={inputClassName()} value={rollbackStage} onChange={(e) => setRollbackStage(e.target.value === 'postgraph' ? 'postgraph' : 'preflight')}>
              <option value="preflight">preflight</option>
              <option value="postgraph">postgraph</option>
            </select>
            <input className={inputClassName()} placeholder="approval_id（可自动生成）" value={approvalId} onChange={(e) => setApprovalId(e.target.value)} />
            <div className="flex h-10 items-center rounded-2xl bg-slate-900/70 px-3 text-xs text-slate-300">
              {approvalStatusQuery.isFetching ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              审批状态：{approvalDecision}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="h-10 rounded-2xl" onClick={previewRollback} disabled={rollbackBusy || !traceId}>1) 预演回滚</Button>
            <Button className="h-10 rounded-2xl" onClick={requestApproval} disabled={rollbackBusy || !traceId}>2) 申请审批</Button>
            <Button className="h-10 rounded-2xl" onClick={executeRollback} disabled={rollbackBusy || !traceId || approvalDecision !== 'approved'}>3) 执行回滚</Button>
          </div>
          <div className="mt-4 rounded-2xl border border-white/8 bg-slate-950/40 p-4 text-sm text-slate-300">
            {!approvalId
              ? '如果这次复盘需要回滚，先申请审批，再决定是否真正执行。'
              : approvalDecision === 'approved'
                ? '审批已通过，可以执行回滚。'
                : approvalDecision === 'rejected'
                  ? `审批被拒绝：${approvalStatusQuery.data?.status?.reason ?? '无原因'}`
                  : '审批处理中，系统正在自动轮询。'}
          </div>
          {rollbackPreview && (
            <details className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-xs text-slate-300">
              <summary className="cursor-pointer text-sm font-medium text-slate-100">预演结果</summary>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(rollbackPreview, null, 2)}</pre>
            </details>
          )}
          {rollbackResult && (
            <details className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-xs text-slate-300" open>
              <summary className="cursor-pointer text-sm font-medium text-slate-100">执行结果</summary>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(rollbackResult, null, 2)}</pre>
            </details>
          )}
        </article>

        <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
            <AlertTriangle className="h-4 w-4 text-amber-300" />
            执行证据
          </div>
          <div className="mt-4 space-y-4">
            <SectionList
              title="任务状态"
              items={taskStates.slice(0, 5).map((item) => ({
                key: item.recordId,
                title: `${item.taskId} · ${item.state}`,
                subtitle: `${item.sourceQueue} / ${item.stage} / ${item.nodeId || '-'}`,
              }))}
              emptyText="当前 trace 没有任务状态记录。"
            />
            <SectionList
              title="DLQ"
              items={dlqItems.slice(0, 4).map((item: AutopilotTraceDlqItem) => ({
                key: item.dlqJobId,
                title: `${item.taskId} · ${item.errorCode}`,
                subtitle: `${item.sourceQueue} / attempts ${item.attemptsMade}/${item.maxAttempts}`,
              }))}
              emptyText="没有 DLQ 项。"
            />
            <SectionList
              title="重放记录"
              items={replayAudits.slice(0, 4).map((item: AutopilotTraceReplayAuditItem) => ({
                key: item.auditId,
                title: `${item.result} · ${item.sourceQueue}`,
                subtitle: `${item.operatorName || item.operatorId} / ${localText(item.completedAt || item.requestedAt)}`,
              }))}
              emptyText="没有 replay audit 记录。"
            />
          </div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <EvidenceCard
          title="Industry KB 命中"
          action={
            <button type="button" onClick={() => setShowKbDetails((prev) => !prev)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
              {showKbDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {showKbDetails ? '收起' : '展开'}
            </button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <MiniMetric label="行业标签" value={String(industryKbMetrics.industry_tag ?? '-')} />
            <MiniMetric label="命中率" value={asPercent(Number(industryKbMetrics.industry_kb_hit_rate ?? 0))} />
            <MiniMetric label="效果变化" value={Number(industryKbMetrics.industry_kb_effect_delta ?? 0).toFixed(2)} />
            <MiniMetric label="引用数" value={String(industryKbReferences.length)} />
          </div>
          {showKbDetails && (
            industryKbReferences.length > 0 ? (
              <div className="mt-4 max-h-56 overflow-auto rounded-2xl border border-white/8 bg-slate-950/40">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-950/95 text-slate-300">
                    <tr>
                      <th className="px-3 py-2 font-medium">类型</th>
                      <th className="px-3 py-2 font-medium">标题</th>
                      <th className="px-3 py-2 font-medium">效果</th>
                      <th className="px-3 py-2 font-medium">来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {industryKbReferences.map((row, idx) => (
                      <tr key={`ikb-ref-${idx}`} className="border-t border-slate-800 text-slate-200">
                        <td className="px-3 py-2">{String(row.entry_type ?? '-')}</td>
                        <td className="px-3 py-2">{String(row.title ?? '-')}</td>
                        <td className="px-3 py-2">{Number(row.effect_score ?? 0).toFixed(1)}</td>
                        <td className="px-3 py-2">{String(row.source_account ?? '-')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4 text-sm text-slate-400">暂无行业知识命中明细。</div>
            )
          )}
        </EvidenceCard>

        <EvidenceCard title="复盘时间线" icon={<History className="h-4 w-4 text-cyan-300" />}>
          {timeline.length === 0 ? (
            <EmptyBlock text="暂无复盘数据。" />
          ) : (
            <div className="space-y-0">
              {timeline.map((row, idx) => (
                <div key={`${row.ts}-${idx}`} className="relative pl-8 pb-5">
                  {idx !== timeline.length - 1 ? <span className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-slate-700" /> : null}
                  <span className="absolute left-[6px] top-1.5 h-3 w-3 rounded-full border border-cyan-400/60 bg-cyan-400/20" />
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <History className="h-3.5 w-3.5" />
                      {localText(row.ts)}
                    </div>
                    <div className="mt-1 text-sm font-medium text-white">{row.label}</div>
                    <div className="mt-1 text-sm text-slate-300">{row.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </EvidenceCard>
      </section>

      {(traceQuery.isLoading || kernelQuery.isLoading) && (
        <div className="flex items-center text-sm text-slate-300">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载链路数据...
        </div>
      )}

      {(traceQuery.isError || kernelQuery.isError) && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Trace 数据加载失败：{extractErrorMessage(traceQuery.error ?? kernelQuery.error)}</span>
        </div>
      )}
    </div>
  );
}

export default function AutopilotTracePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-300">正在加载 Trace 页面...</div>}>
      <TracePageInner />
    </Suspense>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  badgeClass,
}: {
  label: string;
  value: string;
  helper: string;
  badgeClass?: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="text-sm text-slate-400">{label}</div>
      {badgeClass ? (
        <div className="mt-3">
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>{value}</span>
        </div>
      ) : (
        <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      )}
      <div className="mt-2 text-sm text-slate-300">{helper}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function EvidenceCard({
  title,
  action,
  children,
  icon,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-lg font-semibold text-white">
          {icon}
          <span>{title}</span>
        </div>
        {action}
      </div>
      {children}
    </article>
  );
}

function SectionList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: Array<{ key: string; title: string; subtitle: string }>;
  emptyText: string;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-white">{title}</div>
      {items.length === 0 ? (
        <EmptyBlock text={emptyText} />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.key} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm font-semibold text-white">{item.title}</div>
              <div className="mt-2 text-sm text-slate-300">{item.subtitle}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
      {text}
    </div>
  );
}
