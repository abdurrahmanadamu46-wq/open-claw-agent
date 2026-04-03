export interface StrategyIntensityResourceLimits {
  max_daily_posts?: number;
  max_daily_replies?: number;
  max_daily_dms?: number;
  max_llm_calls_per_task?: number;
  allowed_channels?: string[];
}

export interface StrategyIntensityLevel {
  level: number;
  name: string;
  label: string;
  description: string;
  autonomy: 'auto' | 'notify' | 'approval' | 'approve' | 'dual_approval' | 'dual_confirm' | string;
  resource_limits: StrategyIntensityResourceLimits;
  risk_threshold: number;
  escalation_trigger: string;
  approval_required?: boolean;
  rollback_policy?: string;
  applicable_scenarios?: string[];
  typical_lobsters?: string[];
}

export interface IntensityChangeRecord {
  id?: string;
  tenant_id?: string;
  current_level?: number;
  previous_level?: number;
  next_level?: number;
  updated_at?: string;
  changed_at?: string;
  updated_by?: string;
  changed_by?: string;
  reason?: string;
}

export interface StrategyIntensityState extends StrategyIntensityLevel {
  ok?: boolean;
  current_level: number;
  tenant_id: string;
  usage_today?: {
    posts?: number;
    replies?: number;
    dms?: number;
    llm_calls?: number;
  };
  usage_date?: string;
  updated_at: string;
  updated_by: string;
  history: IntensityChangeRecord[];
}
