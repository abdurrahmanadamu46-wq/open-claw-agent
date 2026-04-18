'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, RefreshCw, RadioTower, Server, Wifi, WifiOff } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import {
  fetchControlPlaneMonitorOverview,
  type ExecutionMonitorEvent,
  type ExecutionMonitorNodeRow,
} from '@/services/endpoints/ai-subservice';
import type { ObservabilityOrlaSummary } from '@/types/distributed-tracing';
import type { EventBusPrefixSummary, EventBusSubjectStat } from '@/types/event-bus-traffic';
import {
  EXECUTION_LOGS_CONTRACT,
  parseExecutionLogsFrame,
} from '@/types/execution-monitor';
import type {
  ExecutionLogsHelloFrame,
  ExecutionLogsNodeHeartbeatFrame,
  RuntimeForegroundTask,
  RuntimeTaskNotificationPreview,
} from '@/types/execution-monitor';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';
const TERMINAL_WS_CLOSE_CODES = new Set([4400, 4401, 4403]);
const FALLBACK_SNAPSHOT_POLL_MS = 10_000;
const LIVE_AUXILIARY_SYNC_MS = 30_000;
const HEARTBEAT_WARN_MS = 90_000;
const HEARTBEAT_CRITICAL_MS = 180_000;
const RECEIPT_LAG_WARN_MS = 5 * 60_000;
const RECEIPT_LAG_CRITICAL_MS = 15 * 60_000;

type AlertSeverity = 'warn' | 'critical';

type HeartbeatAlertRow = {
  nodeId: string;
  displayName: string;
  severity: AlertSeverity;
  ageMs: number | null;
  status: string;
  lastSeenAt?: string | null;
  message: string;
};

type ReceiptLagAlertRow = {
  taskId: string;
  lobsterId: string;
  severity: AlertSeverity;
  ageMs: number | null;
  elapsedSec: number;
  lastSignalAt?: string | null;
  signalSource: 'log' | 'notification' | 'none';
  message: string;
};

type StabilityAlertCard = {
  id: string;
  kind: 'heartbeat' | 'receipt';
  severity: AlertSeverity;
  title: string;
  subtitle: string;
  ageLabel: string;
  detail: string;
  href: string;
  taskId?: string;
  nodeId?: string;
};

function deriveExecutionWsUrl(tenantId?: string): string | null {
  if (typeof window === 'undefined') return null;
  if (process.env.NEXT_PUBLIC_USE_MOCK === 'true') return null;
  const token = window.localStorage.getItem('clawcommerce_token');
  if (!token) return null;
  const buildBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || '').trim();
  const httpBaseUrl = buildBaseUrl
    || (
      window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
        ? `${window.location.protocol}//${window.location.hostname}:48789`
        : `${window.location.protocol}//${window.location.host}`
    );
  const base = new URL(httpBaseUrl, window.location.origin);
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({
    access_token: token,
  });
  if (tenantId) params.set('tenant_id', tenantId);
  return `${protocol}//${base.host}/ws/execution-logs?${params.toString()}`;
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

function upsertHeartbeatNode(
  current: ExecutionMonitorNodeRow[],
  frame: ExecutionLogsNodeHeartbeatFrame,
): ExecutionMonitorNodeRow[] {
  const nextNode: ExecutionMonitorNodeRow = {
    node_id: frame.node.node_id,
    tenant_id: frame.tenant_id,
    status: frame.node.status,
    last_seen_at: frame.node.last_seen_at,
    running_task_id: frame.node.running_task_id ?? null,
  };
  const index = current.findIndex((item) => item.node_id === frame.node.node_id);
  if (index < 0) {
    return [nextNode, ...current].slice(0, 50);
  }
  return current.map((item, itemIndex) => (
    itemIndex === index
      ? {
          ...item,
          status: nextNode.status,
          last_seen_at: nextNode.last_seen_at,
          running_task_id: nextNode.running_task_id,
        }
      : item
  ));
}

function describeWsCloseCode(code?: number): string {
  if (code === 4401) return '认证失败，access_token 无效或缺失';
  if (code === 4403) return 'tenant scope 越权，被服务端拒绝';
  if (code === 4400) return '请求参数不符合执行监控 contract';
  return '连接已关闭';
}

export default function ExecutionMonitorPage() {
  const searchParams = useSearchParams();
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';
  const initialTaskFilter = searchParams?.get('taskId') ?? 'all';
  const initialNodeFocus = searchParams?.get('nodeId') ?? '';
  const initialSubjectPrefix = searchParams?.get('subjectPrefix') ?? '';
  const validationTraceId = searchParams?.get('validationTraceId') ?? '';
  const validationTaskId = searchParams?.get('validationTaskId') ?? '';
  const validationNodeId = searchParams?.get('validationNodeId') ?? '';
  const validationQueue = searchParams?.get('validationQueue') ?? '';
  const validationMode = searchParams?.get('validationMode') ?? '';
  const validationStatus = searchParams?.get('validationStatus') ?? '';
  const validationStage = searchParams?.get('validationStage') ?? '';
  const validationAt = searchParams?.get('validationAt') ?? '';
  const validationOrigin = searchParams?.get('validationOrigin') ?? '';
  const monitorValidationCode = searchParams?.get('monitorValidationCode') ?? '';
  const monitorValidationAt = searchParams?.get('monitorValidationAt') ?? '';
  const logValidationCode = searchParams?.get('logValidationCode') ?? '';
  const logValidationAt = searchParams?.get('logValidationAt') ?? '';
  const baselineCapturedAt = searchParams?.get('baselineCapturedAt') ?? '';
  const baselineHeartbeatAlerts = searchParams?.get('baselineHeartbeatAlerts') ?? '';
  const baselineReceiptLagAlerts = searchParams?.get('baselineReceiptLagAlerts') ?? '';
  const baselineCriticalAlerts = searchParams?.get('baselineCriticalAlerts') ?? '';
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const lastSnapshotAtRef = useRef<string | null>(null);
  const unmountedRef = useRef(false);
  const [nodes, setNodes] = useState<ExecutionMonitorNodeRow[]>([]);
  const [logs, setLogs] = useState<ExecutionMonitorEvent[]>([]);
  const [runtimeForeground, setRuntimeForeground] = useState<RuntimeForegroundTask[]>([]);
  const [taskNotifications, setTaskNotifications] = useState<RuntimeTaskNotificationPreview[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>(initialTaskFilter || 'all');
  const [subjectPrefix, setSubjectPrefix] = useState<string>(initialSubjectPrefix);
  const [focusedNodeId, setFocusedNodeId] = useState<string>(initialNodeFocus);
  const [subjectRows, setSubjectRows] = useState<EventBusSubjectStat[]>([]);
  const [prefixRows, setPrefixRows] = useState<EventBusPrefixSummary[]>([]);
  const [orlaSummary, setOrlaSummary] = useState<ObservabilityOrlaSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [backgroundSyncError, setBackgroundSyncError] = useState('');
  const [wsState, setWsState] = useState<'connecting' | 'connected' | 'disconnected' | 'blocked'>('disconnected');
  const [nowTimestamp, setNowTimestamp] = useState<number | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [wsHello, setWsHello] = useState<ExecutionLogsHelloFrame | null>(null);
  const [wsCloseInfo, setWsCloseInfo] = useState<{ code?: number; reason?: string } | null>(null);
  const [wsFrameError, setWsFrameError] = useState('');
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null);

  const loadSnapshot = useCallback(async (options?: {
    signal?: AbortSignal;
    preserveOnError?: boolean;
    background?: boolean;
    scope?: 'all' | 'auxiliary';
  }) => {
    const signal = options?.signal;
    const preserveOnError = options?.preserveOnError ?? false;
    const background = options?.background ?? false;
    const scope = options?.scope ?? 'all';
    if (!background) setLoading(true);
    if (background) {
      setBackgroundSyncError('');
    } else {
      setErrorText('');
    }
    try {
      const overview = await fetchControlPlaneMonitorOverview(tenantId, subjectPrefix || undefined);
      if (signal?.aborted) return;
      if (scope === 'all') {
        setNodes(overview.snapshot?.nodes || []);
        setLogs(overview.snapshot?.recent_logs || []);
      }
      setRuntimeForeground(overview.snapshot?.runtime_foreground || []);
      setTaskNotifications(overview.snapshot?.recent_task_notifications || []);
      setSubjectRows(overview.event_bus?.subjects?.subjects || []);
      setPrefixRows(overview.event_bus?.prefixes?.prefixes || []);
      setOrlaSummary(overview.kernel?.orla_dispatcher || null);
      setLastSnapshotAt(overview.generated_at || new Date().toISOString());
      if (background) setBackgroundSyncError('');
    } catch (error) {
      if (signal?.aborted) return;
      const normalizedError = normalizeAxiosError(error);
      if (background) {
        setBackgroundSyncError(`后台同步失败：${normalizedError}`);
      } else {
        setErrorText(normalizedError);
      }
      if (!preserveOnError) {
        if (scope === 'all') {
          setNodes([]);
          setLogs([]);
        }
        setRuntimeForeground([]);
        setTaskNotifications([]);
        setSubjectRows([]);
        setPrefixRows([]);
        setOrlaSummary(null);
      }
    } finally {
      if (!signal?.aborted && !background) setLoading(false);
    }
  }, [tenantId, subjectPrefix]);

  useEffect(() => {
    setSelectedTaskId(initialTaskFilter || 'all');
    setSubjectPrefix(initialSubjectPrefix);
    setFocusedNodeId(initialNodeFocus);
  }, [initialNodeFocus, initialSubjectPrefix, initialTaskFilter]);

  useEffect(() => {
    setNodes([]);
    setLogs([]);
    setRuntimeForeground([]);
    setTaskNotifications([]);
    setSubjectRows([]);
    setPrefixRows([]);
    setErrorText('');
    setBackgroundSyncError('');
    setWsHello(null);
    setWsCloseInfo(null);
    setWsFrameError('');
    setLastSnapshotAt(null);
  }, [tenantId]);

  useEffect(() => {
    setNowTimestamp(Date.now());
    const timer = window.setInterval(() => setNowTimestamp(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setWsUrl(deriveExecutionWsUrl(tenantId));
  }, [tenantId]);

  useEffect(() => {
    lastSnapshotAtRef.current = lastSnapshotAt;
  }, [lastSnapshotAt]);

  useEffect(() => {
    unmountedRef.current = false;
    if (typeof wsUrl !== 'string') return;
    const resolvedWsUrl: string = wsUrl;

    function connect() {
      if (unmountedRef.current) return;
      setWsState('connecting');
      setWsHello(null);
      setWsCloseInfo(null);
      setWsFrameError('');
      const socket = new WebSocket(resolvedWsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        if (unmountedRef.current) {
          // Nullify handlers before close to prevent onclose from scheduling reconnect
          socket.onclose = null;
          socket.onerror = null;
          socket.onmessage = null;
          socket.close();
          return;
        }
        reconnectAttemptRef.current = 0;
      };

      socket.onerror = () => {
        if (!unmountedRef.current) setWsState('disconnected');
      };

      socket.onclose = (event) => {
        if (unmountedRef.current) return;
        setWsCloseInfo({ code: event.code, reason: event.reason });
        if (TERMINAL_WS_CLOSE_CODES.has(event.code)) {
          setWsState('blocked');
          if (event.code === 4401 || event.code === 4403) {
            setWsFrameError(`WebSocket rejected (${event.code}): ${event.reason || describeWsCloseCode(event.code)}`);
          }
          return;
        }
        setWsState('disconnected');
        // Exponential backoff: 2s, 4s, 8s … capped at 30s
        const delay = Math.min(2000 * Math.pow(2, reconnectAttemptRef.current), 30000);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      socket.onmessage = (event) => {
        if (unmountedRef.current) return;
        try {
          const payload = JSON.parse(String(event.data || '{}')) as unknown;
          const frame = parseExecutionLogsFrame(payload);
          if (!frame) return;
          if (frame.type === 'hello') {
            setWsHello(frame);
            setWsFrameError('');
            setWsState('connected');
            return;
          }
          if (frame.type === 'execution_log') {
            if (!frame.event?.task_id) return;
            setLogs((prev) => [frame.event, ...prev].slice(0, 80));
            return;
          }
          if (frame.type === 'node_heartbeat') {
            setNodes((prev) => upsertHeartbeatNode(prev, frame));
            return;
          }
          if (frame.type === 'error') {
            setWsFrameError(`WebSocket ${frame.code}: ${frame.message}`);
          }
        } catch {
          // Ignore malformed frames; this page is an observer, not the protocol owner.
        }
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const s = socketRef.current;
      socketRef.current = null;
      if (s) {
        // Nullify all event handlers immediately so nothing fires after unmount
        s.onopen = null;
        s.onclose = null;
        s.onerror = null;
        s.onmessage = null;
        // Defer the actual close to the next tick so the router transition
        // can complete first. Calling WebSocket.close() while the socket is
        // in CONNECTING state can block the browser's event loop until the
        // TCP handshake times out, which freezes navigation.
        setTimeout(() => {
          if (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING) {
            s.close();
          }
        }, 0);
      }
    };
  }, [wsUrl]);

  const taskOptions = useMemo(() => {
    const values = new Set<string>();
    logs.forEach((item) => {
      if (item.task_id) values.add(item.task_id);
    });
    runtimeForeground.forEach((item) => {
      if (item.task_id) values.add(item.task_id);
    });
    return ['all', ...Array.from(values)];
  }, [logs, runtimeForeground]);

  const filteredLogs = useMemo(() => {
    if (selectedTaskId === 'all') return logs;
    return logs.filter((item) => item.task_id === selectedTaskId);
  }, [logs, selectedTaskId]);
  const monitorNowMs = nowTimestamp ?? Date.now();
  const latestLogMsByTask = useMemo(() => {
    const map = new Map<string, number>();
    logs.forEach((item) => {
      const timestamp = toTimestampMs(item.created_at);
      if (!item.task_id || timestamp === null) return;
      const prev = map.get(item.task_id) ?? 0;
      if (timestamp > prev) map.set(item.task_id, timestamp);
    });
    return map;
  }, [logs]);
  const latestNotificationMsByTask = useMemo(() => {
    const map = new Map<string, number>();
    taskNotifications.forEach((item) => {
      const timestamp = toTimestampMs(item.created_at);
      if (!item.task_id || timestamp === null) return;
      const prev = map.get(item.task_id) ?? 0;
      if (timestamp > prev) map.set(item.task_id, timestamp);
    });
    return map;
  }, [taskNotifications]);
  const heartbeatAlerts = useMemo<HeartbeatAlertRow[]>(() => {
    const rows = nodes.reduce<HeartbeatAlertRow[]>((acc, node) => {
      if (String(node.status).toUpperCase() === 'OFFLINE') return acc;
      const lastSeenMs = toTimestampMs(node.last_seen_at);
      if (lastSeenMs === null) {
        acc.push({
          nodeId: node.node_id,
          displayName: node.client_name || node.node_id,
          severity: 'warn',
          ageMs: null,
          status: node.status,
          lastSeenAt: node.last_seen_at || null,
          message: '缺少最近心跳时间，节点在线状态可能不可靠。',
        });
        return acc;
      }
      const ageMs = Math.max(0, monitorNowMs - lastSeenMs);
      if (ageMs < HEARTBEAT_WARN_MS) return acc;
      acc.push({
        nodeId: node.node_id,
        displayName: node.client_name || node.node_id,
        severity: ageMs >= HEARTBEAT_CRITICAL_MS ? 'critical' : 'warn',
        ageMs,
        status: node.status,
        lastSeenAt: node.last_seen_at || null,
        message:
          ageMs >= HEARTBEAT_CRITICAL_MS
            ? '心跳超时过久，请优先确认边缘端是否失联。'
            : '心跳已经超时，建议检查边缘端连接状态。',
      });
      return acc;
    }, []);

    return rows.sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || (right.ageMs ?? 0) - (left.ageMs ?? 0));
  }, [monitorNowMs, nodes]);
  const receiptLagAlerts = useMemo<ReceiptLagAlertRow[]>(() => {
    const rows = runtimeForeground.reduce<ReceiptLagAlertRow[]>((acc, task) => {
      if (isTerminalTaskStatus(task.status)) return acc;
      const elapsedSec = Number(task.elapsed_sec ?? 0) || 0;
      const elapsedMs = Math.max(0, elapsedSec * 1000);
      if (elapsedMs < RECEIPT_LAG_WARN_MS) return acc;
      const latestLogMs = latestLogMsByTask.get(task.task_id) ?? null;
      const latestNotificationMs = latestNotificationMsByTask.get(task.task_id) ?? null;
      const lastSignalMs = Math.max(latestLogMs ?? 0, latestNotificationMs ?? 0) || null;
      const signalSource: ReceiptLagAlertRow['signalSource'] =
        lastSignalMs === null
          ? 'none'
          : latestNotificationMs !== null && latestNotificationMs >= (latestLogMs ?? 0)
            ? 'notification'
            : 'log';
      const lagMs = lastSignalMs === null ? elapsedMs : Math.max(0, monitorNowMs - lastSignalMs);
      if (lagMs < RECEIPT_LAG_WARN_MS) return acc;
      acc.push({
        taskId: task.task_id,
        lobsterId: task.lobster_id,
        severity: lagMs >= RECEIPT_LAG_CRITICAL_MS ? 'critical' : 'warn',
        ageMs: lastSignalMs === null ? null : lagMs,
        elapsedSec,
        lastSignalAt: lastSignalMs ? new Date(lastSignalMs).toISOString() : null,
        signalSource,
        message:
          lastSignalMs === null
            ? '任务已运行较久，但还没有看到任何日志或通知回执。'
            : lagMs >= RECEIPT_LAG_CRITICAL_MS
              ? '最近一次回执已经滞后过久，任务可能卡住。'
              : '最近一次回执偏旧，建议确认任务是否仍在推进。',
      });
      return acc;
    }, []);

    return rows.sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || (right.ageMs ?? 0) - (left.ageMs ?? 0));
  }, [latestLogMsByTask, latestNotificationMsByTask, monitorNowMs, runtimeForeground]);
  const heartbeatAlertMap = useMemo(() => new Map(heartbeatAlerts.map((item) => [item.nodeId, item])), [heartbeatAlerts]);
  const receiptLagAlertMap = useMemo(() => new Map(receiptLagAlerts.map((item) => [item.taskId, item])), [receiptLagAlerts]);
  const criticalAlertCount = useMemo(
    () =>
      heartbeatAlerts.filter((item) => item.severity === 'critical').length
      + receiptLagAlerts.filter((item) => item.severity === 'critical').length,
    [heartbeatAlerts, receiptLagAlerts],
  );
  const validationForwardParams = useMemo(() => ({
    validationTraceId: validationTraceId || undefined,
    validationTaskId: validationTaskId || undefined,
    validationNodeId: validationNodeId || undefined,
    validationQueue: validationQueue || undefined,
    validationMode: validationMode || undefined,
    validationStatus: validationStatus || undefined,
    validationStage: validationStage || undefined,
    validationAt: validationAt || undefined,
    validationOrigin: validationOrigin || undefined,
    baselineCapturedAt: baselineCapturedAt || undefined,
    baselineHeartbeatAlerts: String(heartbeatAlerts.length),
    baselineReceiptLagAlerts: String(receiptLagAlerts.length),
    baselineCriticalAlerts: String(criticalAlertCount),
  }), [
    baselineCapturedAt,
    criticalAlertCount,
    heartbeatAlerts.length,
    receiptLagAlerts.length,
    validationAt,
    validationMode,
    validationNodeId,
    validationOrigin,
    validationQueue,
    validationStage,
    validationStatus,
    validationTaskId,
    validationTraceId,
  ]);
  const stabilityAlerts = useMemo<StabilityAlertCard[]>(() => {
    return [
      ...heartbeatAlerts.map((item) => ({
        id: `heartbeat:${item.nodeId}`,
        kind: 'heartbeat' as const,
        severity: item.severity,
        title: item.displayName,
        subtitle: `${item.nodeId} · ${item.status}`,
        ageLabel: item.ageMs === null ? 'missing' : formatDuration(item.ageMs),
        detail: item.message,
        href: buildLogAuditHref({ nodeId: item.nodeId, module: 'FLEET', errorsOnly: true, validation: validationForwardParams }),
        nodeId: item.nodeId,
      })),
      ...receiptLagAlerts.map((item) => ({
        id: `receipt:${item.taskId}`,
        kind: 'receipt' as const,
        severity: item.severity,
        title: item.taskId,
        subtitle: `${item.lobsterId || 'unknown'} · ${describeSignalSource(item.signalSource)}`,
        ageLabel: item.ageMs === null ? 'none' : formatDuration(item.ageMs),
        detail: item.message,
        href: buildLogAuditHref({ keyword: item.taskId, module: 'FLEET', errorsOnly: true, validation: validationForwardParams }),
        taskId: item.taskId,
      })),
    ].sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
  }, [heartbeatAlerts, receiptLagAlerts, validationForwardParams]);
  const validationFeedback = useMemo(() => {
    if (!validationTraceId) return null;
    const heartbeatTrend = compareCountTrend(heartbeatAlerts.length, parseCountParam(baselineHeartbeatAlerts));
    const receiptTrend = compareCountTrend(receiptLagAlerts.length, parseCountParam(baselineReceiptLagAlerts));
    const criticalTrend = compareCountTrend(criticalAlertCount, parseCountParam(baselineCriticalAlerts));
    const trends = [heartbeatTrend, receiptTrend, criticalTrend].filter(
      (item): item is { label: string; tone: string; direction: 'flat' | 'down' | 'up'; delta: number } => item !== null,
    );
    return {
      traceId: validationTraceId,
      taskId: validationTaskId,
      nodeId: validationNodeId,
      queue: validationQueue,
      mode: validationMode,
      status: validationStatus,
      stage: validationStage,
      at: validationAt,
      origin: validationOrigin,
      baselineAt: baselineCapturedAt,
      trends,
      conclusion: resolveMonitorValidationConclusion({
        status: validationStatus,
        currentRiskCount: heartbeatAlerts.length + receiptLagAlerts.length,
        currentCriticalCount: criticalAlertCount,
        trends,
      }),
    };
  }, [
    baselineCapturedAt,
    baselineCriticalAlerts,
    baselineHeartbeatAlerts,
    baselineReceiptLagAlerts,
    criticalAlertCount,
    heartbeatAlerts.length,
    receiptLagAlerts.length,
    validationAt,
    validationMode,
    validationNodeId,
    validationOrigin,
    validationQueue,
    validationStage,
    validationStatus,
    validationTaskId,
    validationTraceId,
  ]);
  const validationRelayParams = useMemo(() => ({
    ...validationForwardParams,
    monitorValidationCode: validationFeedback ? encodeValidationConclusionCode(validationFeedback.conclusion.label) : (monitorValidationCode || undefined),
    monitorValidationAt: validationFeedback ? (lastSnapshotAt || validationAt || undefined) : (monitorValidationAt || undefined),
    logValidationCode: logValidationCode || undefined,
    logValidationAt: logValidationAt || undefined,
  }), [
    lastSnapshotAt,
    logValidationAt,
    logValidationCode,
    monitorValidationAt,
    monitorValidationCode,
    validationAt,
    validationFeedback,
    validationForwardParams,
  ]);
  const validationLogAuditHref = useMemo(() => {
    if (!validationTraceId) return '/operations/log-audit';
    return buildLogAuditHref({
      traceId: validationTraceId,
      keyword: validationTaskId || undefined,
      nodeId: validationNodeId || undefined,
      module: 'FLEET',
      errorsOnly: true,
      validation: validationRelayParams,
    });
  }, [validationNodeId, validationRelayParams, validationTaskId, validationTraceId]);
  const validationTraceHref = useMemo(() => {
    if (!validationTraceId) return '/operations/autopilot/trace';
    return buildTraceHref({
      traceId: validationTraceId,
      sourceQueue: validationQueue || undefined,
      validation: validationRelayParams,
    });
  }, [validationQueue, validationRelayParams, validationTraceId]);
  const validationRollbackHref = useMemo(() => {
    if (!validationTraceId) return '/operations/autopilot/trace#rollback-approval';
    return buildTraceHref({
      traceId: validationTraceId,
      sourceQueue: validationQueue || undefined,
      validation: validationRelayParams,
      anchor: '#rollback-approval',
    });
  }, [validationQueue, validationRelayParams, validationTraceId]);
  const validationActions = useMemo(() => {
    if (!validationFeedback) return [];
    if (validationFeedback.conclusion.label === '已恢复') {
      return [
        { label: '回日志审核留痕', href: validationLogAuditHref, tone: 'border-white/12 bg-white/5 text-white' },
        { label: '回 Trace 复盘留痕', href: validationTraceHref, tone: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100' },
      ];
    }
    if (validationFeedback.conclusion.label === '未恢复') {
      return [
        { label: '回 Trace 继续处理', href: validationRollbackHref, tone: 'border-rose-400/30 bg-rose-400/10 text-rose-100' },
        { label: '去日志审核看异常', href: validationLogAuditHref, tone: 'border-white/12 bg-white/5 text-white' },
      ];
    }
    if (validationFeedback.conclusion.label === '正在改善') {
      return [
        { label: '去日志审核继续对比', href: validationLogAuditHref, tone: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100' },
        { label: '回 Trace 看处理上下文', href: validationTraceHref, tone: 'border-white/12 bg-white/5 text-white' },
      ];
    }
    return [
      { label: '回 Trace 看处理状态', href: validationTraceHref, tone: 'border-white/12 bg-white/5 text-white' },
      { label: '去日志审核继续观察', href: validationLogAuditHref, tone: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100' },
    ];
  }, [validationFeedback, validationLogAuditHref, validationRollbackHref, validationTraceHref]);

  const topOrlaStage = useMemo(() => getTopKey(orlaSummary?.by_stage), [orlaSummary]);
  const topOrlaTier = useMemo(() => getTopKey(orlaSummary?.by_tier), [orlaSummary]);
  const topPromotionTrigger = useMemo(() => getTopKey(orlaSummary?.promotion_triggers), [orlaSummary]);

  useEffect(() => {
    const abortController = new AbortController();
    void loadSnapshot({ signal: abortController.signal });
    return () => abortController.abort();
  }, [loadSnapshot]);

  const snapshotMode = wsState !== 'connected';
  const snapshotModeReason = useMemo(() => {
    if (wsState === 'blocked') return '实时流握手失败，已切换到快照轮询。';
    if (!wsUrl) return '当前没有可用 WebSocket 地址，页面将持续使用快照模式。';
    if (wsState === 'disconnected') return '实时流暂时断开，页面正在用快照轮询兜底。';
    if (wsState === 'connecting') return '实时流连接中，页面先用快照保持监控可见。';
    return '';
  }, [wsState, wsUrl]);

  useEffect(() => {
    if (!snapshotMode) return;
    const abortController = new AbortController();
    if (lastSnapshotAtRef.current) {
      void loadSnapshot({ signal: abortController.signal, preserveOnError: true, background: true, scope: 'all' });
    }
    const timer = window.setInterval(() => {
      void loadSnapshot({ preserveOnError: true, background: true, scope: 'all' });
    }, FALLBACK_SNAPSHOT_POLL_MS);
    return () => {
      abortController.abort();
      window.clearInterval(timer);
    };
  }, [loadSnapshot, snapshotMode]);

  useEffect(() => {
    if (wsState !== 'connected') return;
    const timer = window.setInterval(() => {
      void loadSnapshot({ preserveOnError: true, background: true, scope: 'auxiliary' });
    }, LIVE_AUXILIARY_SYNC_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadSnapshot, wsState]);

  return (
    <div className="p-6 text-slate-100">
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
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                  contract: {EXECUTION_LOGS_CONTRACT}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                  tenant: {wsHello?.tenant_id || tenantId}
                </span>
                {wsHello?.connection_id ? (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                    conn: {wsHello.connection_id}
                  </span>
                ) : null}
                {wsHello?.auth.roles?.length ? (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                    roles: {wsHello.auth.roles.join(', ')}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <StatusPill state={wsState} reconnectAttempt={reconnectAttemptRef.current} closeCode={wsCloseInfo?.code} />
              <SnapshotModePill
                snapshotMode={snapshotMode}
                lastSnapshotAt={lastSnapshotAt}
                pollMs={FALLBACK_SNAPSHOT_POLL_MS}
                liveAuxSyncMs={LIVE_AUXILIARY_SYNC_MS}
              />
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
          {snapshotModeReason ? <div className="mt-2 text-sm text-amber-100">{snapshotModeReason}</div> : null}
          {backgroundSyncError ? <div className="mt-2 text-sm text-amber-100">{backgroundSyncError}</div> : null}
          {wsFrameError ? <div className="mt-2 text-sm text-amber-100">{wsFrameError}</div> : null}
          {wsCloseInfo?.code ? (
            <div className="mt-2 text-sm text-slate-300">
              WebSocket close code {wsCloseInfo.code}: {wsCloseInfo.reason || describeWsCloseCode(wsCloseInfo.code)}
            </div>
          ) : null}
          {validationFeedback ? (
            <div className="mt-5 rounded-[26px] border border-emerald-400/20 bg-emerald-400/10 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-emerald-200">Validation Feedback</div>
                  <div className="mt-2 text-lg font-semibold text-white">正在验证 Trace 处理结果</div>
                  <div className="mt-2 text-sm leading-7 text-slate-100">
                    当前回流来自 <span className="font-mono text-emerald-100">{validationFeedback.traceId}</span>。
                    重点先看心跳超时、回执滞后、实时日志是否还有持续异常。
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
                {validationFeedback.at ? <span className="rounded-full bg-white/5 px-3 py-1">return {formatDateTime(validationFeedback.at)}</span> : null}
                {validationFeedback.baselineAt ? <span className="rounded-full bg-white/5 px-3 py-1">baseline {formatDateTime(validationFeedback.baselineAt)}</span> : null}
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
            </div>
          ) : null}

          <div id="stability-alerts" className="mt-5 rounded-[26px] border border-rose-400/15 bg-rose-500/[0.05] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-rose-300">Stability Alerts</div>
                <div className="mt-2 text-lg font-semibold text-white">心跳超时与回执滞后</div>
                <div className="mt-2 text-sm text-slate-300">
                  心跳按 30s 约定做超时判断：90s 预警，180s 严重。回执按运行中任务最近一次日志/通知信号判断：5m 预警，15m 严重。
                </div>
              </div>
              <div className="text-xs text-slate-400">
                当前命中 <span className="font-semibold text-white">{stabilityAlerts.length}</span> 条风险
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <MetricCard label="心跳超时" value={String(heartbeatAlerts.length)} />
              <MetricCard label="回执滞后" value={String(receiptLagAlerts.length)} />
              <MetricCard label="严重告警" value={String(criticalAlertCount)} />
              <MetricCard label="最新快照" value={lastSnapshotAt ? formatDateTime(lastSnapshotAt) : '-'} />
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {stabilityAlerts.length ? (
                stabilityAlerts.slice(0, 6).map((alert) => (
                  <div key={alert.id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs ${alertSeverityTone(alert.severity)}`}>
                        {alertSeverityLabel(alert.severity)}
                      </span>
                      <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">
                        {alert.kind === 'heartbeat' ? 'heartbeat' : 'receipt'}
                      </span>
                      <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-400">
                        age {alert.ageLabel}
                      </span>
                    </div>
                    <div className="mt-3 text-sm font-semibold text-white">{alert.title}</div>
                    <div className="mt-1 text-xs text-slate-400">{alert.subtitle}</div>
                    <div className="mt-3 text-sm leading-7 text-slate-200">{alert.detail}</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {alert.taskId ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (alert.taskId) setSelectedTaskId(alert.taskId);
                          }}
                          className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100"
                        >
                          筛选实时日志
                        </button>
                      ) : null}
                      <Link
                        href={alert.href}
                        className="rounded-xl border border-white/12 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/5"
                      >
                        去日志审核
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState text="当前没有命中心跳超时或回执滞后风险。" />
              )}
            </div>
          </div>

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

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <MetricCard label="前台任务" value={String(runtimeForeground.length)} />
            <MetricCard label="后台通知" value={String(taskNotifications.length)} />
            <MetricCard label="最新通知状态" value={taskNotifications[0]?.status || '-'} />
            <MetricCard label="最新通知角色" value={taskNotifications[0]?.lobster_id || '-'} />
          </div>

          <div className="mt-5 rounded-[26px] border border-cyan-400/15 bg-cyan-500/[0.05] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Orla Pilot</div>
                <div className="mt-2 text-lg font-semibold text-white">Dispatcher 阶段路由观测</div>
                <div className="mt-2 text-sm text-slate-300">
                  这里直接消费 `/api/observability/dashboard` 的 `orla_dispatcher` 汇总，看本轮 dispatcher pilot 是否真的在压缩编排税。
                </div>
              </div>
              <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/40 px-4 py-3 text-right">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-400">共享状态命中率</div>
                <div className="mt-2 text-2xl font-semibold text-cyan-100">
                  {orlaSummary ? `${Math.round((orlaSummary.shared_state_hit_rate || 0) * 100)}%` : '-'}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <MetricCard label="Dispatcher 总执行" value={String(orlaSummary?.dispatcher_total ?? 0)} />
              <MetricCard label="Orla 启用次数" value={String(orlaSummary?.orla_enabled_total ?? 0)} />
              <MetricCard label="成功次数" value={String(orlaSummary?.success_count ?? 0)} />
              <MetricCard label="主阶段" value={topOrlaStage || '-'} />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <RecordPanel title="阶段分布" rows={orlaSummary?.by_stage} emptyText="暂无阶段数据" />
              <RecordPanel title="Tier 分布" rows={orlaSummary?.by_tier} emptyText="暂无 tier 数据" highlightKey={topOrlaTier || undefined} />
              <RecordPanel title="升档触发" rows={orlaSummary?.promotion_triggers} emptyText="暂无升档触发" highlightKey={topPromotionTrigger || undefined} />
            </div>
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
                  <div
                    key={node.node_id}
                    className={`rounded-2xl border bg-slate-950/35 p-4 ${
                      focusedNodeId === node.node_id
                        ? 'border-cyan-400/45 ring-1 ring-cyan-400/20'
                        : 'border-slate-700/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-white">{node.client_name || node.node_id}</div>
                        <div className="mt-1 text-xs text-slate-400">{node.node_id}</div>
                      </div>
                      <NodeStatusBadge status={node.status} />
                    </div>

                    {heartbeatAlertMap.get(node.node_id) ? (
                      <div className={`mt-3 rounded-xl px-3 py-2 text-sm ${alertSeverityTone(heartbeatAlertMap.get(node.node_id)!.severity)}`}>
                        {heartbeatAlertMap.get(node.node_id)!.message}
                        <span className="ml-2 text-xs opacity-80">
                          {heartbeatAlertMap.get(node.node_id)!.ageMs === null ? 'missing heartbeat' : `超时 ${formatDuration(heartbeatAlertMap.get(node.node_id)!.ageMs)}`}
                        </span>
                      </div>
                    ) : null}

                    <div className="mt-3 grid gap-2 text-sm text-slate-300">
                      <InfoRow label="地域" value={node.region || '-'} />
                      <InfoRow label="负载" value={node.load_percent != null ? `${node.load_percent}%` : '-'} />
                      <InfoRow label="任务" value={node.running_task_id || '-'} />
                      <InfoRow label="最近心跳" value={formatDateTime(node.last_seen_at)} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={buildLogAuditHref({ nodeId: node.node_id, module: 'FLEET', errorsOnly: true, validation: validationForwardParams })}
                        className="rounded-xl border border-white/12 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/5"
                      >
                        查看节点日志
                      </Link>
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
                  WebSocket 地址: <span className="text-slate-200">{wsUrl || 'unavailable'}</span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  frames: hello | execution_log | node_heartbeat | error
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
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-300">
              <Wifi className="h-4 w-4" />
              Runtime 前台任务
            </div>

            <div className="mt-4 space-y-3">
              {runtimeForeground.length ? (
                runtimeForeground.map((task) => (
                  <div
                    key={task.task_id}
                    className={`rounded-2xl border bg-slate-950/35 p-4 ${
                      selectedTaskId === task.task_id
                        ? 'border-cyan-400/45 ring-1 ring-cyan-400/20'
                        : 'border-slate-700/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">{task.description || task.task_id}</div>
                        <div className="mt-1 text-xs text-slate-400">{task.task_id}</div>
                      </div>
                      <TaskStatusBadge status={task.status || 'running'} />
                    </div>
                    {receiptLagAlertMap.get(task.task_id) ? (
                      <div className={`mt-3 rounded-xl px-3 py-2 text-sm ${alertSeverityTone(receiptLagAlertMap.get(task.task_id)!.severity)}`}>
                        {receiptLagAlertMap.get(task.task_id)!.message}
                        <span className="ml-2 text-xs opacity-80">
                          {receiptLagAlertMap.get(task.task_id)!.ageMs === null
                            ? '暂无回执'
                            : `滞后 ${formatDuration(receiptLagAlertMap.get(task.task_id)!.ageMs)}`}
                        </span>
                      </div>
                    ) : null}
                    <div className="mt-3 grid gap-2 text-sm text-slate-300">
                      <InfoRow label="角色" value={task.lobster_id || '-'} />
                      <InfoRow label="模式" value={task.mode || '-'} />
                      <InfoRow label="已运行" value={task.elapsed_sec != null ? `${task.elapsed_sec}s` : '-'} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedTaskId(task.task_id)}
                        className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100"
                      >
                        筛选实时日志
                      </button>
                      <Link
                        href={buildLogAuditHref({ keyword: task.task_id, module: 'FLEET', errorsOnly: true, validation: validationForwardParams })}
                        className="rounded-xl border border-white/12 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/5"
                      >
                        去日志审核
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState text="当前没有前台 runtime 任务。角色执行转后台后，这里会保留统一任务视图。" />
              )}
            </div>
          </aside>

          <section
            className="rounded-[28px] border p-5"
            style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-300">
              <Activity className="h-4 w-4" />
              最近任务通知
            </div>

            <div className="mt-4 space-y-3">
              {taskNotifications.length ? (
                taskNotifications.map((item) => (
                  <div key={item.activity_id} className="rounded-2xl border border-slate-700/70 bg-slate-950/35 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200">{item.task_id}</span>
                      <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">{item.lobster_id}</span>
                      <TaskStatusBadge status={item.status} />
                      <ModeBadge mode={item.mode} />
                    </div>
                    <div className="mt-3 text-sm leading-7 text-slate-100">{item.summary || '任务已完成并推送通知'}</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <MiniMetric label="Tokens" value={String(item.total_tokens || 0)} />
                      <MiniMetric label="Tools" value={String(item.tool_uses || 0)} />
                      <MiniMetric label="耗时" value={item.duration_ms != null ? `${item.duration_ms}ms` : '-'} />
                    </div>
                    <div className="mt-2 text-xs text-slate-500">{formatDateTime(item.created_at)}</div>
                  </div>
                ))
              ) : (
                <EmptyState text="当前还没有 task notification 预览。后台任务完成后，这里会显示结构化通知摘要。" />
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
                          last {formatRelativeTime(row.last_published_at, nowTimestamp)}
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

function formatRelativeTime(timestamp: number | undefined, nowTimestamp: number | null): string {
  if (!timestamp || !nowTimestamp) return '-';
  const sec = Math.max(0, Math.floor(nowTimestamp / 1000 - timestamp));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function StatusPill({
  state,
  reconnectAttempt = 0,
  closeCode,
}: {
  state: 'connecting' | 'connected' | 'disconnected' | 'blocked';
  reconnectAttempt?: number;
  closeCode?: number;
}) {
  const icon =
    state === 'connected'
      ? <Wifi className="h-4 w-4" />
      : state === 'connecting'
        ? <RadioTower className="h-4 w-4 animate-pulse" />
        : <WifiOff className="h-4 w-4" />;
  const tone =
    state === 'connected'
      ? 'bg-emerald-500/15 text-emerald-200'
      : state === 'connecting'
        ? 'bg-amber-400/15 text-amber-200'
        : state === 'blocked'
          ? 'bg-rose-500/15 text-rose-200'
          : 'bg-slate-800 text-slate-400';
  const label =
    state === 'connected'
      ? '已连接'
      : state === 'connecting'
        ? '连接中...'
        : state === 'blocked'
          ? '握手被拒绝'
          : '已断开';
  const sub =
    state === 'blocked' && closeCode
      ? `close ${closeCode}`
      : state === 'disconnected' && reconnectAttempt > 0
        ? `重连第 ${reconnectAttempt} 次`
        : null;
  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${tone}`}>
      {icon}
      <span>{label}</span>
      {sub && <span className="text-xs opacity-70">· {sub}</span>}
    </div>
  );
}

function SnapshotModePill({
  snapshotMode,
  lastSnapshotAt,
  pollMs,
  liveAuxSyncMs,
}: {
  snapshotMode: boolean;
  lastSnapshotAt?: string | null;
  pollMs: number;
  liveAuxSyncMs: number;
}) {
  const tone = snapshotMode ? 'bg-amber-400/15 text-amber-200' : 'bg-cyan-400/10 text-cyan-100';
  const label = snapshotMode ? 'snapshot mode' : 'live stream';
  const sub = snapshotMode
    ? `轮询 ${Math.round(pollMs / 1000)}s`
    : [
        `辅助同步 ${Math.round(liveAuxSyncMs / 1000)}s`,
        lastSnapshotAt ? `快照 ${formatDateTime(lastSnapshotAt)}` : null,
      ].filter(Boolean).join(' · ');
  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${tone}`}>
      {snapshotMode ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
      <span>{label}</span>
      {sub ? <span className="text-xs opacity-70">· {sub}</span> : null}
    </div>
  );
}

function severityRank(severity: AlertSeverity): number {
  return severity === 'critical' ? 2 : 1;
}

function alertSeverityTone(severity: AlertSeverity): string {
  return severity === 'critical'
    ? 'bg-rose-500/15 text-rose-200'
    : 'bg-amber-400/15 text-amber-200';
}

function alertSeverityLabel(severity: AlertSeverity): string {
  return severity === 'critical' ? 'critical' : 'warning';
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

function resolveMonitorValidationConclusion(input: {
  status?: string;
  currentRiskCount: number;
  currentCriticalCount: number;
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
      summary: '审批尚未完成，处理动作还没有完全落地，先继续观察风险是否变化。',
    };
  }
  if (input.status === 'dry_run_ready') {
    return {
      label: '继续观察',
      tone: 'bg-cyan-400/10 text-cyan-100',
      summary: '当前只是预演结果，还没有真正执行处理，趋势仅作参考。',
    };
  }
  if (input.currentRiskCount === 0 && input.currentCriticalCount === 0) {
    return {
      label: '已恢复',
      tone: 'bg-emerald-500/15 text-emerald-200',
      summary: '当前心跳超时和回执滞后都已回到安全区，可以继续观察一轮后解除关注。',
    };
  }
  if (input.currentCriticalCount > 0 || input.trends.some((item) => item.direction === 'up')) {
    return {
      label: '未恢复',
      tone: 'bg-rose-500/15 text-rose-200',
      summary: '风险项没有收敛，或严重告警仍然存在，建议继续排障或推进回滚。',
    };
  }
  if (input.trends.some((item) => item.direction === 'down')) {
    return {
      label: '正在改善',
      tone: 'bg-cyan-400/10 text-cyan-100',
      summary: '风险项相比回流基线正在下降，但还没有完全清零，建议继续盯一轮。',
    };
  }
  return {
    label: '继续观察',
    tone: 'bg-white/5 text-slate-200',
    summary: '当前风险没有明显扩大，但也还没形成恢复结论，先继续观察一轮。',
  };
}

function toTimestampMs(value?: string | null): number | null {
  if (!value) return null;
  const out = new Date(value).getTime();
  return Number.isFinite(out) ? out : null;
}

function formatDuration(valueMs?: number | null): string {
  if (valueMs == null) return '-';
  const totalSec = Math.max(0, Math.floor(valueMs / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m`;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function isTerminalTaskStatus(status?: string): boolean {
  const normalized = String(status || '').toLowerCase();
  return ['completed', 'failed', 'killed', 'cancelled', 'canceled', 'done'].includes(normalized);
}

function describeSignalSource(source: ReceiptLagAlertRow['signalSource']): string {
  if (source === 'notification') return 'latest notification';
  if (source === 'log') return 'latest log';
  return 'no receipt';
}

function buildLogAuditHref(input: {
  keyword?: string;
  nodeId?: string;
  traceId?: string;
  module?: string;
  errorsOnly?: boolean;
  validation?: Record<string, string | undefined>;
}): string {
  const params = new URLSearchParams();
  if (input.keyword) params.set('keyword', input.keyword);
  if (input.nodeId) params.set('nodeId', input.nodeId);
  if (input.traceId) params.set('traceId', input.traceId);
  if (input.module) params.set('module', input.module);
  if (input.errorsOnly) params.set('errorsOnly', '1');
  Object.entries(input.validation || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `/operations/log-audit?${query}` : '/operations/log-audit';
}

function buildTraceHref(input: {
  traceId?: string;
  sourceQueue?: string;
  validation?: Record<string, string | undefined>;
  anchor?: string;
}): string {
  const params = new URLSearchParams();
  if (input.traceId) params.set('traceId', input.traceId);
  if (input.sourceQueue) params.set('sourceQueue', input.sourceQueue);
  Object.entries(input.validation || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  const base = query ? `/operations/autopilot/trace?${query}` : '/operations/autopilot/trace';
  return input.anchor ? `${base}${input.anchor}` : base;
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

function TaskStatusBadge({ status }: { status: string }) {
  const normalized = String(status || '').toLowerCase();
  const tone =
    normalized === 'completed'
      ? 'bg-emerald-500/15 text-emerald-200'
      : normalized === 'failed' || normalized === 'killed'
        ? 'bg-rose-500/15 text-rose-200'
        : normalized === 'backgrounded'
          ? 'bg-cyan-500/15 text-cyan-200'
          : 'bg-amber-400/15 text-amber-200';
  return <span className={`rounded-full px-3 py-1 text-xs ${tone}`}>{status}</span>;
}

function ModeBadge({ mode }: { mode: string }) {
  const normalized = String(mode || '').toLowerCase();
  const tone =
    normalized === 'background'
      ? 'bg-cyan-400/10 text-cyan-200'
      : normalized === 'foreground'
        ? 'bg-white/5 text-slate-200'
        : 'bg-slate-800 text-slate-300';
  return <span className={`rounded-full px-3 py-1 text-xs ${tone}`}>{mode || '-'}</span>;
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

function getTopKey(record?: Record<string, number> | null): string {
  if (!record) return '';
  const entries = Object.entries(record);
  if (!entries.length) return '';
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] || '';
}

function RecordPanel({
  title,
  rows,
  emptyText,
  highlightKey,
}: {
  title: string;
  rows?: Record<string, number> | null;
  emptyText: string;
  highlightKey?: string;
}) {
  const entries = Object.entries(rows || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/35 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">{title}</div>
      <div className="mt-3 space-y-2">
        {entries.length ? (
          entries.map(([key, value]) => (
            <div
              key={key}
              className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${
                highlightKey && highlightKey === key ? 'bg-cyan-400/10 text-cyan-100' : 'bg-black/20 text-slate-200'
              }`}
            >
              <span className="font-mono text-xs">{key}</span>
              <span className="text-sm font-semibold">{value}</span>
            </div>
          ))
        ) : (
          <EmptyState text={emptyText} />
        )}
      </div>
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
