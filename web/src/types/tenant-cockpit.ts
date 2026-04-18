export interface CapabilityRouteAuditRecord {
  audit_id: string;
  created_at: string;
  tenant_id: string;
  trace_id?: string | null;
  workflow_id: string;
  industry_tag?: string | null;
  goal: string;
  lobster_sequence: string[];
  capability_plan: Record<string, Array<Record<string, unknown>>>;
  reasons: string[];
}

export interface CapabilityRouteAuditListResponse {
  ok: boolean;
  tenant_id: string;
  total: number;
  items: CapabilityRouteAuditRecord[];
}

export interface PlatformFeedbackCandidateRecord {
  feedback_id: string;
  created_at: string;
  tenant_id: string;
  industry_tag: string;
  source_layer: string;
  target_layer: string;
  source_lobster: string;
  title: string;
  abstracted_insight: string;
  evidence: Array<Record<string, unknown>>;
  tags: string[];
  requires_review: boolean;
  eligible_for_platform: boolean;
  violations: string[];
  metadata: Record<string, unknown>;
}

export interface PlatformFeedbackCandidateListResponse {
  ok: boolean;
  tenant_id: string;
  total: number;
  items: PlatformFeedbackCandidateRecord[];
}

export interface TenantCockpitSummary {
  strategy_level: number;
  strategy_name?: string;
  strategy_autonomy?: string;
  total_tasks: number;
  running_tasks: number;
  pending_tasks: number;
  failed_tasks: number;
  total_activities: number;
  total_cost: number;
  graph_nodes: number;
  graph_edges: number;
  enabled_capabilities: number;
  capability_routes_preview: number;
  platform_feedback_preview: number;
  warnings_count: number;
}

export interface TenantCockpitTaskItem {
  id?: string;
  task_id?: string;
  task?: string;
  title?: string;
  status?: string;
}

export interface TenantCockpitActivityItem {
  id?: string;
  type?: string;
  title?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TenantCockpitOverviewResponse {
  ok: boolean;
  partial: boolean;
  tenant_id: string;
  generated_at: string;
  summary: TenantCockpitSummary;
  strategy: {
    level: number;
    name?: string;
    autonomy?: string;
    approval_required: boolean;
    raw: Record<string, unknown> | null;
  };
  tasks: {
    total: number;
    status_counts: Record<string, number>;
    items: TenantCockpitTaskItem[];
    raw: Record<string, unknown> | null;
  };
  activities: {
    total: number;
    page: number;
    page_size: number;
    items: TenantCockpitActivityItem[];
    raw: Record<string, unknown> | null;
  };
  cost: {
    range: string;
    total_cost: number;
    budget_used: number;
    budget_limit: number | null;
    items: Record<string, unknown>[];
    raw: Record<string, unknown> | null;
  };
  graph: {
    node_count: number;
    edge_count: number;
    updated_at?: string | null;
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
    raw: Record<string, unknown> | null;
  };
  capabilities: {
    tenant_tier?: string;
    enabled_count: number;
    total_count: number;
    items: Array<{
      key: string;
      enabled: boolean;
      reason?: string;
      max_value?: number | null;
      upgrade_required?: string | null;
    }>;
    raw: Record<string, unknown> | null;
  };
  governance: {
    capability_routes_preview: CapabilityRouteAuditRecord[];
    platform_feedback_preview: PlatformFeedbackCandidateRecord[];
  };
  warnings: string[];
}
