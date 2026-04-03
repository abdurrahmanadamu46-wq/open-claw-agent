'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
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

export default function LogAuditPage() {
  const [keyword, setKeyword] = useState('');
  const [levelFilter, setLevelFilter] = useState<'ALL' | AutopilotAuditLogLevel>('ALL');
  const [moduleFilter, setModuleFilter] = useState<'ALL' | AutopilotAuditLogModule>('ALL');
  const [nodeFilter, setNodeFilter] = useState('');
  const [sourceQueue, setSourceQueue] = useState('');
  const [traceId, setTraceId] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [from, setFrom] = useState(defaultFromISO());
  const [to, setTo] = useState(defaultToISO());
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

  const selectedRiskFamily = String(
    ((selectedKernelQuery.data?.kernel_report as Record<string, unknown> | undefined)?.risk_taxonomy as Record<string, unknown> | undefined)?.primary_family ?? '--',
  );
  const selectedAutonomy = String(
    ((selectedKernelQuery.data?.kernel_report as Record<string, unknown> | undefined)?.autonomy as Record<string, unknown> | undefined)?.route ?? '--',
  );

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
          <div className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
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

                {selected.traceId && (
                  <Link
                    href={`/operations/autopilot/trace?traceId=${encodeURIComponent(selected.traceId)}`}
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    去 Trace 中心继续排障
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
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
