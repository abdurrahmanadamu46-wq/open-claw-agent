export type ExecutionMonitorNodeStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'INTERVENTION_REQUIRED' | string;

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

export interface ExecutionMonitorSnapshot {
  ok?: boolean;
  tenant_id?: string;
  nodes: ExecutionMonitorNode[];
  recent_logs: ExecutionLogEvent[];
}
