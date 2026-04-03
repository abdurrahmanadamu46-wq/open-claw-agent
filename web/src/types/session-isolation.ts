export type SessionIsolationMode = 'shared' | 'per-peer' | 'isolated';

export interface SessionIsolationConfig {
  peer_id: string;
  lobster_id: string;
  mode: SessionIsolationMode;
  tenant_id: string;
  channel: string;
}

export interface SessionSummary {
  session_id: string;
  peer_id: string;
  lobster_id: string;
  tenant_id: string;
  channel: string;
  mode: SessionIsolationMode;
  message_count: number;
  last_active_at: string;
}
