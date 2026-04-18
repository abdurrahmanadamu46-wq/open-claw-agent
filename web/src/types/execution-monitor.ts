export type ExecutionMonitorNodeStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'INTERVENTION_REQUIRED' | string;

export const EXECUTION_LOGS_CONTRACT = 'execution-logs.v1' as const;

export interface ExecutionMonitorNode {
  node_id: string;
  tenant_id?: string;
  client_name?: string;
  region?: string;
  status: ExecutionMonitorNodeStatus;
  load_percent?: number;
  running_task_id?: string | null;
  last_seen_at?: string;
}

export interface ExecutionLogEvent {
  event_id?: string;
  task_id: string;
  node_id: string;
  lobster_id?: string;
  level: 'debug' | 'info' | 'warn' | 'error' | string;
  stage?: string;
  message: string;
  created_at: string;
  payload?: Record<string, unknown>;
}

export interface RuntimeForegroundTask {
  task_id: string;
  lobster_id: string;
  description: string;
  status?: string;
  mode?: string;
  elapsed_sec?: number;
  is_backgrounded?: boolean;
}

export interface RuntimeTaskNotificationPreview {
  activity_id: string;
  task_id: string;
  lobster_id: string;
  status: string;
  mode: string;
  summary: string;
  total_tokens?: number;
  tool_uses?: number;
  duration_ms?: number;
  created_at: string;
}

export interface ExecutionSnapshotSafetyPreview {
  snapshot_id: string;
  node_id: string;
  task_id?: string | null;
  status: string;
  duration_ms: number;
  blocked_steps: number;
  needs_approval_steps: number;
  checked_steps: number;
  created_at?: string;
}

export interface ExecutionMonitorSnapshot {
  ok?: boolean;
  tenant_id?: string;
  nodes: ExecutionMonitorNode[];
  recent_logs: ExecutionLogEvent[];
  runtime_foreground?: RuntimeForegroundTask[];
  recent_task_notifications?: RuntimeTaskNotificationPreview[];
  recent_edge_snapshots?: ExecutionSnapshotSafetyPreview[];
}

export interface ExecutionLogsHelloFrame {
  type: 'hello';
  contract: typeof EXECUTION_LOGS_CONTRACT;
  connection_id: string;
  tenant_id: string;
  ts: string;
  auth: {
    user_id?: string;
    roles: string[];
  };
}

export interface ExecutionLogsEventFrame {
  type: 'execution_log';
  contract: typeof EXECUTION_LOGS_CONTRACT;
  tenant_id: string;
  ts: string;
  event: ExecutionLogEvent;
}

export interface ExecutionLogsNodeHeartbeatFrame {
  type: 'node_heartbeat';
  contract: typeof EXECUTION_LOGS_CONTRACT;
  tenant_id: string;
  ts: string;
  node: {
    node_id: string;
    status: string;
    last_seen_at: string;
    running_task_id?: string | null;
  };
}

export interface ExecutionLogsErrorFrame {
  type: 'error';
  contract: typeof EXECUTION_LOGS_CONTRACT;
  ts: string;
  code: 'unauthorized' | 'forbidden' | 'bad_request';
  message: string;
}

export type ExecutionLogsFrame =
  | ExecutionLogsHelloFrame
  | ExecutionLogsEventFrame
  | ExecutionLogsNodeHeartbeatFrame
  | ExecutionLogsErrorFrame;

function asRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
}

function asStringArray(payload: unknown): string[] | null {
  return Array.isArray(payload) && payload.every((item) => typeof item === 'string')
    ? payload.map((item) => String(item))
    : null;
}

function parseExecutionLogEvent(payload: unknown): ExecutionLogEvent | null {
  const row = asRecord(payload);
  if (!row) return null;
  if (
    typeof row.task_id !== 'string'
    || typeof row.node_id !== 'string'
    || typeof row.message !== 'string'
    || typeof row.created_at !== 'string'
  ) {
    return null;
  }
  return {
    event_id: typeof row.event_id === 'string' ? row.event_id : undefined,
    task_id: row.task_id,
    node_id: row.node_id,
    lobster_id: typeof row.lobster_id === 'string' ? row.lobster_id : undefined,
    level: typeof row.level === 'string' ? row.level : 'info',
    stage: typeof row.stage === 'string' ? row.stage : undefined,
    message: row.message,
    created_at: row.created_at,
    payload: asRecord(row.payload) ?? undefined,
  };
}

export function parseExecutionLogsFrame(raw: unknown): ExecutionLogsFrame | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  if (frame.contract !== EXECUTION_LOGS_CONTRACT) return null;
  if (typeof frame.type !== 'string' || typeof frame.ts !== 'string') return null;

  switch (frame.type) {
    case 'hello': {
      const auth = asRecord(frame.auth);
      const roles = asStringArray(auth?.roles);
      if (!auth || !roles || typeof frame.connection_id !== 'string' || typeof frame.tenant_id !== 'string') {
        return null;
      }
      return {
        type: 'hello',
        contract: EXECUTION_LOGS_CONTRACT,
        connection_id: frame.connection_id,
        tenant_id: frame.tenant_id,
        ts: frame.ts,
        auth: {
          user_id: typeof auth.user_id === 'string' ? auth.user_id : undefined,
          roles,
        },
      };
    }
    case 'execution_log': {
      const event = parseExecutionLogEvent(frame.event);
      if (!event || typeof frame.tenant_id !== 'string') return null;
      return {
        type: 'execution_log',
        contract: EXECUTION_LOGS_CONTRACT,
        tenant_id: frame.tenant_id,
        ts: frame.ts,
        event,
      };
    }
    case 'node_heartbeat': {
      const node = asRecord(frame.node);
      if (
        !node
        || typeof frame.tenant_id !== 'string'
        || typeof node.node_id !== 'string'
        || typeof node.status !== 'string'
        || typeof node.last_seen_at !== 'string'
      ) {
        return null;
      }
      return {
        type: 'node_heartbeat',
        contract: EXECUTION_LOGS_CONTRACT,
        tenant_id: frame.tenant_id,
        ts: frame.ts,
        node: {
          node_id: node.node_id,
          status: node.status,
          last_seen_at: node.last_seen_at,
          running_task_id:
            typeof node.running_task_id === 'string' || node.running_task_id === null
              ? node.running_task_id
              : undefined,
        },
      };
    }
    case 'error':
      if (
        frame.code !== 'unauthorized'
        && frame.code !== 'forbidden'
        && frame.code !== 'bad_request'
      ) {
        return null;
      }
      if (typeof frame.message !== 'string') return null;
      return {
        type: 'error',
        contract: EXECUTION_LOGS_CONTRACT,
        ts: frame.ts,
        code: frame.code,
        message: frame.message,
      };
    default:
      return null;
  }
}
