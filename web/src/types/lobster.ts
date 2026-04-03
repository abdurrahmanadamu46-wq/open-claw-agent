export type Lifecycle = 'experimental' | 'production' | 'deprecated';
export type LobsterStatus = 'active' | 'idle' | 'training' | 'offline' | 'error' | 'healthy' | 'degraded' | 'critical';

export interface LobsterSkill {
  id: string;
  name: string;
  category?: string;
  effectiveness_rating?: number;
  enabled?: boolean;
  gotchas?: string[];
}

export interface LobsterRun {
  id?: string;
  run_id?: string;
  created_at: string;
  model_used?: string;
  tier?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  estimated_cost_cny?: number;
  cost_cny?: number;
  duration_ms?: number;
  status: string;
  score?: number;
  error?: string | null;
}

export interface LobsterEntity {
  id: string;
  name: string;
  display_name: string;
  zh_name?: string;
  description: string;
  lifecycle: Lifecycle;
  status: LobsterStatus;
  system: string;
  skill_count: number;
  weekly_runs: number;
  avg_quality_score: number;
  p95_latency_ms: number;
  active_edge_nodes: number;
  tags: string[];
  annotations: Record<string, string>;
  skills: LobsterSkill[];
  recent_runs: LobsterRun[];
  icon?: string;
  role?: string;
  default_model_tier?: string;
  active_experiment?: {
    flag_name: string;
    rollout: number;
  };
}

export interface LifecycleChangeRequest {
  new_lifecycle: Lifecycle;
  reason?: string;
}

export interface LifecycleChangeEvent {
  entity_type: 'lobster' | 'workflow' | 'channel';
  entity_id: string;
  entity_name: string;
  old_lifecycle: string;
  new_lifecycle: string;
  changed_by: string;
  reason?: string;
  changed_at: string;
}
