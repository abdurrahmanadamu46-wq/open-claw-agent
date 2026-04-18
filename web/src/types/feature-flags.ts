export type StrategyType = 'all' | 'gradualRollout' | 'tenantWhitelist' | 'lobsterWhitelist' | 'edgeNodeTag';
export type Environment = 'dev' | 'staging' | 'prod';

export interface FlagStrategy {
  type: StrategyType;
  parameters: Record<string, unknown>;
}

export interface FlagVariant {
  name: string;
  weight: number;
  payload?: unknown;
  enabled: boolean;
}

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  environment: Environment;
  strategies: FlagStrategy[];
  variants: FlagVariant[];
  description?: string;
  tags: string[];
  tenant_id?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_builtin?: boolean;
}

export interface FlagCheckResult {
  flag_name: string;
  enabled: boolean;
  variant?: { name: string; enabled: boolean; payload?: unknown };
  matched_strategy?: FlagStrategy | null;
}

export interface FeatureFlagChangelogItem {
  id?: string;
  name?: string;
  change_type?: string;
  environment?: Environment | string;
  changed_at?: string;
}
