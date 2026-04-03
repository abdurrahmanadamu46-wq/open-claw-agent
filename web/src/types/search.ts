export interface SearchResultItem {
  id: string;
  title?: string;
  description?: string;
  href: string;
  type?: 'lobster' | 'workflow' | 'channel' | 'tenant' | 'audit';
  badge?: string;
  icon?: string;
}

export interface LobsterSearchItem {
  id: string;
  display_name: string;
  description: string;
  lifecycle: string;
  status: string;
  href: string;
}

export interface WorkflowSearchItem {
  id: string;
  name: string;
  description?: string;
  step_count?: number;
  status?: string;
  href: string;
}

export interface ChannelSearchItem {
  id: string;
  account_name: string;
  platform: string;
  status: string;
  href: string;
}

export interface TenantSearchItem {
  id: string;
  name: string;
  plan?: string;
  href: string;
}

export interface AuditSearchItem {
  id: string;
  title: string;
  description?: string;
  severity?: string;
  href: string;
}

export interface SearchResults {
  lobsters: LobsterSearchItem[];
  workflows: WorkflowSearchItem[];
  channels: ChannelSearchItem[];
  tenants?: TenantSearchItem[];
  audits?: AuditSearchItem[];
}
