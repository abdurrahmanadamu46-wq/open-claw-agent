export type AuditEventCategory =
  | 'auth'
  | 'user'
  | 'lobster'
  | 'workflow'
  | 'channel'
  | 'api_key'
  | 'tenant'
  | 'billing'
  | 'security'
  | 'edge'
  | 'mcp'
  | 'system';

export type AuditSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface AuditEvent {
  id: string;
  event_type: string;
  category: AuditEventCategory;
  severity: AuditSeverity;
  tenant_id: string;
  user_id?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  details?: Record<string, unknown>;
  ip_address?: string | null;
  created_at: string;
  deleted_at?: string | null;
  deleted_reason?: string | null;
}

export interface AuditEventFilter {
  event_type?: string[];
  severity?: AuditSeverity[];
  category?: AuditEventCategory[];
  from?: string;
  to?: string;
  user_id?: string;
  resource_id?: string;
  include_deleted?: boolean;
  limit?: number;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
}
