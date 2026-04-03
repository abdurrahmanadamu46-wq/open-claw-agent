'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, RefreshCw, RadioTower, Server, Wifi, WifiOff } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import {
  fetchEventBusPrefixSummary,
  fetchEventBusSubjects,
  fetchExecutionMonitorSnapshot,
  type ExecutionMonitorEvent,
  type ExecutionMonitorNodeRow,
} from '@/services/endpoints/ai-subservice';
import type { EventBusPrefixSummary, EventBusSubjectStat } from '@/types/event-bus-traffic';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';

function deriveExecutionWsUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const hostname = window.location.hostname;
  const port =
    hostname === '127.0.0.1' || hostname === 'localhost'
      ? '48789'
      : window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
  return `${protocol}//${hostname}:${port}/ws/execution-logs`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function normalizeAxiosError(error: unknown): string {
  const maybe = error as { response?: { status?: number; data?: { message?: string; detail?: string } }; message?: string };
  const status = maybe?.response?.status;
  const detail = maybe?.response?.data?.message || maybe?.response?.data?.detail;
  if (status && detail) return `请求失败 (${status}): ${detail}`;
  if (status) return `请求失败 (${status})`;
  return maybe?.message || '请求失败';
}

export default function ExecutionMonitorPage() {
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const unmountedRef = useRef(false);
  const [nodes, setNodes] = useState<ExecutionMonitorNodeRow[]>([]);
  const [logs, setLogs] = useState<ExecutionMonitorEvent[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('all');
  const [subjectPrefix, setSubjectPrefix] = useState<string>('');
  const [subjectRows, setSubjectRows] = useState<EventBusSubjectStat[]>([]);
  const [prefixRows, setPrefixRows] = useState<EventBusPrefixSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [wsState, setWsState] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

  const loadSnapshot = async () => {
    setLoading(true);
    setErrorText('');
    try {
      const [data, subjectData, prefixData] = await Promise.all([
        fetchExecutionMonitorSnapshot(tenantId),
        fetchEventBusSubjects(subjectPrefix || undefined),
        fetchEventBusPrefixSummary(),
      ]);
      setNodes(data.nodes || []);
      setLogs(data.recent_logs || []);
      setSubjectRows(subjectData.subjects || []);
      setPrefixRows(prefixData.prefixes || []);
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
      setNodes([]);
      setLogs([]);
      setSubjectRows([]);
      setPrefixRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setNodes([]);
    setLogs([]);
    setSubjectRows([]);
    setPrefixRows([]);
    setErrorText('');
  }, [tenantId]);

  useEffect(() => {
    unmountedRef.current = false;
    const wsUrl = deriveExecutionWsUrl();
    if (!wsUrl) return;

    function connect() {
      if (unmountedRef.current) return;
      setWsState('connecting');
      const socket = new WebSocket(wsUrl!);
      socketRef.current = socket;

      socket.onopen = () => {
        if (unmountedRef.current) { socket.close(); return; }
        setWsState('connected');
        reconnectAttemptRef.current = 0;
      };

      socket.onerror = () => {
        setWsState('disconnected');
      };

      socket.onclose = () => {
        if (unmountedRef.current) return;
        setWsState('disconnected');
        // Exponential backoff: 2s, 4s, 8s … capped at 30s
        const delay = Math.min(2000 * Math.pow(2, reconnectAttemptRef.current), 30000);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || '{}')) as ExecutionMonitorEvent | { event?: ExecutionMonitorEvent };
          const nextEvent = 'event' in payload && payload.event ? payload.event : (payload as ExecutionMonitorEvent);
          if (!nextEvent?.task_id) return;
          setLogs((prev) => [nextEvent, ...prev].slice(0, 80));
        } catch {
          // Ignore malformed frames; this page is an observer, not the protocol owner.
        }
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const taskOptions = useMemo(() => {
    const values = new Set<string>();
    logs.forEach((item) => {
      if (item.task_id) values.add(item.task_id);
    });
    return ['all', ...Array.from(values)];
  }, [logs]);

  const filteredLogs = useMemo(() => {
    if (selectedTaskId === 'all') return logs;
    return logs.filter((item) => item.task_id === selectedTaskId);
  }, [logs, selectedTaskId]);

  useEffect(() => {
    void loadSnapshot();
  }, [subjectPrefix]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#07111f] p-6 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-5">
        <section
          className="rounded-[30px] border p-6"
          style={{ background: 'linear-gradient(135deg, rgba(20,34,58,0.98), rgba(11,21,35,0.98))', borderColor: BORDER }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Execution Monitor</div>
              <h1 className="mt-3 text-3xl font-semibold text-white">透明通信执行监控室</h1>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                左侧看边缘节点在线与负载，右侧看实时执行日志。这个页面只做观察和排障，不替边缘做决策。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <StatusPill state={wsState} reconnectAttempt={reconnectAttemptRef.current} />
              <button
                type="button"
                onClick={() => void loadSnapshot()}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
              >
                <RefreshCw className="h-4 w-4" />
                {loading ? '刷新中...' : '刷新'}
              </button>
            </div>
          </div>

          {errorText ? <div className="mt-4 text-sm text-rose-200">{errorText}</div> : null}

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <MetricCard label="节点总数" value={String(nodes.length)} />
            <MetricCard label="在线节点" value={String(nodes.filter((item) => item.status === 'ONLINE').length)} />
            <MetricCard label="忙碌节点" value={String(nodes.filter((item) => item.status === 'BUSY').length)} />
            <MetricCard label="日志缓冲" value={String(logs.length)} />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <MetricCard label="Subject 总数" value={String(subjectRows.length)} />
            <MetricCard label="热门前缀" value={prefixRows[0]?.prefix || '-'} />
            <MetricCard label="峰值 msg/min" value={String(prefixRows[0]?.count_last_minute || 0)} />
            <MetricCard label="近 1h 总量" value={String(prefixRows.reduce((sum, row) => sum + row.count_last_hour, 0))} />
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside
            className="rounded-[28px] border p-5"
            style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
              <Server className="h-4 w-4" />
              边缘节点
            </div>

            <div className="mt-4 space-y-3">
              {nodes.length ? (
                nodes.map((node) => (
                  <div key={node.node_id} className="rounded-2xl border border-slate-700/70 bg-slate-950/35 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-white">{node.client_name || node.node_id}</div>
                        <div className="mt-1 text-xs text-slate-400">{node.node_id}</div>
                      </div>
                      <NodeStatusBadge status={node.status} />
                    </div>

                    <div className="mt-3 grid gap-2 text-sm text-slate-300">
                      <InfoRow label="地域" value={node.region || '-'} />
                      <InfoRow label="负载" value={node.load_percent != null ? `${node.load_percent}%` : '-'} />
                      <InfoRow label="任务" value={node.running_task_id || '-'} />
                      <InfoRow label="最近心跳" value={formatDateTime(node.last_seen_at)} />
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState text="当前没有可展示的边缘节点。后端接入 snapshot 后，这里会显示在线、负载和任务占用。" />
              )}
            </div>
          </aside>

          <section
            className="rounded-[28px] border p-5"
            style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                  <Activity className="h-4 w-4" />
                  实时日志流
                </div>
                <div className="mt-2 text-sm text-slate-400">
                  WebSocket 地址: <span className="text-slate-200">{deriveExecutionWsUrl() || 'unavailable'}</span>
                </div>
              </div>

              <select
                value={selectedTaskId}
                onChange={(event) => setSelectedTaskId(event.target.value)}
                className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              >
                {taskOptions.map((taskId) => (
                  <option key={taskId} value={taskId}>
                    {taskId === 'all' ? '全部任务' : taskId}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 space-y-3">
              {filteredLogs.length ? (
                filteredLogs.map((item, index) => (
                  <div key={`${item.task_id}-${item.created_at}-${index}`} className="rounded-2xl border border-slate-700/70 bg-slate-950/35 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">{item.task_id}</span>
                      <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">{item.node_id}</span>
                      <span className={`rounded-full px-3 py-1 text-xs ${levelTone(item.level)}`}>{item.level}</span>
                      {item.stage ? (
                        <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">{item.stage}</span>
                      ) : null}
                    </div>
                    <div className="mt-3 text-sm leading-7 text-slate-100">{item.message}</div>
                    <div className="mt-2 text-xs text-slate-500">{formatDateTime(item.created_at)}</div>
                  </div>
                ))
              ) : (
                <EmptyState text="日志流还没有数据。页面已经预留好了消费位，等后端推送执行日志后会自动滚入。" />
              )}
            </div>
          </section>
        </section>

        <section className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside
            className="rounded-[28px] border p-5"
            style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              <RadioTower className="h-4 w-4" />
              Subject Prefix
            </div>

            <div className="mt-4 space-y-3">
              <input
                value={subjectPrefix}
                onChange={(event) => setSubjectPrefix(event.target.value)}
                placeholder="例如 task.tenant_main"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              />
              <div className="space-y-2">
                {prefixRows.map((row) => (
                  <button
                    key={row.prefix}
                    type="button"
                    onClick={() => setSubjectPrefix(row.prefix)}
                    className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/35 px-3 py-3 text-left"
                  >
                    <div className="font-mono text-xs text-cyan-200">{row.prefix}.*</div>
                    <div className="mt-2 text-lg font-semibold text-white">{row.count_last_hour}</div>
                    <div className="text-xs text-slate-400">
                      {row.count_last_minute} msg/min · total {row.total_count}
                    </div>
                  </button>
                ))}
                {!prefixRows.length ? <EmptyState text="事件前缀聚合暂无数据。" /> : null}
              </div>
            </div>
          </aside>

          <section
            className="rounded-[28px] border p-5"
            style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
                  <Activity className="h-4 w-4" />
                  Subject Traffic
                </div>
                <div className="mt-2 text-sm text-slate-400">
                  按层级化 subject 统计消息量，快速定位哪条事件链最繁忙。
                </div>
              </div>
              <div className="text-xs text-slate-400">
                当前筛选: <span className="font-mono text-slate-200">{subjectPrefix || '全部'}</span>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {subjectRows.length ? (
                subjectRows.map((row) => (
                  <div key={row.subject} className="rounded-2xl border border-slate-700/70 bg-slate-950/35 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="font-mono text-xs text-cyan-100">{row.subject}</div>
                      <div className="text-xs text-slate-400">
                        last {formatRelativeTime(row.last_published_at)}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <MiniMetric label="近 1 分钟" value={String(row.count_last_minute)} />
                      <MiniMetric label="近 1 小时" value={String(row.count_last_hour)} />
                      <MiniMetric label="累计" value={String(row.total_count)} />
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState text="当前筛选条件下没有 subject 流量数据。" />
              )}
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return '-';
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function StatusPill({ state, reconnectAttempt = 0 }: { state: 'connecting' | 'connected' | 'disconnected'; reconnectAttempt?: number }) {
  const icon =
    state === 'connected' ? <Wifi className="h-4 w-4" /> : state === 'connecting' ? <RadioTower className="h-4 w-4 animate-pulse" /> : <WifiOff className="h-4 w-4" />;
  const tone =
    state === 'connected'
      ? 'bg-emerald-500/15 text-emerald-200'
      : state === 'connecting'
        ? 'bg-amber-400/15 text-amber-200'
        : 'bg-slate-800 text-slate-400';
  const label = state === 'connected' ? '已连接' : state === 'connecting' ? '连接中...' : '已断开';
  const sub = state === 'disconnected' && reconnectAttempt > 0 ? `重连第 ${reconnectAttempt} 次` : null;
  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${tone}`}>
      {icon}
      <span>{label}</span>
      {sub && <span className="text-xs opacity-70">· {sub}</span>}
    </div>
  );
}

function NodeStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'ONLINE'
      ? 'bg-emerald-500/15 text-emerald-200'
      : status === 'BUSY'
        ? 'bg-amber-400/15 text-amber-200'
        : status === 'INTERVENTION_REQUIRED'
          ? 'bg-rose-500/15 text-rose-200'
          : 'bg-slate-800 text-slate-400';
  return <span className={`rounded-full px-3 py-1 text-xs ${tone}`}>{status}</span>;
}

function levelTone(level: string) {
  if (level === 'error') return 'bg-rose-500/15 text-rose-200';
  if (level === 'warn') return 'bg-amber-400/15 text-amber-200';
  if (level === 'info') return 'bg-cyan-400/10 text-cyan-200';
  return 'bg-white/5 text-slate-300';
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-black/20 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/30 px-4 py-8 text-sm text-slate-400">
      {text}
    </div>
  );
}
