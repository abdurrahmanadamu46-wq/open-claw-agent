export type AutonomyLevel = 0 | 1 | 2 | 3;
export type AutonomyLevelCode = 'L0_OBSERVE' | 'L1_SUGGEST' | 'L2_EXECUTE' | 'L3_AUTONOMOUS';

export interface AutonomyLevelDefinition {
  code: AutonomyLevelCode;
  level: AutonomyLevel;
  label: string;
  description: string;
  approval_behavior: string;
  audit_level: 'standard' | 'full_audit' | string;
}

export interface AutonomyChangeRecord {
  tenant_id?: string;
  target?: string;
  level?: AutonomyLevel;
  previous_level?: AutonomyLevel;
  next_level?: AutonomyLevel;
  updated_at?: string;
  changed_at?: string;
  updated_by?: string;
  changed_by?: string;
  reason?: string;
}

export interface LobsterAutonomyOverride {
  lobster_id: string;
  level: AutonomyLevelCode | AutonomyLevel;
  reason?: string;
}

export interface AutonomyPolicyState {
  ok?: boolean;
  tenant_id: string;
  default_level: AutonomyLevelCode | AutonomyLevel;
  audit_level?: 'standard' | 'full_audit' | string;
  updated_at?: string;
  updated_by?: string;
  definitions?: AutonomyLevelDefinition[];
  per_lobster_overrides: Record<string, AutonomyLevel> | LobsterAutonomyOverride[];
  history?: AutonomyChangeRecord[];
}

export interface UpdateAutonomyPolicyPayload {
  tenant_id?: string;
  default_level?: AutonomyLevelCode | AutonomyLevel;
  per_lobster_overrides?: LobsterAutonomyOverride[] | Record<string, AutonomyLevel>;
  reason?: string;
}
