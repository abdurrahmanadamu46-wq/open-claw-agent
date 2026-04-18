'use client';

import { useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, RefreshCw, Server } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchControlPlaneMonitorOverview } from '@/services/endpoints/ai-subservice';
import { useTenant } from '@/contexts/TenantContext';
import type { ExecutionMonitorNodeRow } from '@/services/endpoints/ai-subservice';
import type { ExecutionSnapshotSafetyPreview } from '@/types/execution-monitor';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';
const NODE_STATES = ['', 'ONLINE', 'BUSY', 'OFFLINE', 'ERROR', 'STARTING', 'INTERVENTION_REQUIRED'];

function formatDateTime(value?: string | number | null): string {
  if (!value) return '-';
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function statusLabel(status: string) {
  if (status === 'ONLINE') return '在线';
  if (status === 'BUSY') return '执行中';
  if (status === 'OFFLINE') return '离线';
  if (status === 'ERROR') return '异常';
  if (status === 'STARTING') return '启动中';
  if (status === 'INTERVENTION_REQUIRED') return '需人工介入';
  return status || '未知';
}

function NodeStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'ONLINE'
      ? 'bg-emerald-500/15 text-emerald-200'
      : status === 'BUSY'
        ? 'bg-amber-400/15 text-amber-200'
        : status === 'ERROR' || status === 'INTERVENTION_REQUIRED'
          ? 'bg-rose-500/15 text-rose-200'
          : status === 'STARTING'
            ? 'bg-cyan-400/10 text-cyan-200'
            : 'bg-slate-700 text-slate-400';
  return <span className={`rounded-full px-3 py-1 text-xs ${tone}`}>{statusLabel(status)}</span>;
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent || 'text-white'}`}>{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/30 px-4 py-10 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function NodeCard({ node }: { node: ExecutionMonitorNodeRow }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-white">{node.client_name || node.node_id}</span>
            <NodeStatusBadge status={node.status} />
          </div>
          <div className="mt-1 font-mono text-xs text-slate-400">{node.node_id}</div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex items-center gap-1 rounded-xl border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800/50"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? '收起' : '详情'}
        </button>
      </div>

      <div className="mt-3 grid gap-2">
        <InfoRow label="区域" value={node.region || '-'} />
        <InfoRow label="负载" value={node.load_percent != null ? `${node.load_percent}%` : '-'} />
        <InfoRow label="当前任务" value={node.running_task_id || '-'} />
        <InfoRow label="最近心跳" value={formatDateTime(node.last_seen_at)} />
      </div>

      {expanded ? (
        <div className="mt-4 rounded-xl bg-slate-900/60 p-3">
          <div className="text-xs uppercase tracking-[0.16em] text-slate-500">完整节点数据</div>
          <pre className="mt-2 overflow-x-auto text-xs text-slate-300">{JSON.stringify(node, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

type AuditEventType = 'node_seen' | 'task_log';

interface AuditEvent {
  id: string;
  type: AuditEventType;
  node_id: string;
  task_id?: string;
  message: string;
  level: string;
  ts: string;
}

function deriveAuditEvents(
  nodes: ExecutionMonitorNodeRow[],
  logs: { task_id: string; node_id: string; level: string; message: string; created_at: string; stage?: string }[],
): AuditEvent[] {
  const events: AuditEvent[] = [];

  nodes.forEach((node) => {
    if (node.last_seen_at) {
      events.push({
        id: `node-seen-${node.node_id}`,
        type: 'node_seen',
        node_id: node.node_id,
        task_id: node.running_task_id || undefined,
        message: `节点 ${node.client_name || node.node_id} 当前状态为 ${statusLabel(node.status)}${
          node.running_task_id ? `，正在执行任务 ${node.running_task_id}` : ''
        }`,
        level: node.status === 'ERROR' ? 'error' : node.status === 'BUSY' ? 'warn' : 'info',
        ts: node.last_seen_at,
      });
    }
  });

  logs.forEach((log, index) => {
    events.push({
      id: `log-${log.node_id}-${index}`,
      type: 'task_log',
      node_id: log.node_id,
      task_id: log.task_id,
      message: log.stage ? `[${log.stage}] ${log.message}` : log.message,
      level: log.level,
      ts: log.created_at,
    });
  });

  return events.sort((left, right) => new Date(right.ts).getTime() - new Date(left.ts).getTime());
}

function levelTone(level: string) {
  if (level === 'error') return 'bg-rose-500/15 text-rose-200';
  if (level === 'warn') return 'bg-amber-400/15 text-amber-200';
  if (level === 'info') return 'bg-cyan-400/10 text-cyan-200';
  return 'bg-white/5 text-slate-300';
}

export default function EdgeAuditPage() {
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';
  const [stateFilter, setStateFilter] = useState('');
  const [nodeFilter, setNodeFilter] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['edge-audit', tenantId],
    queryFn: () => fetchControlPlaneMonitorOverview(tenantId),
    refetchInterval: 15000,
  });

  const snapshot = data?.snapshot;
  const nodes = useMemo(() => (snapshot?.nodes ?? []) as ExecutionMonitorNodeRow[], [snapshot?.nodes]);
  const logs = useMemo(
    () =>
      (snapshot?.recent_logs ?? []) as {
        task_id: string;
        node_id: string;
        level: string;
        message: string;
        created_at: string;
        stage?: string;
      }[],
    [snapshot?.recent_logs],
  );
  const snapshots = useMemo(
    () => (snapshot?.recent_edge_snapshots ?? []) as ExecutionSnapshotSafetyPreview[],
    [snapshot?.recent_edge_snapshots],
  );

  const nodeOptions = useMemo(() => {
    const set = new Set<string>();
    nodes.forEach((node) => set.add(node.node_id));
    return ['', ...Array.from(set)];
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (stateFilter) result = result.filter((node) => node.status === stateFilter);
    if (nodeFilter) result = result.filter((node) => node.node_id === nodeFilter);
    return result;
  }, [nodes, nodeFilter, stateFilter]);

  const auditEvents = useMemo(() => {
    const events = deriveAuditEvents(nodes, logs);
    return nodeFilter ? events.filter((event) => event.node_id === nodeFilter) : events;
  }, [logs, nodeFilter, nodes]);

  const onlineCount = nodes.filter((node) => node.status === 'ONLINE').length;
  const busyCount = nodes.filter((node) => node.status === 'BUSY').length;
  const errorCount = nodes.filter((node) => node.status === 'ERROR' || node.status === 'INTERVENTION_REQUIRED').length;
  const blockedSnapshotCount = snapshots.filter((item) => item.blocked_steps > 0).length;

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-5">
        <section
          className="rounded-[30px] border p-6"
          style={{
            background: 'linear-gradient(135deg, rgba(20,34,58,0.98), rgba(11,21,35,0.98))',
            borderColor: BORDER,
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Edge Audit</div>
              <h1 className="mt-3 text-3xl font-semibold text-white">边缘节点审计追踪</h1>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                这里查看边缘节点的生命周期状态、任务分配历史、执行日志和安全快照。它只做观测和排障，不把执行逻辑放回前端。
              </p>
            </div>

            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
            >
              <RefreshCw className="h-4 w-4" />
              {isLoading ? '刷新中...' : '刷新'}
            </button>
          </div>

          {error ? <div className="mt-4 text-sm text-rose-200">数据加载失败，请检查 control-plane monitor overview 是否可用。</div> : null}

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <MetricCard label="节点总数" value={String(nodes.length)} />
            <MetricCard label="在线" value={String(onlineCount)} accent="text-emerald-300" />
            <MetricCard label="执行中" value={String(busyCount)} accent="text-amber-300" />
            <MetricCard label="异常 / 需介入" value={String(errorCount)} accent="text-rose-300" />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <MetricCard label="安全快照" value={String(snapshots.length)} />
            <MetricCard label="有拦截快照" value={String(blockedSnapshotCount)} accent="text-amber-300" />
            <MetricCard label="需审批步骤" value={String(snapshots.reduce((sum, item) => sum + item.needs_approval_steps, 0))} />
            <MetricCard label="已检查步骤" value={String(snapshots.reduce((sum, item) => sum + item.checked_steps, 0))} />
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <select
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
            className="rounded-2xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
          >
            {NODE_STATES.map((state) => (
              <option key={state} value={state}>
                {state ? statusLabel(state) : '全部状态'}
              </option>
            ))}
          </select>

          <select
            value={nodeFilter}
            onChange={(event) => setNodeFilter(event.target.value)}
            className="rounded-2xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
          >
            {nodeOptions.map((nodeId) => (
              <option key={nodeId} value={nodeId}>
                {nodeId || '全部节点'}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="rounded-[28px] border p-5" style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
              <Server className="h-4 w-4" />
              边缘节点 ({filteredNodes.length})
            </div>

            <div className="mt-4 space-y-3">
              {isLoading ? (
                <EmptyState text="正在加载节点状态..." />
              ) : filteredNodes.length ? (
                filteredNodes.map((node) => <NodeCard key={node.node_id} node={node} />)
              ) : (
                <EmptyState text="没有符合条件的边缘节点。边缘端启动并完成心跳后，会出现在这里。" />
              )}
            </div>
          </aside>

          <section className="rounded-[28px] border p-5" style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              <Activity className="h-4 w-4" />
              生命周期事件流 ({auditEvents.length})
            </div>

            <div className="mt-4 space-y-3">
              {auditEvents.length ? (
                auditEvents.slice(0, 80).map((event) => (
                  <div key={event.id} className="rounded-2xl border border-slate-700/70 bg-slate-950/35 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-xs text-slate-300">{event.node_id}</span>
                      {event.task_id ? (
                        <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">{event.task_id}</span>
                      ) : null}
                      <span className={`rounded-full px-3 py-1 text-xs ${levelTone(event.level)}`}>{event.level}</span>
                      <span className="rounded-full bg-fuchsia-400/10 px-3 py-1 text-xs text-fuchsia-300">
                        {event.type === 'node_seen' ? '节点心跳' : '任务日志'}
                      </span>
                    </div>
                    <div className="mt-3 text-sm leading-6 text-slate-100">{event.message}</div>
                    <div className="mt-2 text-xs text-slate-500">{formatDateTime(event.ts)}</div>
                  </div>
                ))
              ) : (
                <EmptyState text="暂无生命周期事件。边缘节点上线并执行任务后，状态变更会展示在这里。" />
              )}
            </div>
          </section>
        </div>

        <section className="rounded-[28px] border p-5" style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
            <Activity className="h-4 w-4" />
            安全快照摘要 ({snapshots.length})
          </div>

          <div className="mt-4 space-y-3">
            {snapshots.length ? (
              snapshots.map((item) => (
                <div key={item.snapshot_id} className="rounded-2xl border border-slate-700/70 bg-slate-950/35 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200">{item.snapshot_id}</span>
                    <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">{item.node_id}</span>
                    <span className={`rounded-full px-3 py-1 text-xs ${item.blocked_steps > 0 ? 'bg-amber-400/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'}`}>
                      blocked {item.blocked_steps}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <MetricCard label="任务" value={item.task_id || '-'} />
                    <MetricCard label="需审批" value={String(item.needs_approval_steps)} />
                    <MetricCard label="检查步骤" value={String(item.checked_steps)} />
                    <MetricCard label="耗时" value={`${item.duration_ms}ms`} />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{formatDateTime(item.created_at)}</div>
                </div>
              ))
            ) : (
              <EmptyState text="当前没有带安全摘要的执行快照。Edge 执行产生 snapshot 后，这里会显示 blocked / needs_approval 统计。" />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
