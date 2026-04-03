import api from '../api';
import { encryptSensitiveField } from '@/lib/rsa-crypto';
import {
  INDUSTRY_CATEGORIES,
  INDUSTRY_SUBCATEGORIES,
  type IndustrySubcategory,
} from '@/constants/industries';
import type { AttributionResponse } from '@/types/attribution';
import type { FunnelResponse } from '@/types/funnel';
import type {
  SurveyCreatePayload,
  SurveyListResponse,
  SurveyResponsePayload,
  SurveyResponseResult,
  SurveyResult,
} from '@/types/survey';
import type { NlQueryPayload, NlQueryResponse } from '@/types/nl-query';
import type { AutonomyPolicyState, UpdateAutonomyPolicyPayload } from '@/types/autonomy-policy';
import type {
  ExecutionLogEvent,
  ExecutionMonitorNode,
  ExecutionMonitorSnapshot,
} from '@/types/execution-monitor';
import type {
  MemoryCompressionRequest,
  MemoryCompressionRunResult,
  MemoryCompressionStats,
} from '@/types/memory-compression';
import type { SkillEffectivenessResponse } from '@/types/skill-effectiveness';
import type {
  IntensityChangeRecord,
  StrategyIntensityState,
} from '@/types/strategy-intensity';
import type { AuditEvent, AuditEventFilter } from '@/types/audit-log';
import type { AlertEvent, AlertNotificationChannel, AlertRule } from '@/types/alert-engine';
import type { ChartAnnotation } from '@/types/chart-annotation';
import type {
  FeatureFlag,
  FlagCheckResult,
  FlagStrategy,
  FlagVariant,
} from '@/types/feature-flags';
import type { WorkflowTrace } from '@/types/distributed-tracing';
import type { Lifecycle, LifecycleChangeEvent, LobsterEntity, LobsterRun, LobsterSkill } from '@/types/lobster';
import type {
  LobsterConfigDetail,
  LobsterConfigSummary,
  LobsterSkillSummary,
  LobsterToolSummary,
  LobsterConfigUpdatePayload,
} from '@/types/lobster-config-center';
import type { ProviderConfig, ProviderMetrics } from '@/types/provider-registry';
import type { ExperimentReport, PromptExperiment } from '@/types/prompt-experiment';
import type {
  AiExperimentCompareResponse,
  AiExperimentListResponse,
  AiExperimentSummary,
  AiPromptDiffResponse,
} from '@/types/ai-experiments';
import type {
  PermissionCheckResult,
  ResourcePermission,
  ResourceScope,
  ResourceType,
  SubjectType,
} from '@/types/rbac-permission';
import type { SearchResults } from '@/types/search';
import type { WhiteLabelConfig, WhiteLabelCSSVars } from '@/types/white-label';
import type { KnowledgeBaseDetail, KnowledgeBaseSearchHit, KnowledgeBaseSummary } from '@/types/knowledge-base';
import type { LobsterFeedbackItem, LobsterFeedbackSubmitPayload, LobsterQualityStats } from '@/types/lobster-feedback';
import type { LobsterMetricsHistoryPoint } from '@/types/lobster-metrics-history';
import type { LeadConversionHistoryItem, LeadConversionStatus } from '@/types/lead-conversion';
import type { ActivityStreamItem } from '@/types/activity-stream';
import type {
  MCPCallRecord,
  MCPServer,
  MCPTool,
  MCPToolMonitorFailureItem,
  MCPToolMonitorHeatmapItem,
  MCPToolMonitorTopItem,
  MCPToolPolicy,
  ToolMarketplaceListing,
  ToolMarketplaceSubscription,
} from '@/types/mcp-gateway';
import type { EventBusPrefixSummary, EventBusSubjectStat } from '@/types/event-bus-traffic';
import type { HybridMemorySearchResponse } from '@/types/hybrid-memory-search';
import type { TenantConcurrencyStats } from '@/types/tenant-concurrency';
import type { VectorBackupHistoryItem, VectorBackupSnapshot } from '@/types/vector-snapshot-backup';
import type {
  WorkflowDefinitionDetail,
  WorkflowDefinitionSummary,
  WorkflowLifecycle,
  WorkflowRunListItem,
  WorkflowRunStatus,
  WorkflowTemplate,
  WorkflowWebhook,
} from '@/types/workflow-engine';
import type { WidgetConfig, WidgetConfigPayload, WidgetScript } from '@/types/embed-widget';

export type AiEdgeTarget = {
  edge_id: string;
  account_id?: string;
  webhook_url?: string;
  instruction_hint?: string;
  skills?: string[];
  skill_manifest_path?: string;
  skill_commands?: string[];
  skill_manifest_meta?: Record<string, unknown>;
};

export type RunDragonTeamPayload = {
  task_description: string;
  industry_tag?: string;
  industry?: string;
  competitor_handles?: string[];
  edge_targets?: AiEdgeTarget[];
  client_preview?: Record<string, unknown>;
  industry_workflow_context?: Record<string, unknown>;
  execution_mode?: 'assistive' | 'auto';
  meta?: Record<string, unknown>;
};

export type PipelineModePreviewPayload = {
  task_description: string;
  industry_tag?: string;
  industry?: string;
  competitor_handles?: string[];
  edge_targets?: AiEdgeTarget[];
  meta?: Record<string, unknown>;
};

export type RunDragonTeamAsyncAccepted = {
  ok: boolean;
  job_id: string;
  status: string;
  status_url: string;
  request_id: string;
};

export type RunDragonTeamAsyncStatus = {
  ok: boolean;
  job_id: string;
  status: string;
  request_id: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  user_id: string;
  tenant_id: string;
  thread_id?: string | null;
  mission_id?: string | null;
  pipeline_mode?: string | null;
  pipeline_explain?: Record<string, unknown>;
  execution_elapsed_sec?: number | null;
  variance_analysis?: Record<string, unknown>;
  artifact_count?: number;
  artifact_index?: Array<Record<string, unknown>>;
  stage?: string;
  progress?: number;
  summary?: string;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
};

export type StrategyIntensity = {
  ok: boolean;
  tenant_id: string;
  current_level: number;
  name: string;
  label: string;
  description: string;
  autonomy: string;
  approval_required: boolean;
  resource_limits: {
    max_daily_posts?: number;
    max_daily_replies?: number;
    max_daily_dms?: number;
    max_llm_calls_per_task?: number;
    allowed_channels?: string[];
  };
  escalation_trigger: string;
  rollback_policy: string;
  risk_threshold: number;
  applicable_scenarios: string[];
  typical_lobsters: string[];
  downgrade_rules: Record<string, string>;
  usage_today: {
    posts?: number;
    replies?: number;
    dms?: number;
    llm_calls?: number;
  };
  usage_date?: string;
  updated_at?: string;
  updated_by?: string;
  reason?: string;
};

export type ArtifactEnvelope = {
  schema_version: string;
  artifact_type: string;
  artifact_id: string;
  mission_id: string;
  tenant_id: string;
  workspace_id: string;
  produced_by: {
    role_id: string;
    run_id: string;
    step_id: string;
  };
  produced_at: string;
  status: string;
  goal: string;
  assumptions: string[];
  evidence: Array<{
    source_type: string;
    source_ref: string;
    summary: string;
  }>;
  confidence: number;
  risk_level: string;
  dependencies: string[];
  success_criteria: string[];
  fallback_plan: string;
  next_action: string;
  owner_role?: string;
  payload: Record<string, unknown>;
};

export type AnalyzeCompetitorPayload = {
  target_account_url: string;
  competitor_handles?: string[];
};

export async function runDragonTeam(payload: RunDragonTeamPayload) {
  const { data } = await api.post('/api/v1/ai/run-dragon-team', payload);
  return data;
}

export async function fetchStrategyIntensity(tenantId?: string) {
  const { data } = await api.get<StrategyIntensity>('/api/v1/ai/strategy/intensity', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data;
}

export async function escalateStrategyIntensity(payload?: { tenant_id?: string; reason?: string }) {
  const { data } = await api.post<StrategyIntensity>('/api/v1/ai/strategy/intensity/escalate', payload ?? {});
  return data;
}

export async function deescalateStrategyIntensity(payload?: { tenant_id?: string; reason?: string }) {
  const { data } = await api.post<StrategyIntensity>('/api/v1/ai/strategy/intensity/deescalate', payload ?? {});
  return data;
}

export async function fetchStrategyIntensityHistory(tenantId?: string, limit = 20) {
  const { data } = await api.get('/api/v1/ai/strategy/intensity/history', {
    params: {
      ...(tenantId ? { tenant_id: tenantId } : {}),
      limit,
    },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    count: number;
    history: IntensityChangeRecord[];
  };
}

export async function fetchAutonomyPolicy(tenantId?: string) {
  const { data } = await api.get('/api/v1/ai/autonomy/policy', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as AutonomyPolicyState;
}

export async function updateAutonomyPolicy(payload: UpdateAutonomyPolicyPayload) {
  const { data } = await api.put('/api/v1/ai/autonomy/policy', payload);
  return data as AutonomyPolicyState;
}

export async function fetchAnalyticsAttribution(input: {
  tenantId: string;
  model?: string;
  start?: string;
  end?: string;
}) {
  const { data } = await api.get<AttributionResponse>('/api/v1/analytics/attribution', {
    params: {
      tenant_id: input.tenantId,
      ...(input.model ? { model: input.model } : {}),
      ...(input.start ? { start: input.start } : {}),
      ...(input.end ? { end: input.end } : {}),
    },
  });
  return data;
}

export async function fetchAnalyticsFunnel(input: { tenantId: string; start?: string; end?: string }) {
  const { data } = await api.get<FunnelResponse>('/api/v1/analytics/funnel', {
    params: {
      tenant_id: input.tenantId,
      ...(input.start ? { start: input.start } : {}),
      ...(input.end ? { end: input.end } : {}),
    },
  });
  return data;
}

export async function fetchSurveys(tenantId: string) {
  const { data } = await api.get('/api/v1/surveys', {
    params: { tenant_id: tenantId },
  });
  return data as SurveyListResponse;
}

export async function createSurvey(payload: SurveyCreatePayload) {
  const { data } = await api.post('/api/v1/surveys', payload);
  return data as { ok?: boolean; survey_id?: string };
}

export async function fetchSurveyResults(surveyId: string) {
  const { data } = await api.get(`/api/v1/surveys/${encodeURIComponent(surveyId)}/results`);
  return data as { ok?: boolean; survey_id?: string; results: SurveyResult[] };
}

export async function respondSurvey(payload: SurveyResponsePayload) {
  const { data } = await api.post('/api/v1/surveys/respond', payload);
  return data as SurveyResponseResult;
}

export async function postNaturalLanguageQuery(payload: NlQueryPayload) {
  const { data } = await api.post('/api/v1/analytics/nl-query', payload);
  return data as NlQueryResponse;
}

export type SchedulerTask = {
  task_id: string;
  name: string;
  kind: 'cron' | 'every' | 'once';
  schedule: string;
  lobster_id: string;
  prompt: string;
  session_mode: 'shared' | 'per-peer' | 'isolated';
  delivery_channel: string;
  max_retries: number;
  enabled: boolean;
  tenant_id: string;
  created_at: string;
  last_run_at?: string | null;
  next_run_at?: string | null;
  run_count: number;
  fail_count: number;
};

export type SchedulerRunHistoryItem = {
  id: number;
  task_id: string;
  started_at: string;
  finished_at?: string | null;
  status: string;
  result_summary?: string | null;
  error_message?: string | null;
};

export async function fetchSchedulerTasks(tenantId?: string) {
  const { data } = await api.get('/api/v1/ai/scheduler/tasks', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as {
    ok: boolean;
    tasks: SchedulerTask[];
  };
}

export async function createSchedulerTask(payload: {
  tenant_id?: string;
  name: string;
  kind: 'cron' | 'every' | 'once';
  schedule: string;
  lobster_id: string;
  prompt: string;
  session_mode?: 'shared' | 'per-peer' | 'isolated';
  delivery_channel?: string;
  max_retries?: number;
  enabled?: boolean;
}) {
  const { data } = await api.post('/api/v1/ai/scheduler/tasks', payload);
  return data as {
    ok: boolean;
    task_id: string;
    next_run_at?: string | null;
  };
}

export async function disableSchedulerTask(taskId: string, tenantId?: string) {
  const { data } = await api.delete(`/api/v1/ai/scheduler/tasks/${encodeURIComponent(taskId)}`, {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as {
    ok: boolean;
    status: string;
  };
}

export async function fetchSchedulerTaskHistory(taskId: string, limit = 20) {
  const { data } = await api.get(`/api/v1/ai/scheduler/tasks/${encodeURIComponent(taskId)}/history`, {
    params: { limit },
  });
  return data as {
    ok: boolean;
    history: SchedulerRunHistoryItem[];
  };
}

export type MemoryL1Report = {
  report_id: string;
  source_entry_id: string;
  lobster_id: string;
  task_summary: string;
  decision: string;
  outcome: string;
  next_steps: string[];
  key_entities: string[];
  metrics: Record<string, unknown>;
  tenant_id: string;
  created_at: string;
  token_count: number;
  source_token_count: number;
  promoted_to_l2: boolean;
};

export type MemoryL2Wisdom = {
  wisdom_id: string;
  category: string;
  statement: string;
  confidence: number;
  source_reports: string[];
  lobster_ids: string[];
  tenant_id: string;
  created_at: string;
  updated_at: string;
  merge_count: number;
};

export type MemoryLayerStats = {
  count: number;
  bytes: number;
};

export type MemoryStats = {
  tenant_id: string;
  layers: {
    l0: MemoryLayerStats;
    l1: MemoryLayerStats;
    l2: MemoryLayerStats;
  };
  compression: {
    avg_l0_to_l1_ratio: number;
    avg_reports_per_wisdom: number;
  };
  categories: Record<string, number>;
};

export async function fetchMemoryWisdoms(input?: {
  tenant_id?: string;
  category?: string;
  lobster_id?: string;
  limit?: number;
}) {
  const { data } = await api.get('/api/v1/ai/memory/wisdoms', {
    params: {
      ...(input?.tenant_id ? { tenant_id: input.tenant_id } : {}),
      ...(input?.category ? { category: input.category } : {}),
      ...(input?.lobster_id ? { lobster_id: input.lobster_id } : {}),
      ...(input?.limit ? { limit: input.limit } : {}),
    },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    count: number;
    wisdoms: MemoryL2Wisdom[];
  };
}

export async function fetchMemoryReports(input?: {
  tenant_id?: string;
  lobster_id?: string;
  limit?: number;
}) {
  const { data } = await api.get('/api/v1/ai/memory/reports', {
    params: {
      ...(input?.tenant_id ? { tenant_id: input.tenant_id } : {}),
      ...(input?.lobster_id ? { lobster_id: input.lobster_id } : {}),
      ...(input?.limit ? { limit: input.limit } : {}),
    },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    count: number;
    reports: MemoryL1Report[];
  };
}

export async function fetchMemoryStats(tenantId?: string) {
  const { data } = await api.get('/api/v1/ai/memory/stats', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    stats: MemoryStats;
  };
}

export async function fetchLobsterMemoryStats(tenantId: string, lobsterId: string) {
  const { data } = await api.get(`/api/v1/ai/memory/${encodeURIComponent(tenantId)}/${encodeURIComponent(lobsterId)}/stats`);
  return data as {
    status: string;
    data: Record<string, number>;
  };
}

export async function searchLobsterMemory(input: {
  tenant_id: string;
  lobster_id: string;
  query: string;
  category?: string;
  top_k?: number;
}) {
  const { data } = await api.get(
    `/api/v1/ai/memory/${encodeURIComponent(input.tenant_id)}/${encodeURIComponent(input.lobster_id)}/search`,
    {
      params: {
        query: input.query,
        ...(input.category ? { category: input.category } : {}),
        ...(input.top_k ? { top_k: input.top_k } : {}),
      },
    },
  );
  return data as {
    status: string;
    data: Array<Record<string, unknown>>;
  };
}

export async function hybridMemorySearch(input: {
  tenant_id: string;
  node_id?: string;
  lobster_name?: string;
  query: string;
  memory_type?: string;
  days?: number;
  top_k?: number;
}) {
  const { data } = await api.post('/api/v1/ai/memory/hybrid-search', input);
  return data as HybridMemorySearchResponse;
}

export async function listLobsterMemoryByCategory(tenantId: string, lobsterId: string, category: string) {
  const { data } = await api.get(
    `/api/v1/ai/memory/${encodeURIComponent(tenantId)}/${encodeURIComponent(lobsterId)}/${encodeURIComponent(category)}`,
  );
  return data as {
    status: string;
    data: Array<Record<string, unknown>>;
  };
}

export async function deleteLobsterMemoryItem(tenantId: string, lobsterId: string, category: string, key: string) {
  const { data } = await api.delete(
    `/api/v1/ai/memory/${encodeURIComponent(tenantId)}/${encodeURIComponent(lobsterId)}/${encodeURIComponent(category)}/${encodeURIComponent(key)}`,
  );
  return data as {
    status: string;
  };
}

export async function fetchPendingTasks(tenantId: string, lobsterId: string) {
  const { data } = await api.get(`/api/v1/ai/tasks/${encodeURIComponent(tenantId)}/${encodeURIComponent(lobsterId)}/pending`);
  return data as {
    status: string;
    data: Array<Record<string, unknown>>;
  };
}

export async function triggerMemoryCompression(payload?: MemoryCompressionRequest) {
  const { data } = await api.post('/api/v1/ai/memory/compress', payload ?? {});
  return data as MemoryCompressionRunResult;
}

export async function fetchMemoryCompressionStats(lobsterId: string, tenantId?: string) {
  const { data } = await api.get(`/api/v1/ai/memory/stats/${encodeURIComponent(lobsterId)}`, {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as {
    ok: boolean;
    stats: MemoryCompressionStats;
  };
}

export async function triggerVectorBackup(collections?: string[]) {
  const { data } = await api.post('/api/v1/ai/vector-backup/trigger', {
    collections,
  });
  return data as {
    ok: boolean;
    elapsed_seconds: number;
    collections: Record<string, { status: string; path?: string; size_mb?: number }>;
  };
}

export async function fetchVectorBackupSnapshots(collectionName: string) {
  const { data } = await api.get(`/api/v1/ai/vector-backup/snapshots/${encodeURIComponent(collectionName)}`);
  return data as {
    ok: boolean;
    collection_name: string;
    snapshots: VectorBackupSnapshot[];
  };
}

export async function fetchVectorBackupHistory(input?: { collection_name?: string; limit?: number }) {
  const { data } = await api.get('/api/v1/ai/vector-backup/history', {
    params: input,
  });
  return data as {
    ok: boolean;
    items: VectorBackupHistoryItem[];
  };
}

export type UsecaseSetupStep = {
  step: number;
  action: string;
  code_type?: 'bash' | 'config' | 'prompt' | 'none';
  code?: string;
  requires_user_input?: boolean;
};

export type UsecaseTemplate = {
  id: string;
  name: string;
  name_en?: string;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  description: string;
  pain_point?: string;
  lobsters: string[];
  skills_required?: string[];
  channels?: string[];
  setup_steps: UsecaseSetupStep[];
  scheduler_config?: {
    kind?: 'cron' | 'every' | 'once';
    schedule?: string;
    session_mode?: 'shared' | 'per-peer' | 'isolated';
  };
  tips?: string[];
  estimated_cost_per_run?: string;
  tags?: string[];
};

export async function fetchUsecases(input?: { category?: string; difficulty?: string }) {
  const { data } = await api.get('/api/v1/ai/usecases', {
    params: {
      ...(input?.category ? { category: input.category } : {}),
      ...(input?.difficulty ? { difficulty: input.difficulty } : {}),
    },
  });
  return data as {
    ok: boolean;
    count: number;
    usecases: UsecaseTemplate[];
  };
}

export async function fetchUsecaseCategories() {
  const { data } = await api.get('/api/v1/ai/usecases/categories');
  return data as {
    ok: boolean;
    categories: Array<{ category: string; count: number }>;
  };
}

export async function fetchUsecaseDetail(usecaseId: string) {
  const { data } = await api.get(`/api/v1/ai/usecases/${encodeURIComponent(usecaseId)}`);
  return data as {
    ok: boolean;
    usecase: UsecaseTemplate;
  };
}

export async function fetchWorkflowDefinitions() {
  const { data } = await api.get('/api/v1/ai/workflow/list');
  return data as {
    ok: boolean;
    workflows: WorkflowDefinitionSummary[];
  };
}

export async function fetchWorkflowLifecycle(workflowId: string) {
  const { data } = await api.get(`/api/v1/workflows/${encodeURIComponent(workflowId)}/lifecycle`);
  return data as {
    ok: boolean;
    workflow_id: string;
    lifecycle: WorkflowLifecycle;
  };
}

export async function updateWorkflowLifecycle(
  workflowId: string,
  payload: { new_lifecycle: WorkflowLifecycle; reason?: string },
) {
  const { data } = await api.put(`/api/v1/workflows/${encodeURIComponent(workflowId)}/lifecycle`, payload);
  return data as {
    ok: boolean;
    event: Record<string, unknown>;
  };
}

export async function fetchWorkflowDetail(workflowId: string) {
  const { data } = await api.get(`/api/v1/workflows/${encodeURIComponent(workflowId)}`);
  return data as {
    ok: boolean;
    workflow: WorkflowDefinitionDetail;
  };
}

export async function updateWorkflowDefinition(
  workflowId: string,
  payload: {
    name?: string;
    description?: string;
    error_workflow_id?: string | null;
    error_notify_channels?: string[] | null;
  },
) {
  const { data } = await api.put(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, payload);
  return data as {
    ok: boolean;
    workflow: WorkflowDefinitionDetail;
  };
}

export async function startWorkflowRun(payload: {
  workflow_id: string;
  task: string;
  context?: Record<string, unknown>;
  notify_url?: string;
  idempotency_key?: string;
}) {
  const idempotencyKey = payload.idempotency_key || buildWorkflowIdempotencyKey(payload.workflow_id, payload.task, payload.context);
  const { data } = await api.post('/api/v1/ai/workflow/run', {
    ...payload,
    idempotency_key: idempotencyKey,
  });
  return data as {
    ok: boolean;
    run_id: string;
    status: string;
    run: WorkflowRunStatus;
    duplicate?: boolean;
    idempotency_key?: string;
  };
}

export async function fetchWorkflowRun(runId: string) {
  const { data } = await api.get(`/api/v1/ai/workflow/run/${encodeURIComponent(runId)}`);
  return data as {
    ok: boolean;
    run: WorkflowRunStatus;
  };
}

export async function resumeWorkflowRun(runId: string) {
  const { data } = await api.post(`/api/v1/ai/workflow/run/${encodeURIComponent(runId)}/resume`);
  return data as {
    ok: boolean;
    success: boolean;
  };
}

export async function pauseWorkflowRun(runId: string) {
  const { data } = await api.post(`/api/v1/ai/workflow/run/${encodeURIComponent(runId)}/pause`);
  return data as {
    ok: boolean;
    success: boolean;
  };
}

export async function fetchWorkflowRuns(limit = 20) {
  const { data } = await api.get('/api/v1/ai/workflow/runs', {
    params: { limit },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    count: number;
    runs: WorkflowRunListItem[];
  };
}

export async function fetchWorkflowExecutions(
  workflowId: string,
  input?: { page?: number; page_size?: number; status?: string },
) {
  const { data } = await api.get(`/api/v1/workflows/${encodeURIComponent(workflowId)}/executions`, {
    params: input,
  });
  return data as {
    ok: boolean;
    workflow_id: string;
    items: WorkflowRunListItem[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
  };
}

export async function fetchWorkflowExecution(executionId: string) {
  const { data } = await api.get(`/api/v1/workflows/executions/${encodeURIComponent(executionId)}`);
  return data as {
    ok: boolean;
    execution: WorkflowRunStatus;
  };
}

export async function replayWorkflowExecution(executionId: string, payload?: { from_step_id?: string | null }) {
  const { data } = await api.post(`/api/v1/workflows/executions/${encodeURIComponent(executionId)}/replay`, payload ?? {});
  return data as {
    ok: boolean;
    new_execution_id: string;
    replayed_from: string;
  };
}

export async function fetchTenantConcurrencyStats() {
  const { data } = await api.get('/api/v1/tenant/concurrency-stats');
  return data as TenantConcurrencyStats;
}

function buildWorkflowIdempotencyKey(
  workflowId: string,
  task: string,
  context?: Record<string, unknown>,
): string {
  const bucket = Math.floor(Date.now() / 60_000);
  const raw = `${workflowId}:${task}:${JSON.stringify(context || {})}:${bucket}`;
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0;
  }
  return `manual:${workflowId}:${bucket}:${Math.abs(hash)}`;
}

export async function fetchWorkflowTemplates(input?: {
  category?: string;
  difficulty?: string;
  featured_only?: boolean;
  search?: string;
}) {
  const { data } = await api.get('/api/v1/workflow-templates', {
    params: input,
  });
  return data as {
    ok: boolean;
    count: number;
    templates: WorkflowTemplate[];
  };
}

export async function useWorkflowTemplate(templateId: string, payload?: { name?: string }) {
  const { data } = await api.post(`/api/v1/workflow-templates/${encodeURIComponent(templateId)}/use`, payload ?? {});
  return data as {
    ok: boolean;
    workflow_id: string;
    workflow_path: string;
    source_template_id: string;
  };
}

export async function fetchWorkflowWebhooks(workflowId: string) {
  const { data } = await api.get(`/api/v1/workflows/${encodeURIComponent(workflowId)}/webhooks`);
  return data as {
    ok: boolean;
    workflow_id: string;
    items: WorkflowWebhook[];
  };
}

export async function createWorkflowWebhook(
  workflowId: string,
  payload: {
    name: string;
    http_method?: 'POST' | 'GET' | 'ANY';
    auth_type?: 'none' | 'header_token' | 'basic_auth';
    auth_config?: Record<string, string>;
    response_mode?: 'immediate' | 'wait_for_completion';
  },
) {
  const { data } = await api.post(`/api/v1/workflows/${encodeURIComponent(workflowId)}/webhooks`, payload);
  return data as {
    ok: boolean;
    webhook: WorkflowWebhook;
  };
}

export async function deleteWorkflowWebhook(workflowId: string, webhookId: string) {
  const { data } = await api.delete(
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/webhooks/${encodeURIComponent(webhookId)}`,
  );
  return data as {
    ok: boolean;
    deleted: boolean;
  };
}

export async function fetchProviderHealth() {
  const { data } = await api.get('/api/v1/ai/providers/health');
  return data as {
    ok: boolean;
    generated_at: string;
    providers: ProviderConfig[];
  };
}

export const providerEndpoints = {
  list: () => '/api/v1/ai/providers',
  create: () => '/api/v1/ai/providers',
  update: (id: string) => `/api/v1/ai/providers/${encodeURIComponent(id)}`,
  delete: (id: string) => `/api/v1/ai/providers/${encodeURIComponent(id)}`,
  reload: (id: string) => `/api/v1/ai/providers/${encodeURIComponent(id)}/reload`,
  smoke: (id: string) => `/api/v1/ai/providers/${encodeURIComponent(id)}/smoke`,
  health: () => '/api/v1/ai/providers/health',
  metrics: (id: string) => `/api/v1/ai/providers/${encodeURIComponent(id)}/metrics`,
};

export async function fetchProviders() {
  const { data } = await api.get(providerEndpoints.list());
  return data as {
    ok: boolean;
    generated_at: string;
    providers: ProviderConfig[];
  };
}

export async function createProvider(payload: {
  id: string;
  name: string;
  type: 'openai_compatible' | 'anthropic' | 'gemini' | 'local';
  route: 'local' | 'cloud';
  base_url: string;
  api_key?: string | null;
  models?: string[];
  default_model: string;
  priority?: number;
  weight?: number;
  enabled?: boolean;
  note?: string;
}) {
  const securePayload = {
    ...payload,
    api_key: payload.api_key ? await encryptSensitiveField(payload.api_key) : payload.api_key,
  };
  const { data } = await api.post(providerEndpoints.create(), securePayload);
  return data as {
    ok: boolean;
    provider: ProviderConfig;
  };
}

export async function updateProviderConfig(
  providerId: string,
  payload: Partial<{
    name: string;
    type: 'openai_compatible' | 'anthropic' | 'gemini' | 'local';
    route: 'local' | 'cloud';
    base_url: string;
    api_key: string | null;
    models: string[];
    default_model: string;
    priority: number;
    weight: number;
    enabled: boolean;
    note: string;
  }>,
) {
  const securePayload = {
    ...payload,
    api_key: payload.api_key ? await encryptSensitiveField(payload.api_key) : payload.api_key,
  };
  const { data } = await api.put(providerEndpoints.update(providerId), securePayload);
  return data as {
    ok: boolean;
    provider: ProviderConfig;
  };
}

export async function deleteProviderConfig(providerId: string) {
  const { data } = await api.delete(providerEndpoints.delete(providerId));
  return data as {
    ok: boolean;
    deleted: boolean;
  };
}

export async function reloadProviderConfig(providerId: string) {
  const { data } = await api.post(providerEndpoints.reload(providerId));
  return data as {
    ok: boolean;
    provider_id: string;
    reloaded: boolean;
  };
}

export async function smokeProviderConfig(providerId: string, prompt?: string) {
  const { data } = await api.post(providerEndpoints.smoke(providerId), prompt ? { prompt } : {});
  return data as {
    ok: boolean;
    provider_id: string;
    status: 'healthy' | 'degraded' | 'offline';
    response?: string;
    error?: string;
    latency_ms: number;
  };
}

export async function fetchProviderMetrics(providerId: string) {
  const { data } = await api.get(providerEndpoints.metrics(providerId));
  return data as {
    ok: boolean;
    metrics: ProviderMetrics;
  };
}

export async function fetchFeatureFlags(input?: { environment?: string; tenant_id?: string }) {
  const { data } = await api.get('/api/v1/feature-flags', { params: input });
  return data as {
    ok: boolean;
    flags: FeatureFlag[];
  };
}

export async function createFeatureFlag(payload: {
  name: string;
  enabled?: boolean;
  environment?: 'dev' | 'staging' | 'prod';
  strategies?: FlagStrategy[];
  variants?: FlagVariant[];
  description?: string;
  tags?: string[];
  tenant_id?: string | null;
}) {
  const { data } = await api.post('/api/v1/feature-flags', payload);
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function updateFeatureFlag(name: string, payload: Partial<FeatureFlag>) {
  const { data } = await api.put(`/api/v1/feature-flags/${encodeURIComponent(name)}`, payload);
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function enableFeatureFlag(name: string, input?: { environment?: string; tenant_id?: string }) {
  const { data } = await api.post(`/api/v1/feature-flags/${encodeURIComponent(name)}/enable`, {}, { params: input });
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function disableFeatureFlag(name: string, input?: { environment?: string; tenant_id?: string }) {
  const { data } = await api.post(`/api/v1/feature-flags/${encodeURIComponent(name)}/disable`, {}, { params: input });
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function updateFeatureFlagStrategies(name: string, payload: { environment?: string; tenant_id?: string; strategies: FlagStrategy[] }) {
  const { data } = await api.post(`/api/v1/feature-flags/${encodeURIComponent(name)}/strategies`, payload);
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function updateFeatureFlagVariants(name: string, payload: { environment?: string; tenant_id?: string; variants: FlagVariant[] }) {
  const { data } = await api.post(`/api/v1/feature-flags/${encodeURIComponent(name)}/variants`, payload);
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function deleteFeatureFlag(name: string, input?: { environment?: string; tenant_id?: string }) {
  const { data } = await api.delete(`/api/v1/feature-flags/${encodeURIComponent(name)}`, { params: input });
  return data as { ok: boolean; deleted: boolean };
}

export async function checkFeatureFlag(payload: {
  flag_name: string;
  tenant_id: string;
  user_id?: string;
  lobster_id?: string;
  edge_node_id?: string;
  edge_node_tags?: string[];
  environment?: 'dev' | 'staging' | 'prod';
}) {
  const { data } = await api.post('/api/v1/feature-flags/check', payload);
  return data as ({ ok: boolean } & FlagCheckResult);
}

export async function fetchFeatureFlagChangelog(input?: { name?: string; limit?: number }) {
  const { data } = await api.get('/api/v1/feature-flags/changelog', { params: input });
  return data as { ok: boolean; items: Array<Record<string, unknown>> };
}

export async function exportFeatureFlags(input?: { environment?: string }) {
  const { data } = await api.post('/api/v1/feature-flags/export', undefined, { params: input });
  return data as { ok: boolean; exported_at: string; flags: FeatureFlag[] };
}

export async function importFeatureFlags(payload: { flags: FeatureFlag[] }) {
  const { data } = await api.post('/api/v1/feature-flags/import', payload);
  return data as { ok: boolean; imported: number };
}

export async function listAiExperiments() {
  const { data } = await api.get<AiExperimentListResponse>('/api/v1/ai/experiments');
  return data;
}

export async function fetchAiExperiment(experimentId: string) {
  const { data } = await api.get<AiExperimentSummary>(`/api/v1/ai/experiments/${encodeURIComponent(experimentId)}`);
  return data;
}

export async function compareAiExperiments(payload: { a: string; b: string }) {
  const { data } = await api.get<AiExperimentCompareResponse>('/api/v1/ai/experiments/compare', {
    params: payload,
  });
  return data;
}

export async function diffAiPromptVersions(promptName: string, versions?: { version_a?: string; version_b?: string }) {
  const { data } = await api.get<AiPromptDiffResponse>(`/api/v1/ai/prompts/${encodeURIComponent(promptName)}/diff`, {
    params: {
      ...(versions?.version_a ? { version_a: versions.version_a } : {}),
      ...(versions?.version_b ? { version_b: versions.version_b } : {}),
    },
  });
  return data;
}

export async function fetchPromptExperiments() {
  const { data } = await api.get('/api/v1/prompt-experiments');
  return data as { ok: boolean; items: PromptExperiment[] };
}

export async function createPromptExperiment(payload: {
  lobster_name: string;
  skill_name: string;
  rollout_percent: number;
  experiment_variant: string;
  prompt_text: string;
  environment?: 'dev' | 'staging' | 'prod';
}) {
  const { data } = await api.post('/api/v1/prompt-experiments', payload);
  return data as { ok: boolean; flag: FeatureFlag; prompt_path: string };
}

export async function fetchPromptExperimentReport(flagName: string) {
  const { data } = await api.get(`/api/v1/prompt-experiments/${encodeURIComponent(flagName)}/report`);
  return data as { ok: boolean; report: ExperimentReport };
}

export async function promotePromptExperiment(flagName: string, winnerVariant: string) {
  const { data } = await api.post(`/api/v1/prompt-experiments/${encodeURIComponent(flagName)}/promote`, { winner_variant: winnerVariant });
  return data as { ok: boolean; result: Record<string, unknown> };
}

export async function stopPromptExperiment(flagName: string) {
  const { data } = await api.post(`/api/v1/prompt-experiments/${encodeURIComponent(flagName)}/stop`);
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function globalSearch(input: { q: string; types?: string; limit?: number }) {
  const { data } = await api.get('/api/v1/search', { params: input });
  return data as ({ ok: boolean; query: string } & SearchResults);
}

export async function fetchLobsters(input?: { lifecycle?: Lifecycle | '' }) {
  const { data } = await api.get('/api/v1/lobsters', {
    params: input?.lifecycle ? { lifecycle: input.lifecycle } : undefined,
  });
  return data as {
    ok: boolean;
    count: number;
    items: Array<Record<string, unknown>>;
  };
}

export async function fetchLobsterEntity(lobsterId: string) {
  const { data } = await api.get(`/api/v1/lobsters/${encodeURIComponent(lobsterId)}`);
  return data as {
    ok: boolean;
    lobster: Record<string, unknown>;
    recent_runs: LobsterRun[];
    hourly_usage: Array<Record<string, unknown>>;
  };
}

export async function fetchLobsterEntityStats(lobsterId: string) {
  const { data } = await api.get(`/api/v1/lobsters/${encodeURIComponent(lobsterId)}/stats`);
  return data as {
    ok: boolean;
    stats: {
      weekly_runs: number;
      avg_quality_score: number;
      p95_latency_ms: number;
      active_edge_nodes: number;
    };
  };
}

export async function fetchLobsterMetricsHistory(lobsterId: string, days = 30) {
  const { data } = await api.get(`/api/v1/ai/metrics/lobster/${encodeURIComponent(lobsterId)}/history`, {
    params: { days },
  });
  return data as {
    ok: boolean;
    items: LobsterMetricsHistoryPoint[];
  };
}

export async function fetchLobsterEntityRuns(lobsterId: string, limit = 20) {
  const { data } = await api.get(`/api/v1/lobsters/${encodeURIComponent(lobsterId)}/runs`, { params: { limit } });
  return data as {
    ok: boolean;
    items: LobsterRun[];
    data?: LobsterRun[];
    total?: number;
    page?: number;
    page_size?: number;
    total_pages?: number;
  };
}

export async function fetchLobsterRunsPage(input?: {
  lobster_id?: string;
  status?: string;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
}) {
  const { data } = await api.get('/api/v1/lobsters/runs', { params: input });
  return data as {
    ok: boolean;
    tenant_id: string;
    items: LobsterRun[];
    data: LobsterRun[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
  };
}

export async function fetchLobsterEntityDocs(lobsterId: string) {
  const { data } = await api.get(`/api/v1/lobsters/${encodeURIComponent(lobsterId)}/docs`);
  return data as {
    ok: boolean;
    lobster_id: string;
    content: string;
    path: string;
  };
}

export async function fetchLobsterEntitySkills(lobsterId: string) {
  const { data } = await api.get(`/api/v1/lobsters/${encodeURIComponent(lobsterId)}/skills`);
  return data as {
    ok: boolean;
    items: LobsterSkill[];
  };
}

export async function fetchLobsterLifecycle(lobsterId: string) {
  const { data } = await api.get(`/api/v1/lobsters/${encodeURIComponent(lobsterId)}/lifecycle`);
  return data as {
    ok: boolean;
    lobster_id: string;
    lifecycle: Lifecycle;
  };
}

export async function updateLobsterLifecycle(lobsterId: string, payload: { new_lifecycle: Lifecycle; reason?: string }) {
  const { data } = await api.put(`/api/v1/lobsters/${encodeURIComponent(lobsterId)}/lifecycle`, payload);
  return data as {
    ok: boolean;
    event: LifecycleChangeEvent;
  };
}

export async function executeLobster(
  lobsterId: string,
  payload: {
    prompt: string;
    session_mode?: 'shared' | 'per-peer' | 'isolated';
    peer_id?: string;
    fresh_context?: boolean;
  },
) {
  const { data } = await api.post(`/api/v1/lobsters/${encodeURIComponent(lobsterId)}/execute`, payload);
  return data as {
    ok: boolean;
    result?: string;
    stop_reason?: string;
    error?: string | null;
  };
}

export async function fetchRbacPermissions() {
  const { data } = await api.get('/api/v1/rbac/permissions');
  return data as {
    ok: boolean;
    tenant_id: string;
    permissions: ResourcePermission[];
  };
}

export async function createRbacPermission(payload: {
  tenant_id?: string;
  resource_type: ResourceType | 'tenant';
  resource_id: string;
  scope: ResourceScope;
  subject_type: SubjectType;
  subject_id: string;
  granted?: boolean;
  note?: string;
}) {
  const { data } = await api.post('/api/v1/rbac/permissions', payload);
  return data as {
    ok: boolean;
    permission: ResourcePermission;
  };
}

export async function deleteRbacPermission(permissionId: string) {
  const { data } = await api.delete(`/api/v1/rbac/permissions/${encodeURIComponent(permissionId)}`);
  return data as {
    ok: boolean;
    deleted: boolean;
  };
}

export async function fetchUserRbacPermissions(userId: string) {
  const { data } = await api.get(`/api/v1/rbac/users/${encodeURIComponent(userId)}/permissions`);
  return data as {
    ok: boolean;
    tenant_id: string;
    user_id: string;
    permissions: ResourcePermission[];
  };
}

export async function checkRbacPermission(payload: {
  tenant_id?: string;
  user_id: string;
  resource_type: ResourceType | 'tenant';
  resource_id: string;
  scope: ResourceScope;
  roles?: string[];
}) {
  const { data } = await api.post('/api/v1/rbac/check', payload);
  return data as { ok: boolean } & PermissionCheckResult;
}

export async function fetchRbacMatrix() {
  const { data } = await api.get('/api/v1/rbac/matrix');
  return data as {
    ok: boolean;
    matrix: Record<string, Record<string, string[]>>;
    roles: Array<{ id: string; name: string; description: string }>;
  };
}

export async function fetchAuditEventTypes() {
  const { data } = await api.get('/api/v1/audit/event-types');
  return data as {
    ok: boolean;
    items: Array<{ event_type: string; category: string; severity: string }>;
  };
}

export async function fetchAuditEvents(filters?: AuditEventFilter) {
  const { data } = await api.get('/api/v1/audit/events', { params: filters });
  return data as {
    ok: boolean;
    tenant_id: string;
    items: AuditEvent[];
    data: AuditEvent[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
  };
}

export async function fetchChartAnnotations(input: {
  tenant_id?: string;
  start_time?: string;
  end_time?: string;
  lobster_id?: string;
  annotation_types?: string;
  limit?: number;
}) {
  const { data } = await api.get('/api/observability/chart/annotations', { params: input });
  return data as {
    ok: boolean;
    annotations: ChartAnnotation[];
  };
}

export async function fetchEventBusSubjects(prefix?: string) {
  const { data } = await api.get('/api/observability/event-bus/subjects', {
    params: prefix ? { prefix } : undefined,
  });
  return data as {
    ok: boolean;
    subjects: EventBusSubjectStat[];
    total_subjects: number;
  };
}

export async function fetchEventBusPrefixSummary() {
  const { data } = await api.get('/api/observability/event-bus/prefix-summary');
  return data as {
    ok: boolean;
    prefixes: EventBusPrefixSummary[];
  };
}

export async function fetchObservabilityTraces(input?: {
  tenant_id?: string;
  workflow_name?: string;
  status?: string;
  limit?: number;
}) {
  const { data } = await api.get('/api/observability/traces', { params: input });
  return data as {
    total: number;
    traces: WorkflowTrace[];
  };
}

export async function fetchObservabilityTrace(traceId: string) {
  const { data } = await api.get(`/api/observability/traces/${encodeURIComponent(traceId)}`);
  return data as WorkflowTrace;
}

export async function fetchAlertRules() {
  const { data } = await api.get('/api/v1/alerts/rules');
  return data as { ok: boolean; tenant_id: string; items: AlertRule[] };
}

export async function createAlertRule(payload: Omit<AlertRule, 'rule_id' | 'state' | 'pending_since' | 'last_fired_at' | 'last_resolved_at'>) {
  const { data } = await api.post('/api/v1/alerts/rules', payload);
  return data as { ok: boolean; rule: AlertRule };
}

export async function updateAlertRule(ruleId: string, payload: Omit<AlertRule, 'rule_id' | 'state' | 'pending_since' | 'last_fired_at' | 'last_resolved_at'>) {
  const { data } = await api.put(`/api/v1/alerts/rules/${encodeURIComponent(ruleId)}`, payload);
  return data as { ok: boolean; rule: AlertRule };
}

export async function evaluateAlertRules() {
  const { data } = await api.post('/api/v1/alerts/evaluate');
  return data as { ok: boolean; tenant_id: string; events: AlertEvent[] };
}

export async function fetchAlertEvents(limit = 100) {
  const { data } = await api.get('/api/v1/alerts/events', { params: { limit } });
  return data as { ok: boolean; tenant_id: string; items: AlertEvent[] };
}

export async function fetchAlertChannels() {
  const { data } = await api.get('/api/v1/alerts/channels');
  return data as { ok: boolean; tenant_id: string; items: AlertNotificationChannel[] };
}

export async function createAlertChannel(payload: Omit<AlertNotificationChannel, 'channel_id'>) {
  const { data } = await api.post('/api/v1/alerts/channels', payload);
  return data as { ok: boolean; channel: AlertNotificationChannel };
}

export async function runAuditCleanup() {
  const { data } = await api.post('/api/v1/audit/cleanup');
  return data as {
    ok: boolean;
    tenant_id: string;
    result: Record<string, number>;
  };
}

export async function fetchWhiteLabelConfig(tenantId: string) {
  const { data } = await api.get(`/api/v1/white-label/${encodeURIComponent(tenantId)}`);
  return data as {
    ok: boolean;
    config: WhiteLabelConfig;
  };
}

export async function resolveWhiteLabelConfig(input?: { tenant_id?: string; host?: string }) {
  const { data } = await api.get('/api/v1/white-label/resolve', { params: input });
  return data as {
    ok: boolean;
    tenant_id: string;
    config: WhiteLabelConfig;
    css_vars: WhiteLabelCSSVars;
    meta: Record<string, string | null>;
  };
}

export async function fetchWhiteLabelPreview(tenantId: string) {
  const { data } = await api.get(`/api/v1/white-label/${encodeURIComponent(tenantId)}/preview`);
  return data as {
    ok: boolean;
    config: WhiteLabelConfig;
    css_vars: WhiteLabelCSSVars;
    meta: Record<string, string | null>;
  };
}

export async function updateWhiteLabelConfig(
  tenantId: string,
  payload: Partial<WhiteLabelConfig>,
) {
  const { data } = await api.put(`/api/v1/white-label/${encodeURIComponent(tenantId)}`, payload);
  return data as {
    ok: boolean;
    config: WhiteLabelConfig;
  };
}

export async function uploadWhiteLabelLogo(
  tenantId: string,
  payload: { filename: string; content_base64: string },
) {
  const { data } = await api.post(`/api/v1/white-label/${encodeURIComponent(tenantId)}/logo`, payload);
  return data as {
    ok: boolean;
    url: string;
  };
}

export async function deleteWhiteLabelConfig(tenantId: string) {
  const { data } = await api.delete(`/api/v1/white-label/${encodeURIComponent(tenantId)}`);
  return data as {
    ok: boolean;
    deleted: boolean;
  };
}

export async function fetchEscalations(input?: { status?: string; limit?: number }) {
  const { data } = await api.get('/api/v1/ai/escalations', {
    params: {
      ...(input?.status ? { status: input.status } : {}),
      ...(input?.limit ? { limit: input.limit } : {}),
    },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    items: Array<Record<string, unknown>>;
  };
}

export async function resolveEscalation(payload: {
  escalation_id: string;
  resolution: 'continue' | 'skip' | 'retry';
  note?: string;
  resolved_by?: string;
}) {
  const { data } = await api.post(`/api/v1/ai/escalations/${encodeURIComponent(payload.escalation_id)}/resolve`, {
    resolution: payload.resolution,
    note: payload.note,
    resolved_by: payload.resolved_by,
  });
  return data as {
    ok: boolean;
    escalation: Record<string, unknown>;
  };
}

export async function fetchIndustryList() {
  return {
    ok: true,
    count: INDUSTRY_SUBCATEGORIES.length,
    categories: INDUSTRY_CATEGORIES,
    items: INDUSTRY_SUBCATEGORIES,
  } as {
    ok: boolean;
    count: number;
    categories: string[];
    items: IndustrySubcategory[];
  };
}

export async function triggerActiveHeartbeatCheck() {
  const { data } = await api.get('/api/v1/ai/heartbeat/active-check');
  return data as {
    ok: boolean;
    tenant_id: string;
    issue_count: number;
    issues: Array<Record<string, unknown>>;
  };
}

export async function fetchActiveHeartbeatHistory() {
  const { data } = await api.get('/api/v1/ai/heartbeat/active-check/history');
  return data as {
    ok: boolean;
    tenant_id: string;
    last_report?: Record<string, unknown> | null;
    history: Array<Record<string, unknown>>;
  };
}

export async function fetchCommanderSuggestedIntents() {
  const { data } = await api.get('/api/v1/ai/commander/suggested-intents');
  return data as {
    ok: boolean;
    tenant_id: string;
    suggested_intents: Array<Record<string, unknown>>;
  };
}

export async function fetchRestoreEvents(limit = 20) {
  const { data } = await api.get('/api/v1/ai/restore-events', {
    params: { limit },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    events: Array<Record<string, unknown>>;
  };
}

export async function fetchMcpServers() {
  const { data } = await api.get('/api/v1/ai/mcp/servers');
  return data as {
    ok: boolean;
    servers: MCPServer[];
  };
}

export const mcpEndpoints = {
  listServers: () => '/api/v1/ai/mcp/servers',
  registerServer: () => '/api/v1/ai/mcp/servers',
  deleteServer: (id: string) => `/api/v1/ai/mcp/servers/${encodeURIComponent(id)}`,
  updateServer: (id: string) => `/api/v1/ai/mcp/servers/${encodeURIComponent(id)}`,
  discoverTools: (id: string) => `/api/v1/ai/mcp/servers/${encodeURIComponent(id)}/tools`,
  pingServer: (id: string) => `/api/v1/ai/mcp/servers/${encodeURIComponent(id)}/ping`,
  callHistory: () => '/api/v1/ai/mcp/call/history',
  monitorTop: () => '/api/v1/ai/mcp/monitor/top',
  monitorHeatmap: () => '/api/v1/ai/mcp/monitor/heatmap',
  monitorFailures: () => '/api/v1/ai/mcp/monitor/failures',
  monitorRecent: () => '/api/v1/ai/mcp/monitor/recent',
  policies: () => '/api/v1/ai/mcp/policies',
  marketplace: () => '/api/v1/ai/mcp/marketplace',
  subscriptions: () => '/api/v1/ai/mcp/marketplace/subscriptions',
};

export async function createMcpServer(payload: {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'edge';
  command?: string;
  url?: string;
  env: Record<string, string>;
  enabled?: boolean;
  allowed_lobsters?: string[];
  edge_node_id?: string;
}) {
  const { data } = await api.post('/api/v1/ai/mcp/servers', payload);
  return data as {
    ok: boolean;
    server: MCPServer;
  };
}

export async function updateMcpServer(serverId: string, payload: Partial<{
  name: string;
  transport: 'stdio' | 'sse' | 'edge';
  command: string;
  url: string;
  env: Record<string, string>;
  enabled: boolean;
  allowed_lobsters: string[];
  edge_node_id: string;
}>) {
  const { data } = await api.put(`/api/v1/ai/mcp/servers/${encodeURIComponent(serverId)}`, payload);
  return data as {
    ok: boolean;
    server: MCPServer;
  };
}

export async function deleteMcpServer(serverId: string) {
  const { data } = await api.delete(`/api/v1/ai/mcp/servers/${encodeURIComponent(serverId)}`);
  return data as {
    ok: boolean;
    deleted: boolean;
  };
}

export async function fetchMcpTools(serverId: string) {
  const { data } = await api.get(`/api/v1/ai/mcp/servers/${encodeURIComponent(serverId)}/tools`);
  return data as {
    ok: boolean;
    tools: MCPTool[];
  };
}

export async function pingMcpServer(serverId: string) {
  const { data } = await api.post(`/api/v1/ai/mcp/servers/${encodeURIComponent(serverId)}/ping`);
  return data as {
    ok: boolean;
    server_id: string;
    healthy: boolean;
  };
}

export async function testMcpCall(payload: {
  server_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  lobster_id?: string;
}) {
  const { data } = await api.post('/api/v1/ai/mcp/call', payload);
  return data as {
    ok: boolean;
    result?: Record<string, unknown>;
    error?: Record<string, unknown>;
  };
}

export async function fetchMcpCallHistory(limit = 100) {
  const { data } = await api.get('/api/v1/ai/mcp/call/history', {
    params: { limit },
  });
  return data as {
    ok: boolean;
    items: MCPCallRecord[];
  };
}

export async function fetchMcpMonitorTop(limit = 10) {
  const { data } = await api.get('/api/v1/ai/mcp/monitor/top', { params: { limit } });
  return data as { ok: boolean; items: MCPToolMonitorTopItem[] };
}

export async function fetchMcpMonitorHeatmap() {
  const { data } = await api.get('/api/v1/ai/mcp/monitor/heatmap');
  return data as { ok: boolean; items: MCPToolMonitorHeatmapItem[] };
}

export async function fetchMcpMonitorFailures() {
  const { data } = await api.get('/api/v1/ai/mcp/monitor/failures');
  return data as { ok: boolean; items: MCPToolMonitorFailureItem[] };
}

export async function fetchMcpMonitorRecent(limit = 50) {
  const { data } = await api.get('/api/v1/ai/mcp/monitor/recent', { params: { limit } });
  return data as { ok: boolean; items: MCPCallRecord[] };
}

export async function fetchMcpPolicies() {
  const { data } = await api.get('/api/v1/ai/mcp/policies');
  return data as { ok: boolean; items: MCPToolPolicy[] };
}

export async function updateMcpPolicy(lobsterName: string, payload: Partial<MCPToolPolicy>) {
  const { data } = await api.put(`/api/v1/ai/mcp/policies/${encodeURIComponent(lobsterName)}`, payload);
  return data as { ok: boolean; policy: MCPToolPolicy };
}

export async function fetchToolMarketplace(params?: { category?: string; tag?: string }) {
  const { data } = await api.get('/api/v1/ai/mcp/marketplace', { params });
  return data as { ok: boolean; items: ToolMarketplaceListing[] };
}

export async function publishToolMarketplace(payload: ToolMarketplaceListing) {
  const { data } = await api.post('/api/v1/ai/mcp/marketplace', payload);
  return data as { ok: boolean; item: ToolMarketplaceListing };
}

export async function fetchToolSubscriptions() {
  const { data } = await api.get('/api/v1/ai/mcp/marketplace/subscriptions');
  return data as { ok: boolean; items: ToolMarketplaceSubscription[] };
}

export async function subscribeTool(tool_id: string, tenant_id?: string) {
  const { data } = await api.post('/api/v1/ai/mcp/marketplace/subscribe', { tool_id, tenant_id });
  return data as { ok: boolean; tool_id: string; tenant_id: string };
}

export async function unsubscribeTool(tool_id: string, tenant_id?: string) {
  const { data } = await api.post('/api/v1/ai/mcp/marketplace/unsubscribe', { tool_id, tenant_id });
  return data as { ok: boolean; tool_id: string; tenant_id: string };
}

export type SessionSummary = {
  session_id: string;
  peer_id: string;
  lobster_id: string;
  tenant_id: string;
  channel: string;
  mode: 'shared' | 'per-peer' | 'isolated';
  message_count: number;
  last_active_at: string;
};

export type SessionHistoryMessage = {
  role: string;
  content: string;
  timestamp?: string;
};

export async function fetchSessions(input?: { peer_id?: string; lobster_id?: string }) {
  const { data } = await api.get('/api/v1/ai/sessions', {
    params: {
      ...(input?.peer_id ? { peer_id: input.peer_id } : {}),
      ...(input?.lobster_id ? { lobster_id: input.lobster_id } : {}),
    },
  });
  return data as {
    ok: boolean;
    count: number;
    sessions: SessionSummary[];
  };
}

export async function fetchSessionHistory(sessionId: string, limit = 50) {
  const { data } = await api.get(`/api/v1/ai/sessions/${encodeURIComponent(sessionId)}/history`, {
    params: { limit },
  });
  return data as {
    ok: boolean;
    messages: SessionHistoryMessage[];
  };
}

export async function clearSession(sessionId: string) {
  const { data } = await api.delete(`/api/v1/ai/sessions/${encodeURIComponent(sessionId)}`);
  return data as {
    ok: boolean;
    status: string;
  };
}

export type ChannelAccountSummary = {
  id: string;
  name: string;
  enabled: boolean;
  tenant: string;
  options?: Record<string, unknown>;
};

export async function fetchChannelStatus() {
  const { data } = await api.get('/api/v1/ai/channels/status');
  return data as Record<
    string,
    {
      total: number;
      enabled: number;
      accounts: ChannelAccountSummary[];
    }
  >;
}

export async function fetchChannelAccounts(channel: string) {
  const { data } = await api.get(`/api/v1/ai/channels/${encodeURIComponent(channel)}/accounts`);
  return data as {
    channel: string;
    accounts: ChannelAccountSummary[];
  };
}

export async function updateChannelAccountOptions(input: {
  channel: string;
  account_id: string;
  dm_scope: 'shared' | 'per-peer' | 'isolated';
}) {
  const { data } = await api.put(
    `/api/v1/ai/channels/${encodeURIComponent(input.channel)}/accounts/${encodeURIComponent(input.account_id)}`,
    { dm_scope: input.dm_scope },
  );
  return data as {
    ok: boolean;
    channel: string;
    account: ChannelAccountSummary;
  };
}

export async function runDragonTeamAsync(payload: RunDragonTeamPayload) {
  const { data } = await api.post<RunDragonTeamAsyncAccepted>('/api/v1/ai/run-dragon-team-async', payload);
  return data;
}

export async function previewPipelineMode(payload: PipelineModePreviewPayload) {
  const { data } = await api.post('/api/v1/ai/pipeline-modes/preview', payload);
  return data as {
    ok: boolean;
    tenant_id: string;
    preview: {
      mode: string;
      description: string;
      selected_lineup: string[];
      awakened_roles: string[];
      stage_path: string[];
      skipped_nodes: string[];
      reasons: string[];
      estimated_duration_sec: number;
      estimated_duration_band_sec: {
        low: number;
        high: number;
      };
      approval_likely: boolean;
      estimated_artifact_count: number;
      recommended_submit_path: 'sync' | 'async';
      estimated_cost_tier: string;
      edge_target_count: number;
      competitor_handle_count: number;
      industry_tag: string;
    };
  };
}

export async function fetchRunDragonTeamAsyncStatus(jobId: string) {
  const { data } = await api.get<RunDragonTeamAsyncStatus>(`/api/v1/ai/run-dragon-team-async/${encodeURIComponent(jobId)}`);
  return data;
}

export async function fetchArtifactsByJob(jobId: string) {
  const { data } = await api.get(`/api/v1/ai/artifacts/job/${encodeURIComponent(jobId)}`);
  return data as {
    ok: boolean;
    job_id: string;
    mission_id: string;
    pipeline_mode?: string | null;
    pipeline_explain?: Record<string, unknown>;
    status: string;
    artifact_count: number;
    artifact_index: Array<Record<string, unknown>>;
    artifacts: Record<string, ArtifactEnvelope>;
  };
}

export async function fetchArtifactsIndex(limit = 20) {
  const { data } = await api.get('/api/v1/ai/artifacts/index', {
    params: { limit },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    count: number;
    items: Array<Record<string, unknown>>;
  };
}

export async function fetchArtifactsByMission(missionId: string) {
  const { data } = await api.get(`/api/v1/ai/artifacts/mission/${encodeURIComponent(missionId)}`);
  return data as {
    ok: boolean;
    mission_id: string;
    pipeline_mode?: string | null;
    pipeline_explain?: Record<string, unknown>;
    job_count: number;
    jobs: Array<Record<string, unknown>>;
    latest_job_id: string;
    artifact_count: number;
    artifact_index: Array<Record<string, unknown>>;
    artifacts: Record<string, ArtifactEnvelope>;
  };
}

export async function createApprovalGateRequest(payload: {
  trace_id: string;
  request_id: string;
  user_id?: string;
  agent_id: string;
  tool_id: string;
  risk_level?: string;
  action_summary: string;
  approval_channel?: string;
  context?: Record<string, unknown>;
}) {
  const { data } = await api.post('/api/v1/ai/approval-gate/request', payload);
  return data as {
    ok: boolean;
    approval: Record<string, unknown>;
  };
}

export async function fetchApprovalGatePending(input?: { tenant_id?: string; limit?: number }) {
  const { data } = await api.get('/api/v1/ai/approval-gate/pending', {
    params: {
      ...(input?.tenant_id ? { tenant_id: input.tenant_id } : {}),
      ...(input?.limit ? { limit: input.limit } : {}),
    },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    count: number;
    items: Array<Record<string, unknown>>;
  };
}

export async function fetchApprovalGateStatus(approvalId: string) {
  const { data } = await api.get(`/api/v1/ai/approval-gate/${encodeURIComponent(approvalId)}`);
  return data as {
    ok: boolean;
    approval: Record<string, unknown>;
  };
}

export async function decideApprovalGate(payload: {
  approval_id: string;
  decision: 'approved' | 'rejected';
  reason?: string;
}) {
  const { data } = await api.post('/api/v1/ai/approval-gate/decide', payload);
  return data as {
    ok: boolean;
    approval: Record<string, unknown>;
  };
}

export async function analyzeCompetitorFormula(payload: AnalyzeCompetitorPayload) {
  const { data } = await api.post('/api/v1/ai/analyze-competitor-formula', payload);
  return data;
}

export async function fetchIndustryKbTaxonomy() {
  const { data } = await api.get('/api/v1/ai/industry-kb/taxonomy');
  return data as {
    ok: boolean;
    tenant_id: string;
    category_count: number;
    taxonomy: Array<{
      category_tag: string;
      category_name: string;
      sub_industries: Array<{
        tag: string;
        name: string;
        aliases?: string[];
        schema?: {
          industry_name: string;
          pain_points: string[];
          jargon_terms: string[];
          solutions: string[];
          objections: string[];
          banned_absolute: string[];
          banned_industry: string[];
          risk_behaviors: string[];
        };
      }>;
    }>;
  };
}

export async function bootstrapIndustryKbProfiles(payload?: {
  tenant_id?: string;
  force?: boolean;
  selected_industry_tag?: string;
}) {
  const { data } = await api.post('/api/v1/ai/industry-kb/bootstrap', payload ?? {});
  return data as {
    ok: boolean;
    tenant_id: string;
    saved_count: number;
    saved_profiles: Array<Record<string, unknown>>;
  };
}

export async function generateIndustryStarterTasks(payload: {
  tenant_id?: string;
  industry_tag: string;
  force?: boolean;
  max_tasks?: number;
}) {
  const { data } = await api.post('/api/v1/ai/industry-kb/starter-kit/generate', payload);
  return data as {
    ok: boolean;
    tenant_id: string;
    industry_tag: string;
    generated_at: string;
    explorer_summary: Record<string, unknown>;
    accepted_count: number;
    rejected_count: number;
    accepted_tasks: Array<Record<string, unknown>>;
    rejected_tasks: Array<Record<string, unknown>>;
  };
}

export async function fetchIndustryStarterTasks(payload: {
  tenant_id?: string;
  industry_tag: string;
  status?: 'accepted' | 'rejected';
  limit?: number;
}) {
  const { data } = await api.get('/api/v1/ai/industry-kb/starter-kit/tasks', {
    params: {
      ...(payload.tenant_id ? { tenant_id: payload.tenant_id } : {}),
      industry_tag: payload.industry_tag,
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.limit ? { limit: payload.limit } : {}),
    },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    industry_tag: string;
    count: number;
    items: Array<{
      task_key: string;
      status: string;
      task: Record<string, unknown>;
      verifier: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>;
  };
}

export async function getAiSubserviceStatus() {
  const { data } = await api.get('/api/v1/ai/status');
  return data;
}

export async function getAiSubserviceHealth() {
  const { data } = await api.get('/api/v1/ai/health');
  return data as {
    ok: boolean;
    baseUrl: string;
    error?: string;
  };
}

export async function fetchCommercialReadiness() {
  const { data } = await api.get('/api/v1/ai/commercial/readiness');
  return data as {
    ok: boolean;
    tenant_id: string;
    readiness: {
      score: number;
      status: string;
      blocker_count: number;
      blockers: Array<{
        id: string;
        severity: string;
        domain: string;
        title: string;
        detail: string;
        next_action: string;
      }>;
      deploy: Record<string, unknown>;
      payment: Record<string, unknown>;
      notifications: Record<string, unknown>;
      feishu: Record<string, unknown>;
      compliance: Record<string, unknown>;
    };
  };
}

export async function fetchHitlPending(limit = 20) {
  const { data } = await api.get('/api/v1/ai/hitl/pending', {
    params: { limit },
  });
  return data as {
    ok: boolean;
    count: number;
    items: Array<Record<string, unknown>>;
  };
}

export async function decideHitl(payload: {
  approval_id: string;
  decision: 'approved' | 'rejected';
  operator?: string;
  reason?: string;
}) {
  const { data } = await api.post('/api/v1/ai/hitl/decide', payload);
  return data as {
    approval_id: string;
    status: Record<string, unknown>;
  };
}

export type KernelApprovalJournalItem = {
  ts?: string;
  node?: string;
  event_type?: string;
  level?: string;
  decision?: string;
  reason?: string;
  approval_id?: string;
};

export type KernelReportResponse = {
  ok: boolean;
  trace_id: string;
  kernel_report: Record<string, unknown>;
  kernel_report_persisted?: Record<string, unknown>;
  approval_journal?: KernelApprovalJournalItem[];
  trace?: Record<string, unknown>;
  replay?: Record<string, unknown>;
};

export async function fetchAiKernelReport(traceId: string, userId?: string) {
  const { data } = await api.get<KernelReportResponse>(`/api/v1/ai/kernel/report/${encodeURIComponent(traceId)}`, {
    params: userId ? { user_id: userId } : undefined,
  });
  return data;
}

export async function listAiKernelReports(userId?: string, limit = 50) {
  const { data } = await api.get('/api/v1/ai/kernel/reports', {
    params: {
      ...(userId ? { user_id: userId } : {}),
      limit,
    },
  });
  return data as {
    ok: boolean;
    count: number;
    reports: Array<{
      trace_id: string;
      stage?: string;
      updated_at?: string;
      created_at?: string;
      guardian?: string;
      verification?: boolean;
      risk_family?: string;
      autonomy_route?: string;
    }>;
  };
}

export async function rollbackAiKernelReport(
  traceId: string,
  payload?: {
    stage?: 'preflight' | 'postgraph';
    dry_run?: boolean;
    user_id?: string;
    approval_id?: string;
  },
) {
  const { data } = await api.post(`/api/v1/ai/kernel/report/${encodeURIComponent(traceId)}/rollback`, {
    stage: payload?.stage ?? 'preflight',
    dry_run: payload?.dry_run !== false,
    approval_id: payload?.approval_id,
  }, {
    params: payload?.user_id ? { user_id: payload.user_id } : undefined,
  });
  return data as {
    ok: boolean;
    dry_run: boolean;
    pending_approval?: boolean;
    approval_id?: string;
    stage: 'preflight' | 'postgraph';
    rollback_trace_id: string;
    storage?: Record<string, unknown>;
    approval_status?: Record<string, unknown>;
    rollback_report?: Record<string, unknown>;
    replay_payload?: Record<string, unknown>;
    result?: Record<string, unknown>;
  };
}

export async function getAiKernelRolloutPolicy(tenantId?: string) {
  const { data } = await api.get('/api/v1/ai/kernel/rollout/policy', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    policy: Record<string, unknown>;
    window_active: boolean;
  };
}

export async function updateAiKernelRolloutPolicy(payload: {
  tenant_id?: string;
  enabled: boolean;
  rollout_ratio: number;
  block_mode: 'hitl' | 'deny';
  risk_rollout?: Record<string, unknown>;
  window_start_utc?: string;
  window_end_utc?: string;
  note?: string;
}) {
  const { data } = await api.put('/api/v1/ai/kernel/rollout/policy', payload);
  return data as {
    ok: boolean;
    tenant_id: string;
    policy: Record<string, unknown>;
    window_active: boolean;
  };
}

export async function fetchAiKernelMetricsDashboard(payload?: {
  tenant_id?: string;
  from?: string;
  to?: string;
  granularity?: 'hour' | 'day';
}) {
  const { data } = await api.get('/api/v1/ai/kernel/metrics/dashboard', {
    params: payload,
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    query: { from?: string; to?: string; granularity?: 'hour' | 'day' };
    totals: {
      kernel_reports_total: number;
      kernel_applied: number;
      strategy_hit_rate: number;
      rollback_trigger_count: number;
      rollback_success_count: number;
      rollback_success_rate: number;
      auto_pass_count: number;
      auto_block_count: number;
      review_required_count: number;
      approval_required_count: number;
      approval_resolved_count: number;
      average_approval_latency_sec: number;
    };
    byRisk: Record<'P0' | 'P1' | 'P2' | 'P3', number>;
    byRiskFamily: Record<'single_agent' | 'inter_agent' | 'system_emergent', number>;
    byStrategyVersion: Array<{
      strategy_version: string;
      total: number;
      applied: number;
      hit_rate: number;
    }>;
    strategyTrendSeries: Array<{
      bucket_start_utc: string;
      bucket_label: string;
      total: number;
      applied: number;
      hit_rate: number;
      by_strategy: Array<{
        strategy_version: string;
        total: number;
        applied: number;
        hit_rate: number;
      }>;
    }>;
    autonomyTrendSeries: Array<{
      bucket_start_utc: string;
      bucket_label: string;
      auto_pass: number;
      auto_block: number;
      review_required: number;
      approval_required: number;
      approval_resolved: number;
      average_approval_latency_sec: number;
    }>;
  };
}

export async function fetchAiKernelAlerts(payload?: {
  tenant_id?: string;
  from?: string;
  to?: string;
  granularity?: 'hour' | 'day';
}) {
  const { data } = await api.get('/api/v1/ai/kernel/alerts', {
    params: payload,
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    count: number;
    fired_count: number;
    totals: {
      kernel_reports_total: number;
      single_agent_ratio: number;
      inter_agent_ratio: number;
      system_emergent_ratio: number;
      approval_backlog: number;
      approval_latency_sec: number;
    };
    signals: Array<{
      rule_key: string;
      family: 'single_agent' | 'inter_agent' | 'system_emergent';
      severity: 'P1' | 'P2' | 'P3';
      state: 'fired' | 'ok';
      value: number;
      threshold: number;
      message: string;
      recommended_action: string;
    }>;
  };
}

export type AiKernelRolloutTemplate = {
  tenant_id: string;
  template_key: string;
  template_name: string;
  risk_rollout: Record<string, unknown>;
  note?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
};

export async function listAiKernelRolloutTemplates(payload?: { tenant_id?: string; limit?: number }) {
  const { data } = await api.get('/api/v1/ai/kernel/rollout/templates', {
    params: payload,
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    count: number;
    templates: AiKernelRolloutTemplate[];
  };
}

export async function exportAiKernelRolloutTemplates(payload?: { tenant_id?: string; limit?: number }) {
  const { data } = await api.get('/api/v1/ai/kernel/rollout/templates/export', {
    params: payload,
  });
  return data as {
    ok: boolean;
    schema_version: string;
    exported_at: string;
    source_tenant_id: string;
    count: number;
    templates: AiKernelRolloutTemplate[];
  };
}

export async function saveAiKernelRolloutTemplate(payload: {
  tenant_id?: string;
  template_key?: string;
  template_name: string;
  risk_rollout: Record<string, unknown>;
  note?: string;
}) {
  const { data } = await api.post('/api/v1/ai/kernel/rollout/templates', payload);
  return data as {
    ok: boolean;
    tenant_id: string;
    template: AiKernelRolloutTemplate;
    templates: AiKernelRolloutTemplate[];
    storage?: Record<string, unknown>;
  };
}

export async function importAiKernelRolloutTemplates(payload: {
  tenant_id?: string;
  source_tenant_id?: string;
  mode?: 'upsert' | 'skip_existing' | 'replace_all';
  templates: Array<{
    template_key?: string;
    template_name: string;
    risk_rollout?: Record<string, unknown>;
    note?: string;
  }>;
}) {
  const { data } = await api.post('/api/v1/ai/kernel/rollout/templates/import', payload);
  return data as {
    ok: boolean;
    tenant_id: string;
    source_tenant_id?: string;
    mode: 'upsert' | 'skip_existing' | 'replace_all';
    inserted: number;
    updated: number;
    skipped: number;
    count: number;
    templates: AiKernelRolloutTemplate[];
  };
}

export async function renameAiKernelRolloutTemplate(
  templateKey: string,
  payload: {
    tenant_id?: string;
    new_template_key?: string;
    template_name?: string;
    note?: string;
  },
) {
  const { data } = await api.patch(`/api/v1/ai/kernel/rollout/templates/${encodeURIComponent(templateKey)}`, payload);
  return data as {
    ok: boolean;
    tenant_id: string;
    template: AiKernelRolloutTemplate;
    templates: AiKernelRolloutTemplate[];
  };
}

export async function deleteAiKernelRolloutTemplate(templateKey: string, payload?: { tenant_id?: string }) {
  const { data } = await api.delete(`/api/v1/ai/kernel/rollout/templates/${encodeURIComponent(templateKey)}`, {
    params: payload,
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    deleted: boolean;
    template_key: string;
    templates: AiKernelRolloutTemplate[];
  };
}

export async function fetchAiHitlStatus(approvalId: string) {
  const { data } = await api.get(`/api/v1/ai/hitl/status/${encodeURIComponent(approvalId)}`);
  return data as {
    ok: boolean;
    approval_id: string;
    status: {
      decision?: 'pending' | 'approved' | 'rejected';
      reason?: string;
      operator?: string;
      updated_at?: string;
    };
    record?: Record<string, unknown>;
  };
}

export type LlmProviderConfigRow = {
  provider_id: string;
  label?: string;
  enabled: boolean;
  route: 'local' | 'cloud';
  base_url: string;
  default_model: string;
  api_key_masked?: string;
  api_key_configured?: boolean;
  source?: 'env_default' | 'tenant_override';
  updated_at?: string | null;
  updated_by?: string | null;
  note?: string | null;
};

export type LlmAgentBindingRow = {
  agent_id: string;
  enabled: boolean;
  task_type: string;
  provider_id: string;
  model_name: string;
  temperature: number;
  max_tokens: number;
  note?: string;
  updated_by?: string;
  updated_at?: string | null;
  source?: 'default' | 'tenant_override';
};

export async function fetchAiLlmModelCatalog() {
  const { data } = await api.get('/api/v1/ai/llm/model/catalog');
  return data as {
    ok: boolean;
    catalog: {
      agents: string[];
      hot_models?: string[];
      task_type_agent_map: Record<string, string>;
      providers: Array<{
        provider_id: string;
        label?: string;
        route: 'local' | 'cloud';
        base_url: string;
        default_model: string;
        model_options?: string[];
      }>;
    };
  };
}

export async function fetchAiLlmProviderConfigs(tenantId?: string) {
  const { data } = await api.get('/api/v1/ai/llm/providers', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    providers: LlmProviderConfigRow[];
  };
}

export async function updateAiLlmProviderConfig(
  providerId: string,
  payload: {
    tenant_id?: string;
    enabled: boolean;
    route: 'local' | 'cloud';
    base_url: string;
    default_model: string;
    api_key?: string | null;
    note?: string;
  },
) {
  const securePayload = {
    ...payload,
    api_key: payload.api_key ? await encryptSensitiveField(payload.api_key) : payload.api_key,
  };
  const { data } = await api.put(`/api/v1/ai/llm/providers/${encodeURIComponent(providerId)}`, securePayload);
  return data as {
    ok: boolean;
    tenant_id: string;
    provider: LlmProviderConfigRow;
  };
}

export async function fetchAiLlmAgentBindings(tenantId?: string) {
  const { data } = await api.get('/api/v1/ai/llm/agent-bindings', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    bindings: LlmAgentBindingRow[];
  };
}

export async function updateAiLlmAgentBinding(
  agentId: string,
  payload: {
    tenant_id?: string;
    enabled: boolean;
    task_type: string;
    provider_id: string;
    model_name: string;
    temperature: number;
    max_tokens: number;
    note?: string;
  },
) {
  const { data } = await api.put(`/api/v1/ai/llm/agent-bindings/${encodeURIComponent(agentId)}`, payload);
  return data as {
    ok: boolean;
    tenant_id: string;
    binding: LlmAgentBindingRow;
  };
}

export type AgentExtensionSkill = {
  skill_id: string;
  name: string;
  capability: string;
  node_id: string;
  publish_status?: 'draft' | 'review' | 'approved' | 'deprecated' | string;
  required?: boolean;
  enabled?: boolean;
  runtime?: string;
  entrypoint?: string;
  description?: string;
  config?: Record<string, unknown>;
};

export type AgentExtensionNode = {
  node_id: string;
  type: string;
  title: string;
  enabled?: boolean;
  timeout_sec?: number;
  retry_limit?: number;
  config?: Record<string, unknown>;
};

export type AgentIdentityCard = {
  display_name?: string;
  codename?: string;
  gender?: string;
  age?: number;
  seat_title?: string;
  top_persona?: string;
  experience_years?: number;
  experience_summary?: string;
  personality?: string;
  decision_style?: string;
  blind_spots?: string;
  specialties?: string[];
  skills?: string[];
  knowledge_domains?: string[];
  kpis?: string[];
  handoff_to?: string[];
  forbidden_actions?: string[];
};

export type AgentCollaborationContract = {
  mission_scope?: string;
  decision_scope?: string[];
  command_authority?: string;
  upstream_dependencies?: string[];
  downstream_handoffs?: string[];
  must_sync_with?: string[];
  escalation_conditions?: string[];
  forbidden_actions?: string[];
  deliverables?: string[];
  coordination_rules?: string[];
};

export type AgentRunContract = {
  role_id?: string;
  activation_when?: string[];
  input_contract?: {
    required?: string[];
    optional?: string[];
    reject_if_missing?: string[];
  };
  output_contract?: {
    artifact_type?: string;
    required_fields?: string[];
  };
  memory_read_scope?: string[];
  memory_write_scope?: string[];
  cost_budget?: {
    max_model_tier?: string;
    max_tool_calls?: number;
  };
  latency_budget?: {
    soft_limit_sec?: number;
    hard_limit_sec?: number;
  };
  escalate_when?: string[];
  approval_needed_for?: string[];
  forbidden_actions?: string[];
};

export type AgentExtensionProfile = {
  agent_id: string;
  enabled: boolean;
  profile_version: string;
  runtime_mode: 'local' | 'cloud' | 'hybrid';
  role_prompt?: string;
  identity_card?: AgentIdentityCard;
  collaboration_contract?: AgentCollaborationContract;
  run_contract?: AgentRunContract;
  skills: AgentExtensionSkill[];
  nodes: AgentExtensionNode[];
  hooks?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  tags?: string[];
  source?: 'default' | 'tenant_override';
  updated_at?: string | null;
  updated_by?: string | null;
};

export async function fetchAiAgentExtensions(tenantId?: string) {
  const { data } = await api.get('/api/v1/ai/agent/extensions', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    profiles: AgentExtensionProfile[];
    catalog: {
      agent_ids: string[];
      capabilities: string[];
      default_profiles: AgentExtensionProfile[];
      schema_version: string;
    };
  };
}

export async function fetchAiAgentExtensionProfile(agentId: string, tenantId?: string) {
  const { data } = await api.get(`/api/v1/ai/agent/extensions/${encodeURIComponent(agentId)}`, {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    profile: AgentExtensionProfile;
  };
}

export async function updateAiAgentExtensionProfile(
  agentId: string,
  payload: {
    tenant_id?: string;
    enabled: boolean;
    profile_version: string;
    runtime_mode: 'local' | 'cloud' | 'hybrid';
    role_prompt?: string;
    identity_card?: AgentIdentityCard;
    collaboration_contract?: AgentCollaborationContract;
    run_contract?: AgentRunContract;
    skills?: AgentExtensionSkill[];
    nodes?: AgentExtensionNode[];
    hooks?: Record<string, unknown>;
    limits?: Record<string, unknown>;
    tags?: string[];
  },
) {
  const { data } = await api.put(`/api/v1/ai/agent/extensions/${encodeURIComponent(agentId)}`, payload);
  return data as {
    ok: boolean;
    tenant_id: string;
    profile: AgentExtensionProfile;
  };
}

export async function fetchAiSkillsPoolOverview(tenantId?: string) {
  const { data } = await api.get('/api/v1/ai/skills-pool/overview', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    overview: {
      summary: {
        agents_total: number;
        agents_enabled: number;
        skills_total: number;
        nodes_total: number;
        kb_profiles_total: number;
        rag_packs_total: number;
        workflow_templates_total: number;
      };
      profiles: Array<{
        agent_id: string;
        enabled: boolean;
        profile_version: string;
        runtime_mode: string;
        skills_count: number;
        nodes_count: number;
        updated_at?: string | null;
      }>;
      agent_profiles: AgentExtensionProfile[];
      catalog: {
        agent_ids: string[];
        capabilities: string[];
        default_profiles: AgentExtensionProfile[];
        schema_version: string;
      };
      llm_bindings: LlmAgentBindingRow[];
      llm_providers: LlmProviderConfigRow[];
      industry_kb_profiles: Array<Record<string, unknown>>;
      industry_kb_stats: Array<Record<string, unknown>>;
      industry_kb_metrics: Record<string, unknown>;
      agent_rag_pack_summary: Array<{
        agent_id: string;
        pack_count: number;
        last_updated?: string | null;
      }>;
      workflow_templates: Array<Record<string, unknown>>;
      workflow_templates_by_industry: Record<string, number>;
    };
  };
}

export type AgentRagPackItem = {
  tenant_id: string;
  profile: string;
  agent_id: string;
  knowledge_pack_id: string;
  knowledge_pack_name: string;
  payload: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  pack_id?: string;
  title?: string;
  scope?: string;
  payload_json?: Record<string, unknown>;
};

export async function fetchAiAgentRagCatalog(tenantId?: string) {
  const { data } = await api.get('/api/v1/ai/agent-rag/catalog', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as {
    ok: boolean;
    catalog: {
      profile: string;
      target_count: number;
      agents: Array<{ agent_id: string; target_count: number }>;
      targets: Array<Record<string, unknown>>;
    };
  };
}

export async function fetchAiAgentRagPacks(tenantId?: string, profile = 'feedback') {
  const { data } = await api.get('/api/v1/ai/agent-rag/packs', {
    params: {
      ...(tenantId ? { tenant_id: tenantId } : {}),
      profile,
    },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    count: number;
    summary: Array<{ agent_id: string; pack_count: number; last_updated?: string | null }>;
    items: AgentRagPackItem[];
  };
}

export async function fetchSkillEffectiveness(skillId: string, tenantId?: string) {
  const { data } = await api.get(`/api/v1/ai/skills/${encodeURIComponent(skillId)}/effectiveness`, {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as SkillEffectivenessResponse;
}

export async function approveSkill(skillId: string) {
  const { data } = await api.patch(`/api/v1/skills/${encodeURIComponent(skillId)}/status`, {
    status: 'approved',
  });
  return data as {
    ok: boolean;
    skill: Record<string, unknown>;
  };
}

export async function fetchExecutionMonitorSnapshot(tenantId?: string) {
  const { data } = await api.get('/api/v1/ai/execution-monitor/snapshot', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data as ExecutionMonitorSnapshot;
}

function normalizeLobsterToolSummary(raw: Record<string, unknown>): LobsterToolSummary {
  return {
    toolId: String(raw.tool_id ?? raw.toolId ?? raw.name ?? ''),
    name: raw.name ? String(raw.name) : String(raw.tool_id ?? raw.toolId ?? ''),
    enabled: typeof raw.selected === 'boolean' ? raw.selected : (typeof raw.enabled === 'boolean' ? raw.enabled : undefined),
    description: raw.description ? String(raw.description) : undefined,
    category: raw.category ? String(raw.category) : undefined,
    lastUpdatedAt: raw.updated_at ? String(raw.updated_at) : undefined,
  };
}

function normalizeLobsterSkillSummary(raw: Record<string, unknown>): LobsterSkillSummary {
  return {
    skillId: String(raw.id ?? raw.skill_id ?? raw.skillId ?? ''),
    name: raw.name ? String(raw.name) : String(raw.id ?? raw.skill_id ?? raw.skillId ?? ''),
    capability: raw.description ? String(raw.description) : (raw.category ? String(raw.category) : undefined),
    status: typeof raw.selected === 'boolean' ? (raw.selected ? 'active' : 'inactive') : undefined,
    lastUpdatedAt: raw.updated_at ? String(raw.updated_at) : undefined,
  };
}

function normalizeLobsterConfigSummary(raw: Record<string, unknown>): LobsterConfigSummary {
  return {
    lobsterId: String(raw.lobster_id ?? raw.lobsterId ?? ''),
    name: raw.zh_name ? String(raw.zh_name) : undefined,
    displayName: raw.display_name ? String(raw.display_name) : (raw.displayName ? String(raw.displayName) : undefined),
    lifecycle: raw.lifecycle ? String(raw.lifecycle) : undefined,
    status: raw.status ? String(raw.status) : undefined,
    strategyLevel: raw.strategy_level !== undefined && raw.strategy_level !== null ? String(raw.strategy_level) : undefined,
    autonomyLevel: raw.autonomy_level !== undefined && raw.autonomy_level !== null ? String(raw.autonomy_level) : undefined,
    customPrompt: raw.custom_prompt ? String(raw.custom_prompt) : undefined,
    toolsCount: typeof raw.tool_count === 'number' ? raw.tool_count : (typeof raw.toolsCount === 'number' ? raw.toolsCount : undefined),
    skillsCount: typeof raw.skill_count === 'number' ? raw.skill_count : (typeof raw.skillsCount === 'number' ? raw.skillsCount : undefined),
    lastUpdatedAt: raw.updated_at ? String(raw.updated_at) : undefined,
  };
}

function normalizeLobsterConfigDetailResponse(raw: Record<string, unknown>): LobsterConfigDetail {
  const payload = (raw.config && typeof raw.config === 'object' ? raw.config : raw) as Record<string, unknown>;
  const roleCard = (payload.role_card && typeof payload.role_card === 'object' ? payload.role_card : {}) as Record<string, unknown>;
  const status = (payload.status && typeof payload.status === 'object' ? payload.status : {}) as Record<string, unknown>;
  const strategy = (payload.strategy && typeof payload.strategy === 'object' ? payload.strategy : {}) as Record<string, unknown>;
  const autonomy = (payload.autonomy && typeof payload.autonomy === 'object' ? payload.autonomy : {}) as Record<string, unknown>;
  const runtimeOverrides = (payload.runtime_overrides && typeof payload.runtime_overrides === 'object' ? payload.runtime_overrides : {}) as Record<string, unknown>;
  const tools = (payload.tools && typeof payload.tools === 'object' ? payload.tools : {}) as Record<string, unknown>;
  const skills = (payload.skills && typeof payload.skills === 'object' ? payload.skills : {}) as Record<string, unknown>;
  const toolItems = Array.isArray(tools.items) ? tools.items.map((item) => normalizeLobsterToolSummary((item ?? {}) as Record<string, unknown>)) : [];
  const skillItems = Array.isArray(skills.items) ? skills.items.map((item) => normalizeLobsterSkillSummary((item ?? {}) as Record<string, unknown>)) : [];
  return {
    lobsterId: String(payload.lobster_id ?? payload.lobsterId ?? ''),
    name: roleCard.zh_name ? String(roleCard.zh_name) : undefined,
    displayName: roleCard.display_name ? String(roleCard.display_name) : (roleCard.displayName ? String(roleCard.displayName) : undefined),
    lifecycle: status.lifecycle ? String(status.lifecycle) : undefined,
    status: status.runtime_status ? String(status.runtime_status) : undefined,
    strategyLevel: strategy.lobster_level_hint !== undefined && strategy.lobster_level_hint !== null ? String(strategy.lobster_level_hint) : (strategy.tenant_current_level !== undefined && strategy.tenant_current_level !== null ? String(strategy.tenant_current_level) : undefined),
    autonomyLevel: autonomy.effective_level !== undefined && autonomy.effective_level !== null ? String(autonomy.effective_level) : undefined,
    customPrompt: runtimeOverrides.custom_prompt ? String(runtimeOverrides.custom_prompt) : undefined,
    description: roleCard.mission ? String(roleCard.mission) : undefined,
    strategyPolicy: strategy.tenant_label ? String(strategy.tenant_label) : undefined,
    autonomyPolicy: autonomy.effective_label ? String(autonomy.effective_label) : undefined,
    defaultTools: toolItems,
    defaultSkills: skillItems,
    tools: toolItems,
    skills: skillItems,
    lastUpdatedAt: status.last_heartbeat ? String(status.last_heartbeat) : undefined,
    extra: payload,
  };
}

function normalizeWidgetConfigResponse(raw: Record<string, unknown>): WidgetConfig {
  const payload = (raw.config && typeof raw.config === 'object' ? raw.config : raw) as Record<string, unknown>;
  return {
    widgetId: String(payload.widget_id ?? payload.widgetId ?? ''),
    tenantId: String(payload.tenant_id ?? payload.tenantId ?? ''),
    allowedDomains: Array.isArray(payload.allowed_origins) ? payload.allowed_origins.map((item) => String(item)) : [],
    welcomeMessage: payload.welcome_message ? String(payload.welcome_message) : undefined,
    themeColor: payload.theme_primary ? String(payload.theme_primary) : undefined,
    accentColor: payload.accent_color ? String(payload.accent_color) : undefined,
    customCss: payload.custom_css ? String(payload.custom_css) : undefined,
    callToAction: payload.call_to_action ? String(payload.call_to_action) : (payload.launcher_label ? String(payload.launcher_label) : undefined),
    launcherLabel: payload.launcher_label ? String(payload.launcher_label) : undefined,
    autoOpen: Boolean(payload.auto_open),
    launcherPosition:
      payload.launcher_position === 'top-right' || payload.launcher_position === 'bottom-right'
        ? (payload.launcher_position as 'top-right' | 'bottom-right')
        : undefined,
    updatedAt: payload.updated_at ? String(payload.updated_at) : undefined,
  };
}

export async function fetchLobsterConfigs(tenantId?: string) {
  const { data } = await api.get('/api/v1/lobster-config', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return {
    ok: Boolean(data?.ok),
    total: Array.isArray(data?.items) ? data.items.length : 0,
    lobsters: Array.isArray(data?.items)
      ? data.items.map((item: Record<string, unknown>) => normalizeLobsterConfigSummary(item))
      : [],
  };
}

export async function fetchLobsterConfigDetail(lobsterId: string, tenantId?: string) {
  const { data } = await api.get(`/api/v1/lobster-config/${encodeURIComponent(lobsterId)}`, {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return {
    ok: Boolean(data?.ok),
    config: normalizeLobsterConfigDetailResponse((data ?? {}) as Record<string, unknown>),
  };
}

export async function updateLobsterConfig(lobsterId: string, payload: LobsterConfigUpdatePayload) {
  const { data } = await api.patch(`/api/v1/lobster-config/${encodeURIComponent(lobsterId)}`, payload);
  return {
    ok: Boolean(data?.ok),
    config: normalizeLobsterConfigDetailResponse((data ?? {}) as Record<string, unknown>),
  };
}

export async function fetchWidgetConfig(tenantId: string) {
  const { data } = await api.get('/api/v1/widget/config', {
    params: { tenant_id: tenantId },
  });
  return {
    ok: Boolean(data?.ok),
    config: normalizeWidgetConfigResponse((data ?? {}) as Record<string, unknown>),
  };
}

export async function updateWidgetConfig(payload: WidgetConfigPayload) {
  const { data } = await api.put('/api/v1/widget/config', payload);
  return {
    ok: Boolean(data?.ok),
    config: normalizeWidgetConfigResponse((data ?? {}) as Record<string, unknown>),
  };
}

export async function fetchWidgetScript(widgetId: string) {
  const { data } = await api.get(`/api/v1/widget/script/${encodeURIComponent(widgetId)}`);
  return data as {
    ok: boolean;
    script: WidgetScript;
  };
}

export async function fetchLobsterQualityStats(lobsterId: string, days = 30) {
  const { data } = await api.get(`/api/v1/lobsters/${encodeURIComponent(lobsterId)}/quality-stats`, {
    params: { days },
  });
  return data as { ok: boolean; stats: LobsterQualityStats };
}

export async function submitLobsterFeedback(payload: LobsterFeedbackSubmitPayload) {
  const { data } = await api.post('/api/v1/feedbacks', payload);
  return data as { ok: boolean; feedback_id: string; status: string };
}

export async function fetchTaskFeedback(taskId: string) {
  const { data } = await api.get(`/api/v1/feedbacks/${encodeURIComponent(taskId)}`);
  return data as { ok: boolean; task_id: string; items: LobsterFeedbackItem[]; count: number };
}

export async function fetchLeadConversionStatus(tenantId: string, leadId: string) {
  const { data } = await api.get(`/api/v1/leads/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}/conversion-status`);
  return data as {
    status: string;
    data: LeadConversionStatus;
  };
}

export async function fetchLeadConversionHistory(tenantId: string, leadId: string, limit = 20) {
  const { data } = await api.get(`/api/v1/leads/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}/conversion-history`, {
    params: { limit },
  });
  return data as {
    status: string;
    data: LeadConversionHistoryItem[];
  };
}

export async function fetchActivities(input?: { limit?: number; offset?: number; type?: string }) {
  const { data } = await api.get('/api/v1/activities', { params: input });
  return data as {
    ok: boolean;
    total: number;
    items: ActivityStreamItem[];
  };
}

export async function fetchActivity(activityId: string) {
  const { data } = await api.get(`/api/v1/activities/${encodeURIComponent(activityId)}`);
  return data as {
    ok: boolean;
    activity: ActivityStreamItem;
  };
}

export async function fetchKnowledgeBases() {
  const { data } = await api.get('/api/v1/knowledge-bases');
  return data as { ok: boolean; items: KnowledgeBaseSummary[]; count: number };
}

export async function createKnowledgeBase(payload: { name: string }) {
  const { data } = await api.post('/api/v1/knowledge-bases', payload);
  return data as { ok: boolean; kb: KnowledgeBaseDetail };
}

export async function fetchKnowledgeBaseDetail(kbId: string) {
  const { data } = await api.get(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}`);
  return data as { ok: boolean; kb: KnowledgeBaseDetail };
}

export async function uploadKnowledgeBaseDocument(payload: { kb_id: string; filename: string; text: string }) {
  const { data } = await api.post(`/api/v1/knowledge-bases/${encodeURIComponent(payload.kb_id)}/documents`, {
    filename: payload.filename,
    text: payload.text,
  });
  return data as { ok: boolean; doc_id: string; filename: string; chunk_count: number };
}

export async function bindKnowledgeBase(payload: { kb_id: string; lobster_id: string }) {
  const { data } = await api.post(`/api/v1/knowledge-bases/${encodeURIComponent(payload.kb_id)}/bind/${encodeURIComponent(payload.lobster_id)}`);
  return data as { ok: boolean; kb_id: string; lobster_id: string };
}

export async function searchKnowledgeBase(kbId: string, query: string, topK = 5) {
  const { data } = await api.get(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/search`, {
    params: { q: query, top_k: topK },
  });
  return data as { ok: boolean; kb_id: string; items: KnowledgeBaseSearchHit[]; count: number };
}

export type ExecutionMonitorSnapshotResponse = ExecutionMonitorSnapshot;
export type ExecutionMonitorEvent = ExecutionLogEvent;
export type ExecutionMonitorNodeRow = ExecutionMonitorNode;
export type StrategyIntensityContract = StrategyIntensityState;
