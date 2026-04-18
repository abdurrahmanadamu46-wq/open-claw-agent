export type SkillImprovementStatus = 'draft' | 'scanned' | 'review' | 'approved' | 'rejected' | 'applied' | 'rolled_back' | string;

export interface SkillImprovementEvidenceRef {
  source_type: string;
  source_id: string;
  summary: string;
  confidence?: number;
}

export interface SkillImprovementPatchDraft {
  target_file: string;
  patch_type: string;
  before: unknown;
  after: unknown;
  summary: string;
}

export interface SkillImprovementProposal {
  proposal_id: string;
  tenant_id: string;
  lobster_id: string;
  skill_id: string;
  trigger_type: string;
  status: SkillImprovementStatus;
  evidence_refs: SkillImprovementEvidenceRef[];
  patches: SkillImprovementPatchDraft[];
  scan_status: string;
  scan_report: {
    risk_level?: string;
    issues?: string[];
    confidence?: number;
  };
  created_at: string;
  updated_at: string;
  decided_by?: string;
  decision_reason?: string;
}

export interface SkillImprovementListResponse {
  ok: boolean;
  tenant_id: string;
  count: number;
  items: SkillImprovementProposal[];
}

export interface SkillImprovementMutationResponse {
  ok: boolean;
  proposal: SkillImprovementProposal;
  manifest?: Record<string, unknown>;
}

export interface SkillImprovementCreatePayload {
  tenant_id?: string;
  lobster_id: string;
  skill_id: string;
  trigger_type: string;
  evidence_refs?: SkillImprovementEvidenceRef[];
}

export interface SkillImprovementTriggerPayload {
  tenant_id?: string;
  lobster_id: string;
  skill_id: string;
  signal_type: string;
  source_id: string;
  summary?: string;
  confidence?: number;
  auto_scan?: boolean;
}

export interface SkillImprovementTriggerResponse {
  ok: boolean;
  created: boolean;
  reason: string;
  threshold: number;
  proposal?: SkillImprovementProposal | null;
}

export interface SkillImprovementSignalEvent {
  event_id: string;
  tenant_id: string;
  lobster_id: string;
  skill_id: string;
  signal_type: string;
  source_id: string;
  summary: string;
  confidence: number;
  created: boolean;
  reason: string;
  proposal_id: string;
  created_at: string;
}

export interface SkillImprovementSignalListResponse {
  ok: boolean;
  tenant_id: string;
  count: number;
  items: SkillImprovementSignalEvent[];
}

export interface SkillImprovementEffectEvent {
  event_id: string;
  proposal_id: string;
  tenant_id: string;
  lobster_id: string;
  skill_id: string;
  event_type: string;
  source_type: string;
  source_id: string;
  metric_name: string;
  metric_value?: number | null;
  baseline_value?: number | null;
  delta?: number | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SkillImprovementEffectSummary {
  tenant_id: string;
  proposal_id: string;
  event_count: number;
  observation_count: number;
  avg_delta?: number | null;
  positive_observations: number;
  negative_observations: number;
  latest_event?: SkillImprovementEffectEvent | null;
  recommendation?: {
    action: 'continue_observing' | 'keep_applied' | 'recommend_rollback' | string;
    priority: 'low' | 'normal' | 'high' | string;
    reason: string;
    can_auto_rollback: boolean;
    observation_floor: number;
  };
}

export interface SkillImprovementEffectListResponse {
  ok: boolean;
  tenant_id: string;
  proposal_id: string;
  count: number;
  items: SkillImprovementEffectEvent[];
  summary: SkillImprovementEffectSummary;
}

export interface SkillImprovementCommercialOverview {
  ok: boolean;
  tenant_id: string;
  summary: {
    proposal_total: number;
    signal_total: number;
    effect_event_total: number;
    pending_review: number;
    ready_to_apply: number;
    applied: number;
    rolled_back: number;
    recommend_rollback: number;
    readiness_status: string;
  };
  proposal_status_counts: Record<string, number>;
  scan_status_counts: Record<string, number>;
  signal_reason_counts: Record<string, number>;
  recommendation_counts: Record<string, number>;
  global_effect_summary: SkillImprovementEffectSummary;
  proposal_effect_summaries: Array<{
    proposal_id: string;
    skill_id: string;
    lobster_id: string;
    status: string;
    summary: SkillImprovementEffectSummary;
  }>;
  recent_proposals: SkillImprovementProposal[];
  recent_signals: SkillImprovementSignalEvent[];
  recent_effects: SkillImprovementEffectEvent[];
  dual_track_memory: {
    tenant_id: string;
    resident_count: number;
    history_count: number;
    resident_max_chars: number;
    latest_history_at?: number | null;
    tracks?: Record<string, string>;
  };
}
