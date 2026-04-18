export interface TraceScore {
  score_id?: string;
  name: string;
  value?: number | null;
  string_value?: string | null;
  scorer?: string;
  comment?: string;
}

export interface DispatcherOrlaStageEvent {
  stage_id: string;
  applied_tier: string;
  reason: string;
  promotion_trigger?: string;
  shared_state_hit?: boolean;
  created_at?: string;
}

export interface DispatcherOrlaTraceDetails {
  events: Array<Record<string, unknown>>;
  event_count: number;
  latest?: Record<string, unknown> | null;
  stages: DispatcherOrlaStageEvent[];
}

export interface TraceGeneration {
  gen_id: string;
  model: string;
  provider?: string;
  input_text?: string;
  output_text?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  latency_ms?: number;
  status?: string;
  cost_usd?: number;
  scores?: TraceScore[];
  created_at?: string;
}

export interface TraceSpan {
  span_id: string;
  lobster?: string;
  skill?: string;
  step_index?: number;
  started_at?: string;
  ended_at?: string;
  latency_ms?: number;
  status?: string;
  meta?: Record<string, unknown> | string;
  generations?: TraceGeneration[];
}

export interface WorkflowTrace {
  trace_id: string;
  workflow_run_id?: string;
  tenant_id?: string;
  workflow_name?: string;
  status?: string;
  started_at?: string;
  ended_at?: string;
  total_cost_usd?: number;
  total_tokens?: number;
  gen_count?: number;
  spans?: TraceSpan[];
  activities?: Array<Record<string, unknown>>;
  dispatcher_orla?: DispatcherOrlaTraceDetails;
}

export interface ObservabilityOrlaSummary {
  tenant_id: string;
  days: number;
  dispatcher_total: number;
  orla_enabled_total: number;
  success_count: number;
  shared_state_hit_rate: number;
  by_stage: Record<string, number>;
  by_tier: Record<string, number>;
  promotion_triggers: Record<string, number>;
  latest?: Record<string, unknown> | null;
}

export interface ObservabilityDashboard {
  tenant_id: string;
  days: number;
  total_cost_usd: number;
  total_tokens: number;
  total_calls: number;
  avg_latency_ms: number;
  by_model: Array<Record<string, unknown>>;
  by_lobster: Array<Record<string, unknown>>;
  daily_trend: Array<Record<string, unknown>>;
  orla_dispatcher?: ObservabilityOrlaSummary;
}
