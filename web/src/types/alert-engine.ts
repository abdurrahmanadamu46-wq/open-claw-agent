export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertState = 'normal' | 'pending' | 'firing' | 'silenced';

export interface AlertRule {
  rule_id: string;
  name: string;
  description: string;
  metric: string;
  aggregation: string;
  condition: string;
  threshold: number;
  window_seconds: number;
  pending_seconds: number;
  silence_seconds: number;
  severity: AlertSeverity;
  lobster_filter?: string | null;
  tenant_filter?: string | null;
  edge_node_filter?: string | null;
  notification_channel_ids: string[];
  state: AlertState;
  pending_since?: string | null;
  last_fired_at?: string | null;
  last_resolved_at?: string | null;
  enabled: boolean;
}

export interface AlertNotificationChannel {
  channel_id: string;
  name: string;
  channel_type: string;
  config: Record<string, unknown>;
  severity_filter: string;
  enabled: boolean;
}

export interface AlertEvent {
  event_id: string;
  rule_id: string;
  rule_name: string;
  state: string;
  severity: AlertSeverity;
  message: string;
  current_value: number;
  threshold: number;
  fired_at: string;
  resolved_at?: string | null;
  tenant_id?: string | null;
  lobster_id?: string | null;
}
