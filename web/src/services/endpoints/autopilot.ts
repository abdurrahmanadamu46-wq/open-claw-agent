/**
 * 全自动引擎 — 状态、触发探针、恢复熔断
 */

import api from '../api';

export interface AutopilotStatus {
  circuitOpen: boolean;
}

export interface AutopilotAlertSignal {
  ruleKey: string;
  severity: 'P1' | 'P2' | 'P3';
  state: 'fired' | 'ok';
  message: string;
  value: number;
  threshold: number;
  windowMinutes: number;
  sourceQueue?: string;
}

export interface AutopilotAlertEvaluateResponse {
  ok: boolean;
  tenantId: string;
  query: { windowMinutes: number; from?: string; to?: string; sourceQueue?: string };
  signals: AutopilotAlertSignal[];
}

export interface AutopilotTraceTaskStateItem {
  recordId: string;
  taskId: string;
  traceId?: string;
  stage: string;
  state: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
  tenantId: string;
  campaignId?: string;
  sourceQueue: string;
  nodeId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
}

export interface AutopilotTraceDlqItem {
  dlqJobId: string;
  sourceQueue: string;
  sourceJobId: string;
  tenantId: string;
  traceId: string;
  campaignId?: string;
  taskId: string;
  nodeId: string;
  stage: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  attemptsMade: number;
  maxAttempts: number;
  originalPayload: Record<string, unknown>;
  failedAt: string;
  replayedAt?: string;
  replayJobId?: string;
}

export interface AutopilotTraceReplayAuditItem {
  auditId: string;
  sourceQueue: string;
  dlqJobId: string;
  sourceJobId?: string;
  taskId?: string;
  stage?: string;
  traceId?: string;
  replayJobId?: string;
  replayCount?: number;
  requestedAt: string;
  completedAt?: string;
  operatorId: string;
  operatorName?: string;
  operatorSource?: string;
  result: 'success' | 'failed' | 'already_replayed' | 'lock_not_acquired';
  errorMessage?: string;
  tenantId?: string;
}

export interface AutopilotTraceBehaviorSnapshotItem {
  traceId: string;
  sessionId: string;
  tenantId?: string;
  campaignId?: string;
  nodeId?: string;
  taskId?: string;
  templateId?: string;
  eventType: 'behavior.path.generated' | 'behavior.session.created';
  memoryHits: number;
  blendedBias: {
    like: number;
    comment: number;
    follow: number;
    share: number;
  };
  issueCode?: 'memory.empty';
  createdAt: string;
}

export interface AutopilotTraceFleetSnapshotItem {
  taskId: string;
  nodeId?: string;
  progress?: number;
  message?: string;
  step?: string;
  completed?: boolean;
  success?: boolean;
  error?: string;
  completedAt?: string;
  traceId?: string;
}

export interface AutopilotTraceSnapshotResponse {
  ok: boolean;
  traceId: string;
  tenantId: string;
  query: { from?: string; to?: string; errorsOnly: boolean; sourceQueue?: string };
  taskStates: AutopilotTraceTaskStateItem[];
  dlqItems: AutopilotTraceDlqItem[];
  replayAudits: AutopilotTraceReplayAuditItem[];
  behavior: { snapshots: AutopilotTraceBehaviorSnapshotItem[] };
  fleet: { taskIds: string[]; snapshots: AutopilotTraceFleetSnapshotItem[] };
}

export type AutopilotAuditLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SECURITY';
export type AutopilotAuditLogModule =
  | 'PATROL'
  | 'DISPATCHER'
  | 'ECHOER'
  | 'CATCHER'
  | 'WEBHOOK'
  | 'FLEET'
  | 'BEHAVIOR'
  | 'AUTOPILOT';

export interface AutopilotAuditLogItem {
  id: string;
  ts: string;
  level: AutopilotAuditLogLevel;
  module: AutopilotAuditLogModule;
  nodeId?: string;
  traceId?: string;
  eventType: string;
  message: string;
  campaignId?: string;
  sourceQueue?: string;
  durationMs?: number;
  taskId?: string;
  stage?: string;
}

export interface AutopilotAuditLogSearchResponse {
  ok: boolean;
  tenantId: string;
  query: {
    from?: string;
    to?: string;
    errorsOnly: boolean;
    sourceQueue?: string;
    module?: string;
    level?: string;
    nodeId?: string;
    traceId?: string;
    keyword?: string;
    limit: number;
  };
  total: number;
  items: AutopilotAuditLogItem[];
}

export async function fetchAutopilotStatus(): Promise<AutopilotStatus> {
  const { data } = await api.get<AutopilotStatus>('/autopilot/status');
  return data;
}

export async function triggerAutopilotProbe(payload?: {
  tenantId?: string;
  competitorUrl?: string;
  industryKeywords?: string[];
}): Promise<{ jobId: string }> {
  const { data } = await api.post<{ jobId: string }>('/autopilot/trigger-probe', payload ?? {});
  return data;
}

export async function resetAutopilotCircuit(): Promise<{ ok: boolean }> {
  const { data } = await api.post<{ ok: boolean }>('/autopilot/reset-circuit');
  return data;
}

export interface AutopilotDashboardMetricsResponse {
  ok: boolean;
  tenantId: string;
  windowMinutes: number;
  query: { from?: string; to?: string; sourceQueue?: string };
  totals: {
    queueProcessFail: number;
    dlqEnqueue: number;
    replayAttempt: number;
    replaySuccess: number;
    replayFailed: number;
    replaySuccessRate: number;
  };
  byQueue: {
    queueProcessFail: Record<string, number>;
    dlqEnqueue: Record<string, number>;
  };
}

export async function fetchAutopilotDashboardMetrics(params?: {
  windowMinutes?: number;
  from?: string;
  to?: string;
  sourceQueue?: string;
}): Promise<AutopilotDashboardMetricsResponse> {
  const { data } = await api.get<AutopilotDashboardMetricsResponse>('/autopilot/metrics/dashboard', {
    params: {
      windowMinutes: params?.windowMinutes ?? 60,
      ...(params?.from ? { from: params.from } : {}),
      ...(params?.to ? { to: params.to } : {}),
      ...(params?.sourceQueue ? { sourceQueue: params.sourceQueue } : {}),
    },
  });
  return data;
}

export async function evaluateAutopilotAlerts(params?: {
  windowMinutes?: number;
  from?: string;
  to?: string;
  sourceQueue?: string;
  emit?: boolean;
}): Promise<AutopilotAlertEvaluateResponse> {
  const { data } = await api.get<AutopilotAlertEvaluateResponse>('/autopilot/alerts/evaluate', {
    params: {
      windowMinutes: params?.windowMinutes ?? 60,
      ...(params?.from ? { from: params.from } : {}),
      ...(params?.to ? { to: params.to } : {}),
      ...(params?.sourceQueue ? { sourceQueue: params.sourceQueue } : {}),
      ...(params?.emit ? { emit: 'true' } : {}),
    },
  });
  return data;
}

export async function fetchAutopilotTraceSnapshot(
  traceId: string,
  params?: {
    from?: string;
    to?: string;
    errorsOnly?: boolean;
    sourceQueue?: string;
  },
): Promise<AutopilotTraceSnapshotResponse> {
  const { data } = await api.get<AutopilotTraceSnapshotResponse>(`/autopilot/trace/${encodeURIComponent(traceId)}`, {
    params: {
      ...(params?.from ? { from: params.from } : {}),
      ...(params?.to ? { to: params.to } : {}),
      ...(params?.errorsOnly ? { errorsOnly: 'true' } : {}),
      ...(params?.sourceQueue ? { sourceQueue: params.sourceQueue } : {}),
    },
  });
  return data;
}

export async function fetchAutopilotAuditLogs(params?: {
  from?: string;
  to?: string;
  errorsOnly?: boolean;
  sourceQueue?: string;
  module?: string;
  level?: string;
  nodeId?: string;
  traceId?: string;
  keyword?: string;
  limit?: number;
}): Promise<AutopilotAuditLogSearchResponse> {
  const { data } = await api.get<AutopilotAuditLogSearchResponse>('/autopilot/logs/search', {
    params: {
      ...(params?.from ? { from: params.from } : {}),
      ...(params?.to ? { to: params.to } : {}),
      ...(params?.errorsOnly ? { errorsOnly: 'true' } : {}),
      ...(params?.sourceQueue ? { sourceQueue: params.sourceQueue } : {}),
      ...(params?.module ? { module: params.module } : {}),
      ...(params?.level ? { level: params.level } : {}),
      ...(params?.nodeId ? { nodeId: params.nodeId } : {}),
      ...(params?.traceId ? { traceId: params.traceId } : {}),
      ...(params?.keyword ? { keyword: params.keyword } : {}),
      ...(params?.limit ? { limit: params.limit } : {}),
    },
  });
  return data;
}
