export interface TraceScore {
  score_id?: string;
  name: string;
  value?: number | null;
  string_value?: string | null;
  scorer?: string;
  comment?: string;
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
  workflow_name?: string;
  status?: string;
  started_at?: string;
  ended_at?: string;
  total_cost_usd?: number;
  total_tokens?: number;
  gen_count?: number;
  spans?: TraceSpan[];
}
