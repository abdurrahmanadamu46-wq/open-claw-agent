export type LobsterCostTrendDirection = 'up' | 'down' | 'flat' | string;

export interface LobsterCostSummaryRow {
  lobster_id: string;
  tenant_id: string;
  range: string;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  call_count: number;
  avg_cost_per_call: number;
  max_cost_call_id?: string | null;
  max_cost_usd: number;
  trend_pct: number;
  trend_direction: LobsterCostTrendDirection;
}

export interface LobsterBudgetUsage {
  tenant_id: string;
  range: string;
  total_cost_usd: number;
  lobster_count: number;
  top_lobster?: string | null;
}

export interface LobsterCostTopCall {
  call_id: string;
  lobster_id: string;
  tenant_id: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  route_tier?: string | null;
  latency_ms: number;
  created_at: string;
  status: string;
}

export interface LobsterCostTimeseriesPoint {
  timestamp: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  call_count: number;
}
