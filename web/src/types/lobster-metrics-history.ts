export interface LobsterMetricsHistoryPoint {
  date: string;
  task_count: number;
  success_count: number;
  avg_latency_ms: number;
  cost_usd: number;
  error_rate: number;
}
