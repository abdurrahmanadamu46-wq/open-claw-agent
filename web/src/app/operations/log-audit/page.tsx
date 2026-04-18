'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, RefreshCw, ShieldAlert } from 'lucide-react';
import { fetchAiKernelReport } from '@/services/endpoints/ai-subservice';
import {
  fetchAutopilotAuditLogs,
  type AutopilotAuditLogItem,
  type AutopilotAuditLogLevel,
  type AutopilotAuditLogModule,
} from '@/services/endpoints/autopilot';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';

const SOURCE_QUEUES = [
  'radar_sniffing_queue',
  'content_forge_queue',
  'matrix_dispatch_queue',
  'lead_harvest_queue',
] as const;
const LOG_LEVEL_OPTIONS = ['INFO', 'WARN', 'ERROR', 'SECURITY'] as const;
const LOG_MODULE_OPTIONS = ['PATROL', 'DISPATCHER', 'ECHOER', 'CATCHER', 'WEBHOOK', 'FLEET', 'BEHAVIOR', 'AUTOPILOT'] as const;

function levelColor(level: AutopilotAuditLogLevel): string {
  if (level === 'INFO') return '#67e8f9';
  if (level === 'WARN') return '#f59e0b';
  if (level === 'ERROR') return '#ef4444';
  return '#fb7185';
}

function levelBg(level: AutopilotAuditLogLevel): string {
  if (level === 'INFO') return 'rgba(103,232,249,0.18)';
  if (level === 'WARN') return 'rgba(245,158,11,0.18)';
  if (level === 'ERROR') return 'rgba(239,68,68,0.18)';
  return 'rgba(251,113,133,0.2)';
}

function defaultFromISO() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

function defaultToISO() {
  return new Date().toISOString().slice(0, 16);
}

function asInputDateTime(iso?: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseBooleanParam(value: string | null): boolean {
  return value === '1' || value === 'true';
}

function parseLevelFilter(value: string | null): 'ALL' | AutopilotAuditLogLevel {
  return value && LOG_LEVEL_OPTIONS.includes(value as typeof LOG_LEVEL_OPTIONS[number])
    ? value as AutopilotAuditLogLevel
    : 'ALL';
}

function parseModuleFilter(value: string | null): 'ALL' | AutopilotAuditLogModule {
  return value && LOG_MODULE_OPTIONS.includes(value as typeof LOG_MODULE_OPTIONS[number])
    ? value as AutopilotAuditLogModule
    : 'ALL';
}

function toIsoQuery(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : undefined;
}

function buildTraceHref(input: {
  traceId: string;
  from?: string;
  to?: string;
  errorsOnly?: boolean;
  sourceQueue?: string;
  validation?: Record<string, string | undefined>;
}): string {
  const params = new URLSearchParams({
    traceId: input.traceId,
  });
  if (input.from) params.set('from', input.from);
  if (input.to) params.set('to', input.to);
  if (input.errorsOnly) params.set('errorsOnly', '1');
  if (input.sourceQueue) params.set('sourceQueue', input.sourceQueue);
  Object.entries(input.validation || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return `/operations/autopilot/trace?${params.toString()}`;
}

function buildMonitorHref(input: {
  taskId?: string;
  nodeId?: string;
  validation?: Record<string, string | undefined>;
}): string {
  const params = new URLSearchParams();
  if (input.taskId) params.set('taskId', input.taskId);
  if (input.nodeId) params.set('nodeId', input.nodeId);
  Object.entries(input.validation || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `/operations/monitor?${query}#stability-alerts` : '/operations/monitor#stability-alerts';
}

function validationStatusTone(status?: string): string {
  if (status === 'executed') return 'bg-emerald-500/15 text-emerald-200';
  if (status === 'pending_approval') return 'bg-amber-400/15 text-amber-200';
  if (status === 'dry_run_ready') return 'bg-cyan-400/10 text-cyan-100';
  return 'bg-white/5 text-slate-200';
}

function validationStatusLabel(status?: string): string {
  if (status === 'executed') return 'rollback executed';
  if (status === 'pending_approval') return 'pending approval';
  if (status === 'dry_run_ready') return 'preview ready';
  return 'trace observe';
}

function encodeValidationConclusionCode(label: string): string {
  if (label === '已恢复') return 'recovered';
  if (label === '正在改善') return 'improving';
  if (label === '未恢复') return 'not_recovered';
  return 'observe';
}

function parseCountParam(value?: string): number | null {
  if (!value) return null;
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function compareCountTrend(current: number, baseline: number | null): {
  label: string;
  tone: string;
  direction: 'down' | 'flat' | 'up';
  delta: number;
} | null {
  if (baseline === null) return null;
  const delta = current - baseline;
  if (delta < 0) {
    return {
      label: `${baseline} -> ${current}，下降 ${Math.abs(delta)}`,
      tone: 'bg-emerald-500/15 text-emerald-200',
      direction: 'down',
      delta,
    };
  }
  if (delta > 0) {
    return {
      label: `${baseline} -> ${current}，扩大 ${delta}`,
      tone: 'bg-rose-500/15 text-rose-200',
      direction: 'up',
      delta,
    };
  }
  return {
    label: `${baseline} -> ${current}，持平`,
    tone: 'bg-white/5 text-slate-200',
    direction: 'flat',
    delta: 0,
  };
}

function resolveLogAuditValidationConclusion(input: {
  status?: string;
  currentWarn: number;
  currentError: number;
  trends: Array<{ direction: 'down' | 'flat' | 'up' }>;
}): {
  label: string;
  tone: string;
  summary: string;
} {
  if (input.status === 'pending_approval') {
    return {
      label: '继续观察',
      tone: 'bg-amber-400/15 text-amber-200',
      summary: '审批尚未完成，日志变化暂时只能作为参考，先继续观察异常是否收敛。',
    };
  }
  if (input.status === 'dry_run_ready') {
    return {
      label: '继续观察',
      tone: 'bg-cyan-400/10 text-cyan-100',
      summary: '当前还是预演阶段，还没有正式执行处理，日志趋势仅作参考。',
    };
  }
  if (input.currentError === 0 && input.currentWarn === 0) {
    return {
      label: '已恢复',
      tone: 'bg-emerald-500/15 text-emerald-200',
      summary: '当前 WARN、ERROR 和 SECURITY 已经清零，异常侧基本恢复到安全区。',
    };
  }
  if (input.currentError > 0 && input.trends.some((item) => item.direction === 'up')) {
    return {
      label: '未恢复',
      tone: 'bg-rose-500/15 text-rose-200',
      summary: '高风险异常没有回落，甚至还在扩大，建议继续排障或重新确认处理策略。',
    };
  }
  if (input.trends.some((item) => item.direction === 'down')) {
    return {
      label: '正在改善',
      tone: 'bg-cyan-400/10 text-cyan-100',
      summary: '异常数量正在回落，但还没有完全退到安全区，建议继续观察一轮。',
    };
  }
  return {
    label: '继续观察',
    tone: 'bg-white/5 text-slate-200',
    summary: '当前异常没有明显扩大，但也还不足以直接判定恢复，先继续观察。',
  };
}

export default function LogAuditPage() {
  const searchParams = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [levelFilter, setLevelFilter] = useState<'ALL' | AutopilotAuditLogLevel>('ALL');
  const [moduleFilter, setModuleFilter] = useState<'ALL' | AutopilotAuditLogModule>('ALL');
  const [nodeFilter, setNodeFilter] = useState('');
  const [sourceQueue, setSourceQueue] = useState('');
  const [traceId, setTraceId] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const keywordParam = searchParams?.get('keyword') ?? '';
    const nodeIdParam = searchParams?.get('nodeId') ?? '';
    const traceIdParam = searchParams?.get('traceId') ?? '';
    const sourceQueueParam = searchParams?.get('sourceQueue') ?? '';
    const fromParam = searchParams?.get('from');
    const toParam = searchParams?.get('to');
    setKeyword(keywordParam);
    setLevelFilter(parseLevelFilter(searchParams?.get('level')));
    setModuleFilter(parseModuleFilter(searchParams?.get('module')));
    setNodeFilter(nodeIdParam);
    setSourceQueue(sourceQueueParam);
    setTraceId(traceIdParam);
    setErrorsOnly(parseBooleanParam(searchParams?.get('errorsOnly')));
    setFrom(fromParam ? asInputDateTime(fromParam) : defaultFromISO());
    setTo(toParam ? asInputDateTime(toParam) : defaultToISO());
  }, [searchParams]);
  const [selectedId, setSelectedId] = useState('');

  const query = useQuery({
    queryKey: [
      'autopilot',
      'logs',
      { keyword, levelFilter, moduleFilter, nodeFilter, sourceQueue, traceId, errorsOnly, from, to },
    ],
    queryFn: () =>
      fetchAutopilotAuditLogs({
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        errorsOnly,
        sourceQueue: sourceQueue || undefined,
        module: moduleFilter === 'ALL' ? undefined : moduleFilter,
        level: levelFilter === 'ALL' ? undefined : levelFilter,
        nodeId: nodeFilter.trim() || undefined,
        traceId: traceId.trim() || undefined,
        keyword: keyword.trim() || undefined,
        limit: 200,
      }),
  });

  const logs = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const selected = useMemo(() => {
    if (!logs.length) return null;
    if (!selectedId) return logs[0];
    return logs.find((entry) => entry.id === selectedId) ?? logs[0];
  }, [logs, selectedId]);

  const selectedKernelQuery = useQuery({
    queryKey: ['log-audit', 'kernel-report', selected?.traceId],
    queryFn: () => fetchAiKernelReport(String(selected?.traceId ?? '')),
    enabled: !!selected?.traceId,
    retry: false,
  });

  const stats = useMemo(() => {
    const total = logs.length;
    const warn = logs.filter((item) => item.level === 'WARN').length;
    const error = logs.filter((item) => item.level === 'ERROR' || item.level === 'SECURITY').length;
    const replayTotal = logs.filter((item) => item.eventType.startsWith('dlq.replay.')).length;
    const replaySuccess = logs.filter((item) => item.eventType === 'dlq.replay.success').length;
    const replaySuccessRate = replayTotal > 0 ? Math.round((replaySuccess / replayTotal) * 100) : 100;
    return { total, warn, error, replaySuccessRate };
  }, [logs]);

  const validationForwardParams = useMemo(() => ({
    validationTraceId: searchParams?.get('validationTraceId') || undefined,
    validationTaskId: searchParams?.get('validationTaskId') || undefined,
    validationNodeId: searchParams?.get('validationNodeId') || undefined,
    validationQueue: searchParams?.get('validationQueue') || undefined,
    validationMode: searchParams?.get('validationMode') || undefined,
    validationStatus: searchParams?.get('validationStatus') || undefined,
    validationStage: searchParams?.get('validationStage') || undefined,
    validationAt: searchParams?.get('validationAt') || undefined,
    validationOrigin: searchParams?.get('validationOrigin') || undefined,
    baselineCapturedAt: searchParams?.get('baselineCapturedAt') || undefined,
    baselineHeartbeatAlerts: searchParams?.get('baselineHeartbeatAlerts') || undefined,
    baselineReceiptLagAlerts: searchParams?.get('baselineReceiptLagAlerts') || undefined,
    baselineCriticalAlerts: searchParams?.get('baselineCriticalAlerts') || undefined,
    baselineLogTotal: String(stats.total),
    baselineLogWarnCount: String(stats.warn),
    baselineLogErrorCount: String(stats.error),
  }), [searchParams, stats.error, stats.total, stats.warn]);
  const selectedRiskFamily = String(selectedKernelQuery.data?.kernel_report?.risk_taxonomy?.primary_family ?? '--');
  const selectedAutonomy = String(selectedKernelQuery.data?.kernel_report?.autonomy?.route ?? '--');
  const validationFeedback = useMemo(() => {
    const trace = searchParams?.get('validationTraceId') ?? '';
    if (!trace) return null;
    const totalTrend = compareCountTrend(stats.total, parseCountParam(searchParams?.get('baselineLogTotal') ?? ''));
    const warnTrend = compareCountTrend(stats.warn, parseCountParam(searchParams?.get('baselineLogWarnCount') ?? ''));
    const errorTrend = compareCountTrend(stats.error, parseCountParam(searchParams?.get('baselineLogErrorCount') ?? ''));
    const trends = [totalTrend, warnTrend, errorTrend].filter(
      (item): item is { label: string; tone: string; direction: 'flat' | 'down' | 'up'; delta: number } => item !== null,
    );
    return {
      traceId: trace,
      taskId: searchParams?.get('validationTaskId') ?? '',
      nodeId: searchParams?.get('validationNodeId') ?? '',
      queue: searchParams?.get('validationQueue') ?? '',
      mode: searchParams?.get('validationMode') ?? '',
      status: searchParams?.get('validationStatus') ?? '',
      stage: searchParams?.get('validationStage') ?? '',
      at: searchParams?.get('validationAt') ?? '',
      origin: searchParams?.get('validationOrigin') ?? '',
      baselineAt: searchParams?.get('baselineCapturedAt') ?? '',
      trends,
      conclusion: resolveLogAuditValidationConclusion({
        status: searchParams?.get('validationStatus') ?? '',
        currentWarn: stats.warn,
        currentError: stats.error,
        trends,
      }),
    };
  }, [searchParams, stats.error, stats.total, stats.warn]);
  const validationRelayParams = useMemo(() => ({
    ...validationForwardParams,
    monitorValidationCode: searchParams?.get('monitorValidationCode') || undefined,
    monitorValidationAt: searchParams?.get('monitorValidationAt') || undefined,
    logValidationCode: validationFeedback ? encodeValidationConclusionCode(validationFeedback.conclusion.label) : (searchParams?.get('logValidationCode') || undefined),
    logValidationAt: validationFeedback ? new Date().toISOString() : (searchParams?.get('logValidationAt') || undefined),
  }), [searchParams, validationFeedback, validationForwardParams]);
  const selectedTraceHref = useMemo(() => {
    if (!selected?.traceId) return null;
    return buildTraceHref({
      traceId: selected.traceId,
      from: toIsoQuery(from),
      to: toIsoQuery(to),
      errorsOnly,
      sourceQueue: selected.sourceQueue || sourceQueue || undefined,
      validation: validationRelayParams,
    });
  }, [errorsOnly, from, selected?.sourceQueue, selected?.traceId, sourceQueue, to, validationRelayParams]);
  const validationMonitorHref = useMemo(() => buildMonitorHref({
    taskId: validationFeedback?.taskId || undefined,
    nodeId: validationFeedback?.nodeId || undefined,
    validation: validationRelayParams,
  }), [validationFeedback?.nodeId, validationFeedback?.taskId, validationRelayParams]);
  const validationTraceHref = useMemo(() => {
    if (!validationFeedback?.traceId) return '/operations/autopilot/trace';
    return buildTraceHref({
      traceId: validationFeedback.traceId,
      from: toIsoQuery(from),
      to: toIsoQuery(to),
      errorsOnly,
      sourceQueue: validationFeedback.queue || sourceQueue || undefined,
      validation: validationRelayParams,
    });
  }, [errorsOnly, from, sourceQueue, to, validationFeedback?.queue, validationFeedback?.traceId, validationRelayParams]);
  const validationRollbackHref = useMemo(() => `${validationTraceHref}#rollback-approval`, [validationTraceHref]);
  const validationActions = useMemo(() => {
    if (!validationFeedback) return [];
    if (validationFeedback.conclusion.label === '已恢复') {
      return [
        { label: '去执行监控室收尾确认', href: validationMonitorHref, tone: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100' },
        { label: '回 Trace 留痕', href: validationTraceHref, tone: 'border-white/12 bg-white/5 text-white' },
      ];
    }
    if (validationFeedback.conclusion.label === '未恢复') {
      return [
        { label: '直达回滚与审批区', href: validationRollbackHref, tone: 'border-rose-400/30 bg-rose-400/10 text-rose-100' },
        { label: '去执行监控室验证', href: validationMonitorHref, tone: 'border-white/12 bg-white/5 text-white' },
      ];
    }
    if (validationFeedback.conclusion.label === '正在改善') {
      return [
        { label: '去执行监控室继续观察', href: validationMonitorHref, tone: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100' },
        { label: '回 Trace 看处理上下文', href: validationTraceHref, tone: 'border-white/12 bg-white/5 text-white' },
      ];
    }
    return [
      { label: '去执行监控室继续观察', href: validationMonitorHref, tone: 'border-white/12 bg-white/5 text-white' },
      { label: '回 Trace 看处理状态', href: validationTraceHref, tone: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100' },
    ];
  }, [validationFeedback, validationMonitorHref, validationRollbackHref, validationTraceHref]);

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="trace"
        step="主线第 5 步 · 日志审核"
        title="先确认问题发生在哪，再决定要不要进 Trace"
        description="日志审核不是独立运维后台，而是复盘前的证据筛选页。先缩小范围，再决定是否继续进入 Trace。"
        previous={{ href: '/operations/autopilot/alerts', label: '回到告警中心' }}
        next={{ href: '/operations/autopilot/trace', label: '前往 Trace 复盘' }}
        actions={
          <>
            <Link href="/operations/autopilot/alerts" className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10">
              告警中心
              <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
          </>
        }
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="当前结果数" value={String(stats.total)} helper="本次过滤条件下命中的日志数" />
        <SummaryCard label="WARN" value={String(stats.warn)} helper="需要关注但不一定阻断执行" accent="text-amber-300" />
        <SummaryCard label="ERROR / SECURITY" value={String(stats.error)} helper="高风险或明显异常事件" accent="text-rose-300" />
        <SummaryCard label="重放成功率" value={`${stats.replaySuccessRate}%`} helper="DLQ replay 的恢复成功率" accent="text-cyan-300" />
      </section>

      {validationFeedback ? (
        <section className="rounded-[28px] border border-emerald-400/20 bg-emerald-400/10 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-emerald-200">Validation Feedback</div>
              <div className="mt-2 text-lg font-semibold text-white">正在回看处理后的异常变化</div>
              <div className="mt-2 text-sm leading-7 text-slate-100">
                当前回流来自 <span className="font-mono text-emerald-100">{validationFeedback.traceId}</span>。
                优先确认异常级别、命中数量、相关任务日志是否已经回落。
              </div>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs ${validationStatusTone(validationFeedback.status)}`}>
              {validationStatusLabel(validationFeedback.status)}
            </span>
          </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-200">
              {validationFeedback.mode ? <span className="rounded-full bg-white/5 px-3 py-1">mode {validationFeedback.mode}</span> : null}
              {validationFeedback.stage ? <span className="rounded-full bg-white/5 px-3 py-1">stage {validationFeedback.stage}</span> : null}
              {validationFeedback.origin ? <span className="rounded-full bg-white/5 px-3 py-1">origin {validationFeedback.origin}</span> : null}
              {validationFeedback.taskId ? <span className="rounded-full bg-white/5 px-3 py-1">task {validationFeedback.taskId}</span> : null}
              {validationFeedback.nodeId ? <span className="rounded-full bg-white/5 px-3 py-1">node {validationFeedback.nodeId}</span> : null}
              {validationFeedback.queue ? <span className="rounded-full bg-white/5 px-3 py-1">queue {validationFeedback.queue}</span> : null}
              {validationFeedback.at ? <span className="rounded-full bg-white/5 px-3 py-1">return {asInputDateTime(validationFeedback.at).replace('T', ' ')}</span> : null}
              {validationFeedback.baselineAt ? <span className="rounded-full bg-white/5 px-3 py-1">baseline {asInputDateTime(validationFeedback.baselineAt).replace('T', ' ')}</span> : null}
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs ${validationFeedback.conclusion.tone}`}>
                  {validationFeedback.conclusion.label}
                </span>
                <span className="text-sm text-slate-100">{validationFeedback.conclusion.summary}</span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {validationActions.map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className={`rounded-2xl border px-4 py-2.5 text-sm font-medium transition hover:opacity-90 ${action.tone}`}
                >
                  {action.label}
                </Link>
              ))}
            </div>
            {validationFeedback.trends.length ? (
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {validationFeedback.trends.map((item) => (
                  <span key={item.label} className={`rounded-full px-3 py-1 ${item.tone}`}>
                    {item.label}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
      ) : null}

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
          <FilterField label="关键字">
            <input
              type="text"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="event / trace / campaign"
              className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
            />
          </FilterField>
          <FilterField label="Trace">
            <input
              type="text"
              value={traceId}
              onChange={(event) => setTraceId(event.target.value)}
              placeholder="trc_xxx"
              className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
            />
          </FilterField>
          <FilterField label="Source Queue">
            <select
              value={sourceQueue}
              onChange={(event) => setSourceQueue(event.target.value)}
              className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
            >
              <option value="">ALL</option>
              {SOURCE_QUEUES.map((queue) => (
                <option key={queue} value={queue}>{queue}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Module">
            <select
              value={moduleFilter}
              onChange={(event) => setModuleFilter(event.target.value as 'ALL' | AutopilotAuditLogModule)}
              className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
            >
              <option value="ALL">ALL</option>
              <option value="PATROL">PATROL</option>
              <option value="DISPATCHER">DISPATCHER</option>
              <option value="ECHOER">ECHOER</option>
              <option value="CATCHER">CATCHER</option>
              <option value="WEBHOOK">WEBHOOK</option>
              <option value="FLEET">FLEET</option>
              <option value="BEHAVIOR">BEHAVIOR</option>
              <option value="AUTOPILOT">AUTOPILOT</option>
            </select>
          </FilterField>
          <FilterField label="Level">
            <select
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value as 'ALL' | AutopilotAuditLogLevel)}
              className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
            >
              <option value="ALL">ALL</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
              <option value="SECURITY">SECURITY</option>
            </select>
          </FilterField>
          <FilterField label="Node ID">
            <input
              type="text"
              value={nodeFilter}
              onChange={(event) => setNodeFilter(event.target.value)}
              placeholder="node-xxx"
              className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
            />
          </FilterField>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <FilterField label="From">
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
            />
          </FilterField>
          <FilterField label="To">
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
            />
          </FilterField>
          <FilterField label="过滤模式">
            <label className="flex h-[50px] items-center gap-3 rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={errorsOnly}
                onChange={(event) => setErrorsOnly(event.target.checked)}
                className="h-4 w-4 rounded border-slate-500 bg-slate-900"
              />
              只看异常（WARN / ERROR / SECURITY）
            </label>
          </FilterField>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="xl:col-span-2 rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
          <div className="grid grid-cols-[140px_90px_110px_120px_1fr] gap-2 border-b border-white/10 px-4 py-3 text-xs font-semibold text-slate-500">
            <span>时间</span>
            <span>级别</span>
            <span>模块</span>
            <span>节点</span>
            <span>事件 / 信息</span>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {query.isLoading ? (
              <div className="px-4 py-6 text-sm text-slate-400">加载中...</div>
            ) : logs.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-400">暂无数据</div>
            ) : (
              logs.map((item: AutopilotAuditLogItem) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className="grid w-full grid-cols-[140px_90px_110px_120px_1fr] gap-2 border-b border-white/6 px-4 py-3 text-left text-xs transition hover:bg-white/5"
                  style={{
                    backgroundColor: selected?.id === item.id ? 'rgba(56,189,248,0.08)' : 'transparent',
                  }}
                >
                  <span className="text-slate-300">{asInputDateTime(item.ts).replace('T', ' ')}</span>
                  <span
                    className="inline-flex h-fit w-fit rounded px-2 py-0.5 font-medium"
                    style={{ color: levelColor(item.level), backgroundColor: levelBg(item.level) }}
                  >
                    {item.level}
                  </span>
                  <span className="text-slate-300">{item.module}</span>
                  <span className="text-slate-300">{item.nodeId ?? '--'}</span>
                  <span className="text-slate-100">
                    <span className="mr-2 font-medium text-cyan-200">{item.eventType}</span>
                    {item.message}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div id="detail" className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
            <h2 className="text-lg font-semibold text-white">日志详情</h2>
            {!selected ? (
              <p className="mt-3 text-sm text-slate-400">暂无选中项</p>
            ) : (
              <div className="mt-4 space-y-3 text-sm">
                <DetailLine label="Risk family" value={selectedRiskFamily} />
                <DetailLine label="Autonomy" value={selectedAutonomy} />
                <DetailLine label="Trace" value={selected.traceId ?? '--'} mono />
                <DetailLine label="Campaign" value={selected.campaignId ?? '--'} />
                <DetailLine label="Queue" value={selected.sourceQueue ?? '--'} />
                <DetailLine label="Task" value={selected.taskId ?? '--'} />
                <DetailLine label="Stage" value={selected.stage ?? '--'} />

                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Message</div>
                  <div className="mt-2 text-sm leading-7 text-slate-100">{selected.message}</div>
                </div>

                {selectedTraceHref ? (
                  <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-cyan-200">Recovery Handoff</div>
                    <div className="mt-2 text-sm leading-7 text-slate-100">
                      这条日志已经能定位到 trace，可直接带着当前时间窗、队列和异常过滤继续进入复盘或回滚。
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={selectedTraceHref}
                        className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
                      >
                        去 Trace 中心继续排障
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <Link
                        href={`${selectedTraceHref}#rollback-approval`}
                        className="inline-flex items-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-400/15"
                      >
                        直达回滚与审批区
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <AlertTriangle className="h-4 w-4 text-amber-300" />
              使用建议
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
              <li>先用过滤条件缩小范围，再看异常等级和模块归属。</li>
              <li>如果日志已经能定位到 trace，就不要停在这里，直接跳去 Trace 做完整复盘。</li>
              <li>当 WARN 和 ERROR 同时抬升时，优先检查 autopilot 与审批链之间的衔接问题。</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  accent = 'text-white',
}: {
  label: string;
  value: string;
  helper: string;
  accent?: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className={`mt-3 text-3xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-2 text-sm text-slate-300">{helper}</div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{label}</div>
      {children}
    </div>
  );
}

function DetailLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 text-sm text-slate-100 ${mono ? 'font-mono break-all' : ''}`}>{value}</div>
    </div>
  );
}
