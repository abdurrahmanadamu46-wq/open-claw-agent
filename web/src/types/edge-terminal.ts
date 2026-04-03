export type EdgeTerminalConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface EdgeTerminalReadyEvent {
  sessionId: string;
  nodeId: string;
  status?: string;
  availableCommands?: string[];
}

export interface EdgeTerminalOutputEvent {
  sessionId: string;
  nodeId?: string;
  command?: string;
  data: string;
  timestamp?: string;
}

export interface EdgeTerminalErrorEvent {
  message: string;
}

export interface EdgeTerminalClosedEvent {
  sessionId: string;
  nodeId?: string;
  reason?: string;
}

export interface EdgeSchedulerJobStatus {
  name: string;
  description: string;
  interval_seconds: number;
  enabled: boolean;
  running?: boolean;
  last_run: string | null;
  run_count: number;
  error_count: number;
  next_run_in: number;
}

export interface EdgeScheduledTaskRecord {
  task_id: string;
  tenant_id: string;
  lobster_id: string;
  scheduled_at: string;
  status: string;
  last_error?: string | null;
  last_run_at?: string | null;
}

export interface EdgeSchedulerStatusEvent {
  sessionId: string;
  nodeId?: string;
  jobs: EdgeSchedulerJobStatus[];
  scheduledTasks: EdgeScheduledTaskRecord[];
}

export interface EdgeSchedulerToggleEvent {
  sessionId: string;
  nodeId?: string;
  jobName?: string;
  enabled?: boolean;
  success?: boolean;
  message?: string;
}

export interface EdgeBackupRecord {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

export interface EdgeBackupCompleteEvent {
  sessionId: string;
  nodeId?: string;
  success?: boolean;
  archive?: string;
  output?: string;
  backupName?: string;
  sizeBytes?: number;
}

export interface EdgeBackupListEvent {
  sessionId: string;
  nodeId?: string;
  backups: EdgeBackupRecord[];
}

export interface EdgeBackupRestoreEvent {
  sessionId: string;
  nodeId?: string;
  dryRun?: boolean;
  success?: boolean;
  output?: string;
  manifest?: Record<string, unknown> | null;
}

export interface EdgeRestoreCompleteEvent {
  sessionId?: string;
  nodeId?: string;
  tenantId?: string;
  backupName?: string;
  restoredAt?: string;
  contents?: string[];
}

export interface EdgeSecurityAuditSummary {
  crit: number;
  warn: number;
  ok: number;
}

export interface EdgeSecurityAuditReportEvent {
  sessionId?: string;
  report_id?: string;
  node_id: string;
  tenant_id?: string;
  report: string;
  summary: EdgeSecurityAuditSummary;
  timestamp: string;
}

export interface EdgeSecurityBaselineRebuildEvent {
  sessionId?: string;
  nodeId?: string;
  baselineType?: string;
  rebuilt?: Record<string, unknown>;
  success?: boolean;
  timestamp?: string;
}

export interface EdgeSecurityKnownIssueRecord {
  id: string;
  node_id?: string | null;
  check_name: string;
  pattern: string;
  reason: string;
  created_at: string;
}
