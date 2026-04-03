export interface PromptExperiment {
  flag_name: string;
  lobster_name: string;
  skill_name: string;
  environment: string;
  status: 'running' | 'stopped' | 'promoted';
  started_at: string;
  updated_at: string;
  variants: Array<{
    name: string;
    weight: number;
    payload?: unknown;
    enabled: boolean;
  }>;
}

export interface ExperimentVariant {
  name: string;
  weight: number;
  count: number;
  avg_quality_score: number;
  avg_latency_ms: number;
  is_winner: boolean;
}

export interface ExperimentReport {
  flag_name: string;
  period: { from?: string | null; to?: string | null };
  variants: Record<string, ExperimentVariant>;
  winner?: string | null;
  confidence?: number;
}
