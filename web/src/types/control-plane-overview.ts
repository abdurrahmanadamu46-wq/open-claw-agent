import type { ExecutionMonitorSnapshot } from './execution-monitor';
import type { ObservabilityOrlaSummary } from './distributed-tracing';
import type { EventBusPrefixSummary, EventBusSubjectStat } from './event-bus-traffic';
import type { RuntimeCapabilityOverviewResponse } from './runtime-capabilities';
import type { TenantMemoryStatsResponse } from './tenant-memory';

export interface ControlPlaneServiceHealthPayload {
  status?: string;
  [key: string]: unknown;
}

export interface ControlPlaneLlmProviderSummary {
  provider_id: string;
  label?: string;
  enabled?: boolean;
  route?: 'local' | 'cloud' | string;
  base_url?: string;
  default_model?: string;
  api_key_masked?: string;
  api_key_configured?: boolean;
  source?: 'env_default' | 'tenant_override' | string;
  updated_at?: string | null;
  updated_by?: string | null;
  note?: string | null;
}

export interface ControlPlaneLlmProvidersPayload {
  ok?: boolean;
  tenant_id?: string;
  providers: ControlPlaneLlmProviderSummary[];
}

export interface ControlPlaneLlmAgentBindingSummary {
  agent_id: string;
  enabled?: boolean;
  task_type?: string;
  provider_id?: string;
  model_name?: string;
  temperature?: number;
  max_tokens?: number;
  note?: string;
  updated_by?: string;
  updated_at?: string | null;
  source?: 'default' | 'tenant_override' | string;
}

export interface ControlPlaneLlmBindingsPayload {
  ok?: boolean;
  tenant_id?: string;
  bindings: ControlPlaneLlmAgentBindingSummary[];
}

export interface ControlPlaneAgentRagPackSummaryRow {
  agent_id: string;
  pack_count: number;
  last_updated?: string | null;
}

export interface ControlPlaneWorkflowTemplateSummary {
  template_name?: string;
  name?: string;
  industry_tag?: string;
  industry?: string;
  version?: string;
  template_version?: string;
  updated_at?: string;
  created_at?: string;
}

export interface ControlPlaneSkillsPoolOverviewPayload {
  summary?: {
    agents_total?: number;
    agents_enabled?: number;
    skills_total?: number;
    nodes_total?: number;
    kb_profiles_total?: number;
    rag_packs_total?: number;
    workflow_templates_total?: number;
  };
  llm_bindings?: ControlPlaneLlmAgentBindingSummary[];
  agent_rag_pack_summary?: ControlPlaneAgentRagPackSummaryRow[];
  workflow_templates?: ControlPlaneWorkflowTemplateSummary[];
  workflow_templates_by_industry?: Record<string, number>;
}

export interface ControlPlaneSkillsPoolPayload {
  ok?: boolean;
  tenant_id?: string;
  overview?: ControlPlaneSkillsPoolOverviewPayload;
}

export interface ControlPlaneLobsterRow {
  id?: string;
  lobster_id?: string;
  zh_name?: string;
  display_name?: string;
  name?: string;
  role?: string;
  icon?: string;
  status?: string;
  lifecycle?: string;
  default_model_tier?: string;
}

export interface ControlPlaneLobstersPayload {
  ok?: boolean;
  count?: number;
  items?: ControlPlaneLobsterRow[];
  lobsters?: ControlPlaneLobsterRow[];
}

export interface ControlPlaneCollabEvidenceRef {
  kind?: string;
  recordId?: string;
}

export interface ControlPlaneCollabSummaryEntry {
  captureId: string;
  tenantId?: string;
  sourceLayer?: string;
  sourceType?: string;
  objectType?: string;
  insight: string;
  evidenceRefs: ControlPlaneCollabEvidenceRef[];
  createdAt?: string;
}

export type KnowledgeLayer = 'platform_common' | 'platform_industry' | 'tenant_private';

export interface ControlPlaneKnowledgeSourceRef {
  layer: KnowledgeLayer;
  source_type: string;
  source_id: string;
  title: string;
  path?: string;
  tenant_id?: string;
  industry_tag?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ControlPlaneTenantPrivateSummariesResponse {
  ok: boolean;
  tenant_id: string;
  total: number;
  items: ControlPlaneCollabSummaryEntry[];
}

export interface ControlPlaneKnowledgeResolveResponse {
  ok: boolean;
  tenant_id: string;
  role_id: string;
  industry_tag?: string | null;
  task_type?: string | null;
  resolved: Record<KnowledgeLayer, ControlPlaneKnowledgeSourceRef[]>;
  explainable_sources: ControlPlaneKnowledgeSourceRef[];
}

export interface RuntimeKnowledgeLayerSummary {
  count: number;
  items: ControlPlaneKnowledgeSourceRef[];
}

export interface RuntimeKnowledgeContext {
  version?: string;
  tenant_id?: string;
  industry_tag?: string | null;
  task_type?: string;
  generated_at?: string;
  layers?: Partial<Record<KnowledgeLayer, RuntimeKnowledgeLayerSummary>>;
  resolved?: Partial<Record<KnowledgeLayer, ControlPlaneKnowledgeSourceRef[]>>;
  explainable_sources?: ControlPlaneKnowledgeSourceRef[];
  source_refs?: ControlPlaneKnowledgeSourceRef[];
  tenant_private_insights?: string[];
  policy?: {
    raw_group_collab_trace_included?: boolean;
    tenant_private_summary_only?: boolean;
    platform_backflow_allowed?: boolean;
  };
}

export interface ControlPlaneMonitorEventBusSubjectsPayload {
  ok?: boolean;
  prefix?: string;
  total?: number;
  subjects: EventBusSubjectStat[];
}

export interface ControlPlaneMonitorEventBusPrefixesPayload {
  ok?: boolean;
  prefixes: EventBusPrefixSummary[];
}

export interface ControlPlaneMonitorKernelPayload {
  orla_dispatcher?: ObservabilityOrlaSummary | null;
}

export interface ControlPlaneSupervisorsOverviewResponse {
  ok: boolean;
  tenant_id?: string | null;
  generated_at: string;
  summary: {
    lobster_count: number;
    enabled_binding_count: number;
    provider_count: number;
    enabled_provider_count: number;
    skills_total: number;
    nodes_total: number;
  };
  service: ControlPlaneServiceHealthPayload;
  providers: ControlPlaneLlmProvidersPayload;
  bindings: ControlPlaneLlmBindingsPayload;
  skills_pool: ControlPlaneSkillsPoolPayload;
  lobsters: ControlPlaneLobstersPayload;
}

export interface ControlPlaneSupervisorCapabilityGraphResponse {
  ok: boolean;
  tenant_id: string;
  generated_at: string;
  summary: {
    agents_total: number;
    agents_enabled: number;
    skills_total: number;
    nodes_total: number;
    kb_profiles_total: number;
    rag_packs_total: number;
    workflow_templates_total: number;
    workflow_template_industries: number;
    tenant_private_collab_summaries: number;
  };
  graph: {
    agents: Array<{
      agent_id: string;
      enabled: boolean;
      runtime_mode?: string;
      profile_version?: string;
      skills_count: number;
      nodes_count: number;
      rag_pack_count: number;
      model_name?: string;
      provider_id?: string;
      updated_at?: string;
    }>;
    collab_summaries: ControlPlaneCollabSummaryEntry[];
    source_modes: {
      agents: string;
      collab_summaries: string;
      role_structure: string;
    };
    gaps: string[];
  };
}

export interface ControlPlaneKnowledgeOverviewResponse {
  ok: boolean;
  tenant_id: string;
  generated_at: string;
  summary: {
    knowledge_base_count: number;
    module_count: number;
    workflow_template_industries: number;
    skills_total: number;
    rag_packs_total: number;
    storage_provider: string | null;
    provider_count?: number;
    mcp_server_count?: number;
    connector_credential_count?: number;
    tenant_memory_total_entries?: number;
    tenant_memory_scope_count?: number;
    tenant_private_collab_summary_count?: number;
  };
  skills_pool: ControlPlaneSkillsPoolPayload;
  knowledge_bases: Record<string, unknown>;
  modules: Record<string, unknown>;
  runtime_capabilities?: RuntimeCapabilityOverviewResponse;
  tenant_memory?: TenantMemoryStatsResponse;
  tenant_private_collab_summaries?: ControlPlaneTenantPrivateSummariesResponse;
  integrations: {
    storage: Record<string, unknown> | null;
    group_collab: Record<string, unknown> | null;
    custom_tools: Record<string, unknown> | null;
  };
}

export interface ControlPlaneMonitorOverviewResponse {
  ok: boolean;
  tenant_id: string;
  generated_at: string;
  summary: {
    node_count: number;
    online_count: number;
    busy_count: number;
    log_count: number;
    runtime_foreground_count?: number;
    task_notification_count?: number;
    edge_snapshot_count?: number;
    subject_count: number;
    prefix_count: number;
  };
  snapshot: ExecutionMonitorSnapshot;
  event_bus: {
    prefix: string;
    subjects: ControlPlaneMonitorEventBusSubjectsPayload;
    prefixes: ControlPlaneMonitorEventBusPrefixesPayload;
  };
  kernel: ControlPlaneMonitorKernelPayload;
  ws: {
    path: string;
    readiness: string;
  };
}
