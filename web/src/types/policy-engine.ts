export interface PolicyCondition {
  field: string;
  op: string;
  value?: unknown;
}

export interface PolicyRule {
  rule_id: string;
  policy_path: string;
  name: string;
  description: string;
  conditions: PolicyCondition[];
  condition_logic: 'AND' | 'OR' | string;
  effect: 'allow' | 'deny' | 'dispatch' | string;
  target?: string | null;
  priority: number;
  tenant_id: string;
  enabled: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface PolicyBundle {
  bundle_id: string;
  tenant_id: string;
  version: string;
  checksum: string;
  rule_count: number;
  rules: PolicyRule[];
  published_by: string;
  notes: string;
  created_at: string;
}

export interface PolicyDecisionMatch {
  rule_id: string;
  name: string;
  effect: string;
  target?: string | null;
  priority: number;
}

export interface PolicyDecisionTraceEvent {
  event: string;
  rule_id?: string;
  policy_path?: string;
  priority?: number;
  field?: string;
  op?: string;
  expected?: unknown;
  actual?: unknown;
  matched?: boolean;
}

export interface PolicyDecision {
  decision: string;
  rule_id?: string | null;
  reason: string;
  matched_rules: PolicyDecisionMatch[];
  evaluation_ms: number;
  policy_path: string;
  tenant_id: string;
  evaluated_rule_count: number;
  default_decision: string;
  bundle_version?: string;
  bundle_checksum?: string;
  trace?: PolicyDecisionTraceEvent[];
}

export interface PolicyRulePayload {
  rule_id?: string;
  tenant_id?: string;
  policy_path: string;
  name: string;
  description?: string;
  conditions: PolicyCondition[];
  condition_logic?: 'AND' | 'OR';
  effect: 'allow' | 'deny' | 'dispatch';
  target?: string | null;
  priority?: number;
  enabled?: boolean;
  tags?: string[];
}

export interface PolicyEvaluatePayload {
  policy_path: string;
  input: Record<string, unknown>;
  tenant_id?: string;
  lobster_id?: string;
  task_id?: string;
  default_decision?: string;
  trace?: boolean;
}

export interface PolicyBundlePublishPayload {
  tenant_id?: string;
  version?: string;
  notes?: string;
  policy_paths?: string[];
  force?: boolean;
}
