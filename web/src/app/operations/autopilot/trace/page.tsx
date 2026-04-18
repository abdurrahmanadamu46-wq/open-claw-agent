'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, History, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
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
  type AiKernelIndustryKbReference,
  type AiKernelIndustryKbSnapshot,
  type AiKernelReportPayload,
  type IndustryKnowledgePackReadiness,
  type KernelRollbackResponse,
  type KernelApprovalJournalItem,
} from '@/services/endpoints/ai-subservice';

const QUEUES = ['', 'radar_sniffing_queue', 'content_forge_queue', 'matrix_dispatch_queue', 'lead_harvest_queue'];
const LOBSTER_ROLE_ORDER = ['radar', 'strategist', 'inkwriter', 'visualizer', 'dispatcher', 'echoer', 'catcher', 'abacus', 'followup'];
const TRACE_CLOSEOUT_STORAGE_KEY = 'clawcommerce.trace-closeout-receipts.v1';
const TRACE_CLOSEOUT_RETENTION_SETTINGS_KEY = 'clawcommerce.trace-closeout-retention-settings.v1';
const TRACE_CLOSEOUT_RETENTION_MAX = 30;
const TRACE_CLOSEOUT_RETENTION_DAYS = 30;

type TraceCloseoutRetentionSettings = {
  maxItems: number;
  maxDays: number;
};

type TraceCloseoutReceipt = {
  traceId: string;
  recordedAt: string;
  closeoutLabel: string;
  closeoutSummary: string;
  validationStatus?: string;
  validationStage?: string;
  validationOrigin?: string;
  taskId?: string;
  nodeId?: string;
  queue?: string;
  monitorValidationCode?: string;
  monitorValidationAt?: string;
  logValidationCode?: string;
  logValidationAt?: string;
};

type CloseoutSummaryAudience = 'project_control' | 'qa' | 'generic';
type TraceActionTone = 'neutral' | 'cyan' | 'emerald' | 'amber' | 'rose';

const TRACE_ACTION_TONES: Record<TraceActionTone, string> = {
  neutral: 'border-white/12 bg-white/5 text-white',
  cyan: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
  emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
  amber: 'border-amber-400/25 bg-amber-400/10 text-amber-100',
  rose: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
};

function traceActionClass(tone: TraceActionTone, shape: 'button' | 'pill' = 'button'): string {
  const base =
    shape === 'pill'
      ? 'inline-flex items-center rounded-full border px-3 py-1 text-xs transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40'
      : 'inline-flex items-center justify-center rounded-2xl border px-4 py-2.5 text-sm font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';
  return `${base} ${TRACE_ACTION_TONES[tone]}`;
}

function getTraceCloseoutRetentionPresets() {
  return [
    {
      key: 'compact',
      label: '轻量回看',
      description: '适合个人短期排障，只保留最近一周的小样本。',
      maxItems: 10,
      maxDays: 7,
    },
    {
      key: 'default',
      label: '默认保留',
      description: '适合当前收尾阶段，兼顾回看和清爽度。',
      maxItems: 30,
      maxDays: 30,
    },
    {
      key: 'audit',
      label: '审计长留',
      description: '适合需要更长观察周期的联调或验收阶段。',
      maxItems: 50,
      maxDays: 90,
    },
  ] as const;
}

function resolveTraceCloseoutRetentionPreset(settings: TraceCloseoutRetentionSettings) {
  return getTraceCloseoutRetentionPresets().find(
    (item) => item.maxItems === settings.maxItems && item.maxDays === settings.maxDays,
  ) ?? null;
}

function normalizeTraceCloseoutRetentionSettings(
  input?: Partial<TraceCloseoutRetentionSettings>,
): TraceCloseoutRetentionSettings {
  const maxItems = Number(input?.maxItems ?? TRACE_CLOSEOUT_RETENTION_MAX);
  const maxDays = Number(input?.maxDays ?? TRACE_CLOSEOUT_RETENTION_DAYS);
  return {
    maxItems: Number.isFinite(maxItems) ? Math.min(Math.max(Math.round(maxItems), 5), 100) : TRACE_CLOSEOUT_RETENTION_MAX,
    maxDays: Number.isFinite(maxDays) ? Math.min(Math.max(Math.round(maxDays), 1), 365) : TRACE_CLOSEOUT_RETENTION_DAYS,
  };
}

function loadTraceCloseoutRetentionSettings(): TraceCloseoutRetentionSettings {
  if (typeof window === 'undefined') {
    return normalizeTraceCloseoutRetentionSettings();
  }
  try {
    const raw = window.localStorage.getItem(TRACE_CLOSEOUT_RETENTION_SETTINGS_KEY);
    const parsed = raw ? ((JSON.parse(raw) as Partial<TraceCloseoutRetentionSettings>) ?? {}) : {};
    const normalized = normalizeTraceCloseoutRetentionSettings(parsed);
    window.localStorage.setItem(TRACE_CLOSEOUT_RETENTION_SETTINGS_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return normalizeTraceCloseoutRetentionSettings();
  }
}

function persistTraceCloseoutRetentionSettings(settings: TraceCloseoutRetentionSettings): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeTraceCloseoutRetentionSettings(settings);
  window.localStorage.setItem(TRACE_CLOSEOUT_RETENTION_SETTINGS_KEY, JSON.stringify(normalized));
}

function pruneTraceCloseoutReceipts(
  records: Record<string, TraceCloseoutReceipt>,
  settings: TraceCloseoutRetentionSettings = loadTraceCloseoutRetentionSettings(),
): Record<string, TraceCloseoutReceipt> {
  const now = Date.now();
  const maxAgeMs = settings.maxDays * 24 * 60 * 60 * 1000;
  const recent = Object.values(records)
    .filter((receipt) => {
      if (!receipt?.traceId || !receipt?.recordedAt || !receipt?.closeoutLabel || !receipt?.closeoutSummary) return false;
      const ts = Date.parse(receipt.recordedAt);
      return Number.isFinite(ts) && now - ts <= maxAgeMs;
    })
    .sort((left, right) => {
      const leftTs = Date.parse(left.recordedAt || '');
      const rightTs = Date.parse(right.recordedAt || '');
      return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
    })
    .slice(0, settings.maxItems);
  return recent.reduce<Record<string, TraceCloseoutReceipt>>((acc, receipt) => {
    if (!acc[receipt.traceId]) {
      acc[receipt.traceId] = receipt;
    }
    return acc;
  }, {});
}

function loadTraceCloseoutReceipts(): Record<string, TraceCloseoutReceipt> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(TRACE_CLOSEOUT_STORAGE_KEY);
    const parsed = raw ? ((JSON.parse(raw) as Record<string, TraceCloseoutReceipt>) ?? {}) : {};
    const normalized = pruneTraceCloseoutReceipts(parsed, loadTraceCloseoutRetentionSettings());
    window.localStorage.setItem(TRACE_CLOSEOUT_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return {};
  }
}

function persistTraceCloseoutReceipts(records: Record<string, TraceCloseoutReceipt>): void {
  if (typeof window === 'undefined') return;
  const normalized = pruneTraceCloseoutReceipts(records, loadTraceCloseoutRetentionSettings());
  window.localStorage.setItem(TRACE_CLOSEOUT_STORAGE_KEY, JSON.stringify(normalized));
}

function downloadCloseoutJson(filename: string, payload: unknown): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toSortedCloseoutReceipts(records: Record<string, TraceCloseoutReceipt>): TraceCloseoutReceipt[] {
  return Object.values(records).sort((left, right) => {
    const leftTs = Date.parse(left.recordedAt || '');
    const rightTs = Date.parse(right.recordedAt || '');
    return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
  });
}

function closeoutFilterLabel(filter: 'all' | 'current' | 'completed' | 'other'): string {
  if (filter === 'current') return '当前 trace';
  if (filter === 'completed') return '已完成';
  if (filter === 'other') return '非完成';
  return '全部';
}

function summarizeCloseoutCounts(receipts: TraceCloseoutReceipt[]) {
  return receipts.reduce(
    (acc, receipt) => {
      acc.total += 1;
      if (receipt.closeoutLabel === '闭环完成') {
        acc.completed += 1;
      } else if (receipt.closeoutLabel === '接近完成') {
        acc.nearDone += 1;
      } else {
        acc.other += 1;
      }
      return acc;
    },
    { total: 0, completed: 0, nearDone: 0, other: 0 },
  );
}

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

function asInputDateTime(value?: string | null): string {
  if (!value) return '';
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseBooleanParam(value: string | null): boolean {
  return value === '1' || value === 'true';
}

function buildLogAuditHref(input: {
  traceId: string;
  from?: string;
  to?: string;
  errorsOnly?: boolean;
  sourceQueue?: string;
  keyword?: string;
  validation?: Record<string, string | undefined>;
}): string {
  const params = new URLSearchParams({
    traceId: input.traceId,
  });
  if (input.from) params.set('from', input.from);
  if (input.to) params.set('to', input.to);
  if (input.errorsOnly) params.set('errorsOnly', '1');
  if (input.sourceQueue) params.set('sourceQueue', input.sourceQueue);
  if (input.keyword) params.set('keyword', input.keyword);
  Object.entries(input.validation || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return `/operations/log-audit?${params.toString()}`;
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

function buildTraceHref(input: {
  traceId: string;
  sourceQueue?: string;
  validation?: Record<string, string | undefined>;
}): string {
  const params = new URLSearchParams({
    traceId: input.traceId,
  });
  if (input.sourceQueue) params.set('sourceQueue', input.sourceQueue);
  Object.entries(input.validation || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return `/operations/autopilot/trace?${params.toString()}`;
}

function validationSourceTone(code?: string): string {
  if (code === 'recovered') return 'bg-emerald-500/15 text-emerald-200';
  if (code === 'improving') return 'bg-cyan-400/10 text-cyan-100';
  if (code === 'not_recovered') return 'bg-rose-500/15 text-rose-200';
  return 'bg-white/5 text-slate-200';
}

function validationSourceLabel(code?: string): string {
  if (code === 'recovered') return '已恢复';
  if (code === 'improving') return '正在改善';
  if (code === 'not_recovered') return '未恢复';
  return '继续观察';
}

function resolveTraceCloseoutState(input: {
  monitorCode?: string;
  logCode?: string;
}): {
  label: string;
  tone: string;
  summary: string;
} | null {
  const codes = [input.monitorCode, input.logCode].filter(Boolean) as string[];
  if (!codes.length) return null;
  if (codes.length >= 2 && codes.every((item) => item === 'recovered')) {
    return {
      label: '闭环完成',
      tone: 'bg-emerald-500/15 text-emerald-200',
      summary: '监控和日志都已经判成已恢复，这次处理闭环可以进入收尾留痕。',
    };
  }
  if (codes.includes('not_recovered')) {
    return {
      label: '闭环未完成',
      tone: 'bg-rose-500/15 text-rose-200',
      summary: '至少有一侧仍判定未恢复，这次处理还不能算完成，建议继续排障或回滚。',
    };
  }
  if (codes.includes('improving') && codes.includes('recovered')) {
    return {
      label: '接近完成',
      tone: 'bg-cyan-400/10 text-cyan-100',
      summary: '一侧已经恢复，另一侧仍在改善，建议再观察一轮后确认是否收尾。',
    };
  }
  return {
    label: '待补齐验证',
    tone: 'bg-white/5 text-slate-200',
    summary: '当前只有单侧验证或仍在观察中，建议补齐监控与日志两侧验证后再收尾。',
  };
}

function resolveTraceCloseoutActionCopy(label: string): Array<{
  key: string;
  kind: 'monitor' | 'log' | 'log_detail' | 'rollback' | 'alerts';
  label: string;
  tone: string;
}> {
  if (label === '闭环完成') {
    return [
      {
        key: 'monitor-close',
        kind: 'monitor',
        label: '回监控室做最终确认',
        tone: 'border-white/12 bg-white/5 text-white',
      },
      {
        key: 'log-detail-close',
        kind: 'log_detail',
        label: '回日志详情留痕',
        tone: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
      },
      {
        key: 'alerts-close',
        kind: 'alerts',
        label: '检查告警是否清空',
        tone: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
      },
    ];
  }
  if (label === '闭环未完成') {
    return [
      {
        key: 'rollback',
        kind: 'rollback',
        label: '回回滚与审批区继续处理',
        tone: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
      },
      {
        key: 'monitor',
        kind: 'monitor',
        label: '回监控继续盯节点',
        tone: 'border-white/12 bg-white/5 text-white',
      },
      {
        key: 'log',
        kind: 'log',
        label: '回日志继续看异常',
        tone: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
      },
    ];
  }
  if (label === '接近完成') {
    return [
      {
        key: 'monitor',
        kind: 'monitor',
        label: '回监控再观察一轮',
        tone: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
      },
      {
        key: 'log',
        kind: 'log',
        label: '回日志确认异常继续回落',
        tone: 'border-white/12 bg-white/5 text-white',
      },
    ];
  }
  return [
    {
      key: 'monitor',
      kind: 'monitor',
      label: '补监控侧验证',
      tone: 'border-white/12 bg-white/5 text-white',
    },
    {
      key: 'log',
      kind: 'log',
      label: '补日志侧验证',
      tone: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
    },
  ];
}

function riskBadgeStyle(riskLevel: string) {
  const level = riskLevel.toUpperCase();
  if (level === 'P0' || level === 'P1') return 'border-rose-500/35 bg-rose-500/10 text-rose-200';
  if (level === 'P2') return 'border-amber-500/35 bg-amber-500/10 text-amber-200';
  return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200';
}

function TracePageInner() {
  const searchParams = useSearchParams();
  const initialTrace = searchParams?.get('traceId') ?? '';
  const initialFromInput = asInputDateTime(searchParams?.get('from'));
  const initialToInput = asInputDateTime(searchParams?.get('to'));
  const initialErrorsOnly = parseBooleanParam(searchParams?.get('errorsOnly'));
  const initialSourceQueue = searchParams?.get('sourceQueue') ?? '';
  const baselineHeartbeatAlerts = searchParams?.get('baselineHeartbeatAlerts') ?? '';
  const baselineReceiptLagAlerts = searchParams?.get('baselineReceiptLagAlerts') ?? '';
  const baselineCriticalAlerts = searchParams?.get('baselineCriticalAlerts') ?? '';
  const baselineLogTotal = searchParams?.get('baselineLogTotal') ?? '';
  const baselineLogWarnCount = searchParams?.get('baselineLogWarnCount') ?? '';
  const baselineLogErrorCount = searchParams?.get('baselineLogErrorCount') ?? '';
  const validationOrigin = searchParams?.get('validationOrigin') ?? '';
  const baselineCapturedAt = searchParams?.get('baselineCapturedAt') ?? '';
  const monitorValidationCode = searchParams?.get('monitorValidationCode') ?? '';
  const monitorValidationAt = searchParams?.get('monitorValidationAt') ?? '';
  const logValidationCode = searchParams?.get('logValidationCode') ?? '';
  const logValidationAt = searchParams?.get('logValidationAt') ?? '';

  const [traceIdInput, setTraceIdInput] = useState(initialTrace);
  const [fromInput, setFromInput] = useState(initialFromInput);
  const [toInput, setToInput] = useState(initialToInput);
  const [errorsOnlyInput, setErrorsOnlyInput] = useState(initialErrorsOnly);
  const [sourceQueueInput, setSourceQueueInput] = useState(initialSourceQueue);

  const [traceId, setTraceId] = useState(initialTrace);
  const [from, setFrom] = useState<string | undefined>(toIso(initialFromInput));
  const [to, setTo] = useState<string | undefined>(toIso(initialToInput));
  const [errorsOnly, setErrorsOnly] = useState(initialErrorsOnly);
  const [sourceQueue, setSourceQueue] = useState<string | undefined>(initialSourceQueue || undefined);

  const [rollbackStage, setRollbackStage] = useState<'preflight' | 'postgraph'>('preflight');
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [approvalId, setApprovalId] = useState('');
  const [rollbackPreview, setRollbackPreview] = useState<KernelRollbackResponse | null>(null);
  const [rollbackResult, setRollbackResult] = useState<KernelRollbackResponse | null>(null);
  const [showKbDetails, setShowKbDetails] = useState(false);
  const [closeoutReceipts, setCloseoutReceipts] = useState<Record<string, TraceCloseoutReceipt>>({});
  const [closeoutFilter, setCloseoutFilter] = useState<'all' | 'current' | 'completed' | 'other'>('all');
  const [retentionSettings, setRetentionSettings] = useState<TraceCloseoutRetentionSettings>(
    normalizeTraceCloseoutRetentionSettings(),
  );

  useEffect(() => {
    setTraceIdInput(initialTrace);
    setFromInput(initialFromInput);
    setToInput(initialToInput);
    setErrorsOnlyInput(initialErrorsOnly);
    setSourceQueueInput(initialSourceQueue);
    setTraceId(initialTrace);
    setFrom(toIso(initialFromInput));
    setTo(toIso(initialToInput));
    setErrorsOnly(initialErrorsOnly);
    setSourceQueue(initialSourceQueue || undefined);
    setRollbackPreview(null);
    setRollbackResult(null);
  }, [initialErrorsOnly, initialFromInput, initialSourceQueue, initialToInput, initialTrace]);

  useEffect(() => {
    setRetentionSettings(loadTraceCloseoutRetentionSettings());
    setCloseoutReceipts(loadTraceCloseoutReceipts());
  }, []);

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
  const kernelReport: AiKernelReportPayload = kernelQuery.data?.kernel_report ?? {};
  const riskTaxonomy = kernelReport.risk_taxonomy ?? {};
  const autonomy = kernelReport.autonomy ?? {};
  const industryKb: AiKernelIndustryKbSnapshot = kernelQuery.data?.industry_kb ?? traceData?.industry_kb ?? {};
  const industryKbMetrics = industryKb.metrics ?? {};
  const industryKbReferences: AiKernelIndustryKbReference[] = industryKbMetrics.references ?? [];
  const industryKnowledgePacks: IndustryKnowledgePackReadiness = kernelReport.industry_knowledge_packs ?? {};
  const industryKnowledgePackRoleRows = useMemo(() => {
    const rolePacks = industryKnowledgePacks.role_packs ?? {};
    if (Object.keys(rolePacks).length === 0) {
      return [];
    }
    const roleIds = [
      ...LOBSTER_ROLE_ORDER,
      ...Object.keys(rolePacks).filter((roleId) => !LOBSTER_ROLE_ORDER.includes(roleId)),
    ];
    return roleIds.map((roleId) => {
      const row = rolePacks[roleId] ?? {};
      const packs = row.packs ?? {};
      const packTypes = Object.keys(packs);
      const itemCount = packTypes.reduce((sum, packType) => sum + Number(packs[packType]?.item_count ?? 0), 0);
      const caseCount = packTypes.reduce((sum, packType) => sum + Number(packs[packType]?.case_count ?? 0), 0);
      return {
        roleId,
        ready: Boolean(row.ready),
        packCount: packTypes.length,
        itemCount,
        caseCount,
        path: String(row.path ?? ''),
      };
    });
  }, [industryKnowledgePacks.role_packs]);

  const approvalDecision = String(approvalStatusQuery.data?.status?.decision ?? 'pending').toLowerCase();
  const riskLevel = String(kernelReport.risk_level ?? 'P2');
  const riskFamily = String(riskTaxonomy.primary_family ?? 'single_agent');
  const autonomyRoute = String(autonomy.route ?? 'unknown');
  const score = Number(kernelReport.runtime?.score ?? kernelReport.score ?? 0);
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
      setRollbackPreview(result);
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
      setRollbackResult(result);
      triggerSuccessToast(result.pending_approval ? '审批尚未通过，系统继续轮询状态' : '回滚执行成功');
      await Promise.all([traceQuery.refetch(), kernelQuery.refetch(), metricsQuery.refetch(), approvalStatusQuery.refetch()]);
    } catch (error) {
      triggerErrorToast(extractErrorMessage(error));
    } finally {
      setRollbackBusy(false);
    }
  }

  const taskStates = useMemo(() => traceData?.taskStates ?? [], [traceData?.taskStates]);
  const dlqItems = useMemo(() => traceData?.dlqItems ?? [], [traceData?.dlqItems]);
  const replayAudits = useMemo(() => traceData?.replayAudits ?? [], [traceData?.replayAudits]);
  const primaryTaskId = useMemo(
    () => String(taskStates[0]?.taskId ?? dlqItems[0]?.taskId ?? ''),
    [dlqItems, taskStates],
  );
  const primaryNodeId = useMemo(
    () => String(taskStates.find((item) => item.nodeId)?.nodeId ?? ''),
    [taskStates],
  );
  const resolvedSourceQueue = useMemo(
    () => String(sourceQueue ?? taskStates[0]?.sourceQueue ?? dlqItems[0]?.sourceQueue ?? ''),
    [dlqItems, sourceQueue, taskStates],
  );
  const validationContext = useMemo(() => {
    const base = {
      validationTraceId: traceId || undefined,
      validationTaskId: primaryTaskId || undefined,
      validationNodeId: primaryNodeId || undefined,
      validationQueue: resolvedSourceQueue || undefined,
      validationAt: monitorValidationAt || logValidationAt || undefined,
      validationOrigin: validationOrigin || undefined,
      baselineCapturedAt: baselineCapturedAt || undefined,
      baselineHeartbeatAlerts: baselineHeartbeatAlerts || undefined,
      baselineReceiptLagAlerts: baselineReceiptLagAlerts || undefined,
      baselineCriticalAlerts: baselineCriticalAlerts || undefined,
      baselineLogTotal: baselineLogTotal || undefined,
      baselineLogWarnCount: baselineLogWarnCount || undefined,
      baselineLogErrorCount: baselineLogErrorCount || undefined,
      monitorValidationCode: monitorValidationCode || undefined,
      monitorValidationAt: monitorValidationAt || undefined,
      logValidationCode: logValidationCode || undefined,
      logValidationAt: logValidationAt || undefined,
    };
    if (rollbackResult) {
      return {
        ...base,
        validationMode: 'rollback',
        validationStatus: rollbackResult.pending_approval ? 'pending_approval' : 'executed',
        validationStage: rollbackStage,
      };
    }
    if (rollbackPreview) {
      return {
        ...base,
        validationMode: 'preview',
        validationStatus: 'dry_run_ready',
        validationStage: rollbackStage,
      };
    }
    return {
      ...base,
      validationMode: 'trace_review',
      validationStatus: 'observe',
      validationStage: rollbackStage,
    };
  }, [
    baselineCapturedAt,
    baselineCriticalAlerts,
    baselineHeartbeatAlerts,
    baselineLogErrorCount,
    baselineLogTotal,
    baselineLogWarnCount,
    baselineReceiptLagAlerts,
    logValidationAt,
    logValidationCode,
    monitorValidationAt,
    monitorValidationCode,
    primaryNodeId,
    primaryTaskId,
    resolvedSourceQueue,
    rollbackPreview,
    rollbackResult,
    rollbackStage,
    traceId,
    validationOrigin,
  ]);
  const logAuditHref = useMemo(() => {
    if (!traceId) return '/operations/log-audit';
    return buildLogAuditHref({
      traceId,
      from,
      to,
      errorsOnly,
      sourceQueue: resolvedSourceQueue || undefined,
      keyword: primaryTaskId || undefined,
      validation: validationContext,
    });
  }, [errorsOnly, from, primaryTaskId, resolvedSourceQueue, to, traceId, validationContext]);
  const monitorHref = useMemo(
    () => buildMonitorHref({
      taskId: primaryTaskId || undefined,
      nodeId: primaryNodeId || undefined,
      validation: validationContext,
    }),
    [primaryNodeId, primaryTaskId, validationContext],
  );
  const closeoutState = useMemo(() => {
    const state = resolveTraceCloseoutState({
      monitorCode: monitorValidationCode || undefined,
      logCode: logValidationCode || undefined,
    });
    if (!state) return null;
    return {
      ...state,
      sources: [
        monitorValidationCode
          ? { label: 'monitor', code: monitorValidationCode, at: monitorValidationAt }
          : null,
        logValidationCode
          ? { label: 'log-audit', code: logValidationCode, at: logValidationAt }
          : null,
      ].filter((item): item is { label: string; code: string; at: string } => item !== null),
    };
  }, [logValidationAt, logValidationCode, monitorValidationAt, monitorValidationCode]);
  const closeoutActions = useMemo(() => {
    if (!closeoutState) return [];
    return resolveTraceCloseoutActionCopy(closeoutState.label).map((item) => {
      if (item.kind === 'monitor') {
        return { ...item, href: monitorHref };
      }
      if (item.kind === 'log') {
        return { ...item, href: logAuditHref };
      }
      if (item.kind === 'log_detail') {
        return { ...item, href: `${logAuditHref}#detail` };
      }
      if (item.kind === 'rollback') {
        return { ...item, href: '#rollback-approval' };
      }
      return { ...item, href: '/operations/autopilot/alerts' };
    });
  }, [closeoutState, logAuditHref, monitorHref]);
  function saveCurrentCloseoutReceipt() {
    if (!nextCloseoutReceipt) return;
    setCloseoutReceipts((prev) => {
      const next = { ...prev, [nextCloseoutReceipt.traceId]: nextCloseoutReceipt };
      persistTraceCloseoutReceipts(next);
      return next;
    });
    triggerSuccessToast('已写入本地收尾记录');
  }

  function clearCurrentCloseoutReceipt() {
    if (!activeTraceKey || !currentCloseoutReceipt) return;
    setCloseoutReceipts((prev) => {
      const next = { ...prev };
      delete next[activeTraceKey];
      persistTraceCloseoutReceipts(next);
      return next;
    });
    triggerSuccessToast('已清除本地收尾记录');
  }

  function removeCloseoutReceipt(traceIdToRemove: string) {
    setCloseoutReceipts((prev) => {
      if (!prev[traceIdToRemove]) return prev;
      const next = { ...prev };
      delete next[traceIdToRemove];
      persistTraceCloseoutReceipts(next);
      return next;
    });
    triggerSuccessToast(`已移除 ${traceIdToRemove} 的本地收尾记录`);
  }

  function clearAllCloseoutReceipts() {
    setCloseoutReceipts({});
    persistTraceCloseoutReceipts({});
    triggerSuccessToast('已清空最近收尾记录');
  }

  function updateTraceCloseoutRetentionSettings(patch: Partial<TraceCloseoutRetentionSettings>) {
    const nextSettings = normalizeTraceCloseoutRetentionSettings({
      ...retentionSettings,
      ...patch,
    });
    setRetentionSettings(nextSettings);
    persistTraceCloseoutRetentionSettings(nextSettings);
    setCloseoutReceipts((prev) => {
      const next = pruneTraceCloseoutReceipts(prev, nextSettings);
      persistTraceCloseoutReceipts(next);
      return next;
    });
    triggerSuccessToast(`已更新收尾记录保留策略：${nextSettings.maxItems} 条 / ${nextSettings.maxDays} 天`);
  }

  async function copyCloseoutReceipt(receipt: TraceCloseoutReceipt) {
    const content = [
      `Trace: ${receipt.traceId}`,
      `Recorded At: ${receipt.recordedAt}`,
      `Closeout: ${receipt.closeoutLabel}`,
      receipt.taskId ? `Task: ${receipt.taskId}` : null,
      receipt.nodeId ? `Node: ${receipt.nodeId}` : null,
      receipt.queue ? `Queue: ${receipt.queue}` : null,
      receipt.monitorValidationCode ? `Monitor: ${receipt.monitorValidationCode}` : null,
      receipt.logValidationCode ? `Log Audit: ${receipt.logValidationCode}` : null,
      '',
      receipt.closeoutSummary,
      '',
      'Raw JSON:',
      JSON.stringify(receipt, null, 2),
    ]
      .filter((line) => line !== null)
      .join('\n');
    try {
      await navigator.clipboard.writeText(content);
      triggerSuccessToast(`已复制 ${receipt.traceId} 的收尾记录`);
    } catch {
      triggerErrorToast('复制收尾记录失败，请检查浏览器剪贴板权限');
    }
  }

  function formatCloseoutSummary(
    receipts: TraceCloseoutReceipt[],
    audience: CloseoutSummaryAudience,
    options?: { filter?: 'all' | 'current' | 'completed' | 'other' },
  ): string {
    const counts = summarizeCloseoutCounts(receipts);
    const filterLabel = closeoutFilterLabel(options?.filter || 'all');
    const header =
      audience === 'project_control'
        ? '项目总控收尾摘要'
        : audience === 'qa'
          ? 'QA 验证收尾摘要'
          : '收尾摘要';
    const intro =
      audience === 'project_control'
        ? '用于快速汇报当前收尾质量和闭环结果。'
        : audience === 'qa'
          ? '用于快速确认验证结论、监控与日志状态。'
          : '用于快速回顾单次 Trace 的收尾结果。';
    const lines = [
      header,
      `生成时间: ${new Date().toLocaleString('zh-CN')}`,
      `筛选范围: ${filterLabel}`,
      `记录总数: ${counts.total}`,
      `闭环完成: ${counts.completed}`,
      `接近完成: ${counts.nearDone}`,
      `其他状态: ${counts.other}`,
      intro,
      '',
      '明细:',
      ...receipts.map((receipt, index) =>
        [
          `${index + 1}. ${receipt.traceId} / ${receipt.closeoutLabel} / ${localText(receipt.recordedAt)}`,
          receipt.queue ? `   queue: ${receipt.queue}` : null,
          receipt.taskId ? `   task: ${receipt.taskId}` : null,
          receipt.nodeId ? `   node: ${receipt.nodeId}` : null,
          receipt.monitorValidationCode ? `   monitor: ${validationSourceLabel(receipt.monitorValidationCode)}` : null,
          receipt.logValidationCode ? `   log-audit: ${validationSourceLabel(receipt.logValidationCode)}` : null,
          `   ${receipt.closeoutSummary}`,
        ]
          .filter((line) => line !== null)
          .join('\n'),
      ),
    ];
    return lines.join('\n');
  }

  async function copyFilteredCloseoutReceipts() {
    const content = [
      `Filter: ${closeoutFilter}`,
      `Count: ${filteredRecentCloseoutReceipts.length}`,
      `Generated At: ${new Date().toISOString()}`,
      '',
      ...filteredRecentCloseoutReceipts.map((receipt, index) =>
        [
          `${index + 1}. ${receipt.traceId} / ${receipt.closeoutLabel} / ${localText(receipt.recordedAt)}`,
          receipt.taskId ? `   task: ${receipt.taskId}` : null,
          receipt.nodeId ? `   node: ${receipt.nodeId}` : null,
          receipt.queue ? `   queue: ${receipt.queue}` : null,
          `   ${receipt.closeoutSummary}`,
        ]
          .filter((line) => line !== null)
          .join('\n'),
      ),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(content);
      triggerSuccessToast(`已复制 ${filteredRecentCloseoutReceipts.length} 条收尾摘要`);
    } catch {
      triggerErrorToast('复制筛选后的收尾摘要失败，请检查浏览器剪贴板权限');
    }
  }

  async function copyFilteredCloseoutSummary(audience: Exclude<CloseoutSummaryAudience, 'generic'>) {
    const content = formatCloseoutSummary(filteredRecentCloseoutReceipts, audience, {
      filter: closeoutFilter,
    });
    try {
      await navigator.clipboard.writeText(content);
      triggerSuccessToast(
        audience === 'project_control'
          ? `已复制 ${filteredRecentCloseoutReceipts.length} 条总控摘要`
          : `已复制 ${filteredRecentCloseoutReceipts.length} 条 QA 摘要`,
      );
    } catch {
      triggerErrorToast('复制模板化收尾摘要失败，请检查浏览器剪贴板权限');
    }
  }

  async function copyReceiptSummary(receipt: TraceCloseoutReceipt) {
    try {
      await navigator.clipboard.writeText(formatCloseoutSummary([receipt], 'generic'));
      triggerSuccessToast(`已复制 ${receipt.traceId} 的汇报摘要`);
    } catch {
      triggerErrorToast('复制收尾汇报摘要失败，请检查浏览器剪贴板权限');
    }
  }

  function exportFilteredCloseoutReceipts() {
    downloadCloseoutJson(`trace-closeouts-${closeoutFilter}.json`, {
      exported_at: new Date().toISOString(),
      filter: closeoutFilter,
      count: filteredRecentCloseoutReceipts.length,
      items: filteredRecentCloseoutReceipts,
    });
    triggerSuccessToast(`已导出 ${filteredRecentCloseoutReceipts.length} 条收尾记录`);
  }
  const activeTraceKey = useMemo(
    () => String(traceId || traceIdInput.trim() || ''),
    [traceId, traceIdInput],
  );
  const recentCloseoutReceipts = useMemo(
    () => toSortedCloseoutReceipts(closeoutReceipts).slice(0, 6),
    [closeoutReceipts],
  );
  const filteredRecentCloseoutReceipts = useMemo(() => {
    return recentCloseoutReceipts.filter((receipt) => {
      if (closeoutFilter === 'all') return true;
      if (closeoutFilter === 'current') return receipt.traceId === activeTraceKey;
      if (closeoutFilter === 'completed') return receipt.closeoutLabel === '闭环完成';
      return receipt.closeoutLabel !== '闭环完成';
    });
  }, [activeTraceKey, closeoutFilter, recentCloseoutReceipts]);
  const recentCloseoutSummary = useMemo(() => {
    const base = summarizeCloseoutCounts(recentCloseoutReceipts);
    return {
      ...base,
      current: recentCloseoutReceipts.filter((receipt) => receipt.traceId === activeTraceKey).length,
    };
  }, [activeTraceKey, recentCloseoutReceipts]);
  const closeoutFilterStats = useMemo(
    () => ({
      all: recentCloseoutSummary.total,
      current: recentCloseoutSummary.current,
      completed: recentCloseoutSummary.completed,
      other: recentCloseoutSummary.other,
    }),
    [recentCloseoutSummary],
  );
  const activeRetentionPreset = useMemo(
    () => resolveTraceCloseoutRetentionPreset(retentionSettings),
    [retentionSettings],
  );
  const currentCloseoutReceipt = useMemo(
    () => (activeTraceKey ? closeoutReceipts[activeTraceKey] ?? null : null),
    [activeTraceKey, closeoutReceipts],
  );
  const nextCloseoutReceipt = useMemo<TraceCloseoutReceipt | null>(() => {
    if (!activeTraceKey || !closeoutState) return null;
    return {
      traceId: activeTraceKey,
      recordedAt: new Date().toISOString(),
      closeoutLabel: closeoutState.label,
      closeoutSummary: closeoutState.summary,
      validationStatus: validationContext.validationStatus,
      validationStage: validationContext.validationStage,
      validationOrigin: validationContext.validationOrigin,
      taskId: primaryTaskId || undefined,
      nodeId: primaryNodeId || undefined,
      queue: resolvedSourceQueue || undefined,
      monitorValidationCode: monitorValidationCode || undefined,
      monitorValidationAt: monitorValidationAt || undefined,
      logValidationCode: logValidationCode || undefined,
      logValidationAt: logValidationAt || undefined,
    };
  }, [
    activeTraceKey,
    closeoutState,
    logValidationAt,
    logValidationCode,
    monitorValidationAt,
    monitorValidationCode,
    primaryNodeId,
    primaryTaskId,
    resolvedSourceQueue,
    validationContext.validationOrigin,
    validationContext.validationStage,
    validationContext.validationStatus,
  ]);

  useEffect(() => {
    if (closeoutState?.label !== '闭环完成' || !nextCloseoutReceipt || currentCloseoutReceipt) return;
    setCloseoutReceipts((prev) => {
      const next = { ...prev, [nextCloseoutReceipt.traceId]: nextCloseoutReceipt };
      persistTraceCloseoutReceipts(next);
      return next;
    });
  }, [closeoutState?.label, currentCloseoutReceipt, nextCloseoutReceipt]);

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
            <Link href="/operations/autopilot/alerts" className={traceActionClass('neutral')}>
              查看告警
            </Link>
            <Link href={logAuditHref} className={traceActionClass('cyan')}>
              打开日志审核
            </Link>
            <Link href={monitorHref} className={traceActionClass('amber')}>
              去监控验证
            </Link>
            <Link href={LEARNING_LOOP_ROUTES.releaseChecklist.href} className={traceActionClass('emerald')}>
              {LEARNING_LOOP_ROUTES.releaseChecklist.title}
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
        <article id="rollback-approval" className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
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
          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-emerald-200">Validation Loopback</div>
            <div className="mt-2 text-sm leading-7 text-slate-100">
              {rollbackResult
                ? '处理动作已经落下去了，下一步不要凭感觉判断是否恢复，直接回监控和日志确认心跳、回执、异常量有没有回落。'
                : rollbackPreview
                  ? '预演已经完成，下一步可以继续申请审批，或者先回监控与日志确认当前异常范围。'
                  : '复盘过程中建议始终把验证入口放在手边：日志看异常是否收敛，监控看节点和回执是否恢复。'}
            </div>
            {closeoutState ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs ${closeoutState.tone}`}>
                    {closeoutState.label}
                  </span>
                  <span className="text-sm text-slate-100">{closeoutState.summary}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-200">
                  {closeoutState.sources.map((item) => (
                    <span key={`${item.label}:${item.code}:${item.at || '-'}`} className={`rounded-full px-3 py-1 ${validationSourceTone(item.code)}`}>
                      {item.label} {validationSourceLabel(item.code)}{item.at ? ` · ${localText(item.at)}` : ''}
                    </span>
                  ))}
                </div>
                {closeoutActions.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {closeoutActions.map((action) => (
                      <Link
                        key={action.key}
                        href={action.href}
                        className={`rounded-2xl border px-4 py-2.5 text-sm font-medium transition hover:opacity-90 ${action.tone}`}
                      >
                        {action.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {currentCloseoutReceipt || closeoutState?.label === '闭环完成' ? (
              <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-cyan-200">Closeout Receipt</div>
                    <div className="mt-2 text-sm leading-7 text-slate-100">
                      当前浏览器会为这次 Trace 保留一条轻量收尾记录，方便你确认“这次真的已经收尾”。
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Status</div>
                    {currentCloseoutReceipt ? (
                      <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200">
                        已记录 {localText(currentCloseoutReceipt.recordedAt)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200">
                        等待写入
                      </span>
                    )}
                  </div>
                </div>
                {currentCloseoutReceipt ? (
                  <div className="mt-4">
                    <div className="flex flex-wrap gap-2 text-xs text-slate-200">
                      <span className={`rounded-full px-3 py-1 ${closeoutState ? closeoutState.tone : 'bg-white/5 text-slate-200'}`}>
                        {currentCloseoutReceipt.closeoutLabel}
                      </span>
                      <span className="rounded-full bg-white/5 px-3 py-1">trace {currentCloseoutReceipt.traceId}</span>
                      {currentCloseoutReceipt.taskId ? <span className="rounded-full bg-white/5 px-3 py-1">task {currentCloseoutReceipt.taskId}</span> : null}
                      {currentCloseoutReceipt.nodeId ? <span className="rounded-full bg-white/5 px-3 py-1">node {currentCloseoutReceipt.nodeId}</span> : null}
                      {currentCloseoutReceipt.queue ? <span className="rounded-full bg-white/5 px-3 py-1">queue {currentCloseoutReceipt.queue}</span> : null}
                    </div>
                    <div className="mt-4 text-sm leading-7 text-slate-100">{currentCloseoutReceipt.closeoutSummary}</div>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-200">
                      {currentCloseoutReceipt.monitorValidationCode ? (
                        <span className={`rounded-full px-3 py-1 ${validationSourceTone(currentCloseoutReceipt.monitorValidationCode)}`}>
                          monitor {validationSourceLabel(currentCloseoutReceipt.monitorValidationCode)}
                        </span>
                      ) : null}
                      {currentCloseoutReceipt.logValidationCode ? (
                        <span className={`rounded-full px-3 py-1 ${validationSourceTone(currentCloseoutReceipt.logValidationCode)}`}>
                          log-audit {validationSourceLabel(currentCloseoutReceipt.logValidationCode)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Receipt Guide</div>
                    <div className="mt-2 text-sm leading-7 text-slate-100">
                      闭环完成后会自动写入当前浏览器的本地收尾记录；如果你只是想先留一个人工确认点，也可以在这里手动写入一次。
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                      <span className="rounded-full bg-white/5 px-3 py-1">自动写入：闭环完成</span>
                      <span className="rounded-full bg-white/5 px-3 py-1">手动写入：人工收尾确认</span>
                    </div>
                  </div>
                )}
                <div className="mt-4 flex flex-col items-start gap-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Quick Actions
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {nextCloseoutReceipt ? (
                      <button
                        type="button"
                        onClick={saveCurrentCloseoutReceipt}
                        className={traceActionClass('cyan')}
                      >
                        {currentCloseoutReceipt ? '更新本地收尾记录' : '写入本地收尾记录'}
                      </button>
                    ) : null}
                    {currentCloseoutReceipt ? (
                      <button
                        type="button"
                        onClick={clearCurrentCloseoutReceipt}
                        className={traceActionClass('neutral')}
                      >
                        清除本地记录
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Recent Closeouts</div>
                    <div className="mt-2 text-sm leading-7 text-slate-100">
                      这里保留当前浏览器最近几次已经写下来的收尾记录，方便你快速回看之前的闭环结果。
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      当前策略：自动保留最近 {retentionSettings.maxItems} 条，且仅保留近 {retentionSettings.maxDays} 天记录。
                    </div>
                    {activeRetentionPreset ? (
                      <div className="mt-2 text-xs text-cyan-200">
                        当前预设：{activeRetentionPreset.label} · {activeRetentionPreset.description}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-slate-500">
                        当前为自定义策略，可按下面的预设快速切回常用档位。
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Toolbar</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200">
                        最近 {recentCloseoutReceipts.length} 条
                      </span>
                    </div>
                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Share</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void copyFilteredCloseoutSummary('project_control')}
                          disabled={filteredRecentCloseoutReceipts.length === 0}
                          className={traceActionClass('cyan', 'pill')}
                        >
                          复制总控摘要
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyFilteredCloseoutSummary('qa')}
                          disabled={filteredRecentCloseoutReceipts.length === 0}
                          className={traceActionClass('emerald', 'pill')}
                        >
                          复制 QA 摘要
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyFilteredCloseoutReceipts()}
                          disabled={filteredRecentCloseoutReceipts.length === 0}
                          className={traceActionClass('cyan', 'pill')}
                        >
                          复制筛选结果
                        </button>
                        <button
                          type="button"
                          onClick={exportFilteredCloseoutReceipts}
                          disabled={filteredRecentCloseoutReceipts.length === 0}
                          className={traceActionClass('amber', 'pill')}
                        >
                          导出筛选结果
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Manage</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateTraceCloseoutRetentionSettings({
                            maxItems: TRACE_CLOSEOUT_RETENTION_MAX,
                            maxDays: TRACE_CLOSEOUT_RETENTION_DAYS,
                          })}
                          disabled={
                            retentionSettings.maxItems === TRACE_CLOSEOUT_RETENTION_MAX
                            && retentionSettings.maxDays === TRACE_CLOSEOUT_RETENTION_DAYS
                          }
                          className={traceActionClass('neutral', 'pill')}
                        >
                          恢复默认策略
                        </button>
                        <button
                          type="button"
                          onClick={clearAllCloseoutReceipts}
                          disabled={recentCloseoutReceipts.length === 0}
                          className={traceActionClass('neutral', 'pill')}
                        >
                          清空全部
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="text-xs text-slate-300">
                    最多保留条数
                    <select
                      value={retentionSettings.maxItems}
                      onChange={(event) => updateTraceCloseoutRetentionSettings({ maxItems: Number(event.target.value) })}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                    >
                      {[10, 20, 30, 50, 100].map((value) => (
                        <option key={value} value={value}>{value} 条</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-slate-300">
                    最久保留天数
                    <select
                      value={retentionSettings.maxDays}
                      onChange={(event) => updateTraceCloseoutRetentionSettings({ maxDays: Number(event.target.value) })}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                    >
                      {[7, 14, 30, 60, 90].map((value) => (
                        <option key={value} value={value}>{value} 天</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  {getTraceCloseoutRetentionPresets().map((preset) => {
                    const active =
                      retentionSettings.maxItems === preset.maxItems
                      && retentionSettings.maxDays === preset.maxDays;
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => updateTraceCloseoutRetentionSettings({ maxItems: preset.maxItems, maxDays: preset.maxDays })}
                        className={`rounded-2xl border p-4 text-left transition ${
                          active
                            ? 'border-cyan-400/35 bg-cyan-400/10'
                            : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-3 py-1 text-xs ${active ? 'bg-cyan-400/15 text-cyan-100' : 'bg-white/5 text-slate-300'}`}>
                            {preset.label}
                          </span>
                          <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-400">
                            {preset.maxItems} 条 / {preset.maxDays} 天
                          </span>
                        </div>
                        <div className="mt-3 text-sm leading-7 text-slate-100">{preset.description}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    ['all', '全部', closeoutFilterStats.all],
                    ['current', '当前 trace', closeoutFilterStats.current],
                    ['completed', '已完成', closeoutFilterStats.completed],
                    ['other', '非完成', closeoutFilterStats.other],
                  ].map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      disabled={key !== 'all' && Number(count) === 0}
                      onClick={() => setCloseoutFilter(key as 'all' | 'current' | 'completed' | 'other')}
                      className={`rounded-full px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        closeoutFilter === key
                          ? 'bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-400/30'
                          : 'bg-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {label} {count}
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <MiniMetric
                    label="最近记录"
                    value={String(recentCloseoutSummary.total)}
                    cardTone="border-white/10 bg-white/[0.04]"
                    valueTone="text-white"
                  />
                  <MiniMetric
                    label="闭环完成"
                    value={String(recentCloseoutSummary.completed)}
                    cardTone="border-emerald-400/25 bg-emerald-400/10"
                    valueTone="text-emerald-100"
                  />
                  <MiniMetric
                    label="接近完成"
                    value={String(recentCloseoutSummary.nearDone)}
                    cardTone="border-cyan-400/25 bg-cyan-400/10"
                    valueTone="text-cyan-100"
                  />
                  <MiniMetric
                    label="筛选结果"
                    value={String(filteredRecentCloseoutReceipts.length)}
                    cardTone="border-amber-400/25 bg-amber-400/10"
                    valueTone="text-amber-100"
                  />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <LegendNote
                    tone="bg-white/5 text-slate-200"
                    text="灰色看最近记录总量，帮助判断本地收尾留痕规模。"
                  />
                  <LegendNote
                    tone="bg-emerald-400/10 text-emerald-100"
                    text="绿色代表已经闭环完成，适合优先拿去做收尾留痕。"
                  />
                  <LegendNote
                    tone="bg-cyan-400/10 text-cyan-100"
                    text="青色代表接近完成，通常还值得再观察一轮。"
                  />
                  <LegendNote
                    tone="bg-amber-400/10 text-amber-100"
                    text="琥珀色只看当前筛选命中数，用来判断列表是否被过滤得过窄。"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                  <span className="rounded-full bg-white/5 px-3 py-1">
                    当前 trace 命中 {recentCloseoutSummary.current}
                  </span>
                  <span className="rounded-full bg-white/5 px-3 py-1">
                    其他状态 {recentCloseoutSummary.other}
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {filteredRecentCloseoutReceipts.length ? filteredRecentCloseoutReceipts.map((receipt) => {
                    const receiptValidation = {
                      validationTraceId: receipt.traceId,
                      validationTaskId: receipt.taskId || undefined,
                      validationNodeId: receipt.nodeId || undefined,
                      validationQueue: receipt.queue || undefined,
                      validationMode: receipt.validationStatus ? 'trace_closeout' : undefined,
                      validationStatus: receipt.validationStatus || undefined,
                      validationStage: receipt.validationStage || undefined,
                      validationAt: receipt.recordedAt,
                      validationOrigin: receipt.validationOrigin || 'trace_closeout_receipt',
                      monitorValidationCode: receipt.monitorValidationCode || undefined,
                      monitorValidationAt: receipt.monitorValidationAt || undefined,
                      logValidationCode: receipt.logValidationCode || undefined,
                      logValidationAt: receipt.logValidationAt || undefined,
                    };
                    const receiptTraceHref = buildTraceHref({
                      traceId: receipt.traceId,
                      sourceQueue: receipt.queue || undefined,
                      validation: receiptValidation,
                    });
                    const receiptLogHref = buildLogAuditHref({
                      traceId: receipt.traceId,
                      keyword: receipt.taskId || undefined,
                      sourceQueue: receipt.queue || undefined,
                      validation: receiptValidation,
                    });
                    const receiptMonitorHref = buildMonitorHref({
                      taskId: receipt.taskId || undefined,
                      nodeId: receipt.nodeId || undefined,
                      validation: receiptValidation,
                    });
                    return (
                      <div
                        key={`${receipt.traceId}:${receipt.recordedAt}`}
                        className={`rounded-2xl border p-4 ${
                          receipt.traceId === activeTraceKey
                            ? 'border-cyan-400/35 bg-cyan-400/10'
                            : 'border-white/8 bg-white/[0.03]'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-3 py-1 text-xs ${closeoutLabelTone(receipt.closeoutLabel)}`}>
                                {receipt.closeoutLabel}
                              </span>
                              {receipt.traceId === activeTraceKey ? (
                                <span className="rounded-full bg-cyan-400/15 px-3 py-1 text-xs text-cyan-100">当前</span>
                              ) : null}
                            </div>
                            <div className="mt-3 font-mono text-sm text-white">{receipt.traceId}</div>
                          </div>
                          <div className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-400">
                            {localText(receipt.recordedAt)}
                          </div>
                        </div>
                        <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm leading-7 text-slate-100">
                          {receipt.closeoutSummary}
                        </div>
                        <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-slate-500">Context</div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-200">
                          {receipt.taskId ? <span className="rounded-full bg-white/5 px-3 py-1">task {receipt.taskId}</span> : null}
                          {receipt.nodeId ? <span className="rounded-full bg-white/5 px-3 py-1">node {receipt.nodeId}</span> : null}
                          {receipt.queue ? <span className="rounded-full bg-white/5 px-3 py-1">queue {receipt.queue}</span> : null}
                        </div>
                        <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-slate-500">Actions</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Link
                            href={receiptTraceHref}
                            className={traceActionClass('neutral')}
                          >
                            回看 Trace
                          </Link>
                          <Link
                            href={receiptLogHref}
                            className={traceActionClass('cyan')}
                          >
                            查看日志
                          </Link>
                          <Link
                            href={receiptMonitorHref}
                            className={traceActionClass('amber')}
                          >
                            查看监控
                          </Link>
                          <button
                            type="button"
                            onClick={() => void copyCloseoutReceipt(receipt)}
                            className={traceActionClass('cyan')}
                          >
                            复制记录
                          </button>
                          <button
                            type="button"
                            onClick={() => void copyReceiptSummary(receipt)}
                            className={traceActionClass('emerald')}
                          >
                            复制摘要
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCloseoutReceipt(receipt.traceId)}
                            className={traceActionClass('neutral')}
                          >
                            移除这条
                          </button>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Recent Closeouts Guide</div>
                      <div className="mt-2 text-sm leading-7 text-slate-100">
                        {recentCloseoutReceipts.length === 0
                          ? '当前还没有本地收尾记录。闭环完成后会自动写入，你也可以先在上方 Closeout Receipt 卡里手动写入一次。'
                          : '当前筛选条件下没有收尾记录，可以切回“全部”或调整筛选条件。'}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                        {recentCloseoutReceipts.length === 0 ? (
                          <>
                            <span className="rounded-full bg-white/5 px-3 py-1">先完成一次闭环验证</span>
                            <span className="rounded-full bg-white/5 px-3 py-1">或直接写入本地记录</span>
                          </>
                        ) : (
                          <>
                            <span className="rounded-full bg-white/5 px-3 py-1">切回“全部”可恢复完整列表</span>
                            <span className="rounded-full bg-white/5 px-3 py-1">筛选按钮上的数字可帮助判断是否有命中</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={monitorHref}
                className={traceActionClass('neutral')}
              >
                去执行监控室验证
              </Link>
              <Link
                href={logAuditHref}
                className={traceActionClass('cyan')}
              >
                回日志审核看异常是否回落
              </Link>
              <Link
                href={`${logAuditHref}#detail`}
                className={traceActionClass('neutral')}
              >
                回到日志详情
              </Link>
            </div>
          </div>
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

        <EvidenceCard title="9 虾行业知识包" icon={<ShieldCheck className="h-4 w-4 text-emerald-300" />}>
          <div className="grid gap-3 sm:grid-cols-4">
            <MiniMetric label="匹配行业" value={String(industryKnowledgePacks.matched_industry ?? '-')} />
            <MiniMetric label="龙虾就绪" value={`${Number(industryKnowledgePacks.roles_ready ?? 0)}/${Number(industryKnowledgePacks.roles_total ?? 9)}`} />
            <MiniMetric label="文件就绪" value={`${Number(industryKnowledgePacks.files_ready ?? 0)}/${Number(industryKnowledgePacks.files_expected ?? 36)}`} />
            <MiniMetric
              label="状态"
              value={industryKnowledgePacks.ok ? 'Ready' : 'Need attention'}
              cardTone={industryKnowledgePacks.ok ? 'border-emerald-400/20 bg-emerald-400/10' : 'border-amber-400/20 bg-amber-400/10'}
              valueTone={industryKnowledgePacks.ok ? 'text-emerald-100' : 'text-amber-100'}
            />
          </div>

          {industryKnowledgePackRoleRows.length ? (
            <div className="mt-4 max-h-72 overflow-auto rounded-2xl border border-white/8 bg-slate-950/40">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-950/95 text-slate-300">
                  <tr>
                    <th className="px-3 py-2 font-medium">龙虾</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">包数</th>
                    <th className="px-3 py-2 font-medium">规则/案例</th>
                    <th className="px-3 py-2 font-medium">路径</th>
                  </tr>
                </thead>
                <tbody>
                  {industryKnowledgePackRoleRows.map((row) => (
                    <tr key={row.roleId} className="border-t border-slate-800 text-slate-200">
                      <td className="px-3 py-2 font-medium text-slate-100">{row.roleId}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-1 ${row.ready ? 'bg-emerald-400/10 text-emerald-100' : 'bg-amber-400/10 text-amber-100'}`}>
                          {row.ready ? 'ready' : 'missing'}
                        </span>
                      </td>
                      <td className="px-3 py-2">{row.packCount}</td>
                      <td className="px-3 py-2">{row.itemCount}/{row.caseCount}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-slate-400" title={row.path}>{row.path || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 text-sm leading-7 text-slate-400">
              这个 trace 还没有记录行业知识包使用情况。新任务会在 kernel report 里写入 `industry_knowledge_packs`。
            </div>
          )}

          {Array.isArray(industryKnowledgePacks.missing) && industryKnowledgePacks.missing.length ? (
            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
              缺口 {industryKnowledgePacks.missing.length} 个。建议先回到知识包生成链补齐，再继续放大执行。
            </div>
          ) : null}
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

function MiniMetric({
  label,
  value,
  cardTone = 'border-white/8 bg-white/[0.03]',
  valueTone = 'text-white',
}: {
  label: string;
  value: string;
  cardTone?: string;
  valueTone?: string;
}) {
  return (
    <div className={`rounded-xl border p-3 ${cardTone}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 text-sm font-medium ${valueTone}`}>{value}</div>
    </div>
  );
}

function LegendNote({ text, tone }: { text: string; tone: string }) {
  return (
    <div className={`rounded-xl border border-white/8 px-3 py-2 text-xs leading-6 ${tone}`}>
      {text}
    </div>
  );
}

function closeoutLabelTone(label: string): string {
  if (label === '闭环完成') return 'bg-emerald-500/15 text-emerald-200';
  if (label === '接近完成') return 'bg-cyan-400/10 text-cyan-100';
  if (label === '闭环未完成' || label === '未恢复') return 'bg-rose-500/15 text-rose-200';
  return 'bg-white/5 text-slate-200';
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
