export interface FleetEdgeEventRecord {
  eventId: string;
  tenantId: string;
  nodeId: string;
  platform: string;
  accountId: string;
  eventType: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface FleetEdgeEventListResponse {
  code: number;
  data: {
    items: FleetEdgeEventRecord[];
  };
}

export interface XhsEventSummaryResponse {
  ok: boolean;
  tenant_id: string;
  summary: {
    total_events: number;
    high_intent_comment_count: number;
    risk_comment_count: number;
    unread_summary_present: boolean;
    new_connection_count: number;
  };
  counts_by_type: Record<string, number>;
  high_intent_comments: FleetEdgeEventRecord[];
  risk_comments: FleetEdgeEventRecord[];
  latest_unread_summary: FleetEdgeEventRecord | null;
  latest_likes_collects_summary: FleetEdgeEventRecord | null;
  latest_new_connections: FleetEdgeEventRecord[];
}

export type XhsRoleFeedKind = 'echoer' | 'catcher';
export type XhsRoleFeedPriority = 'high' | 'medium' | 'low';
export type XhsRouteHint = 'echoer' | 'catcher' | 'followup' | 'commander';
export type XhsFeedRiskLevel = 'low' | 'medium' | 'high';
export type XhsFeedLeadIntent = 'low' | 'medium' | 'high';
export type XhsArtifactType = 'EngagementReplyPack' | 'LeadAssessment';
export type XhsArtifactState = 'draft' | 'needs_review';
export type XhsRoleProcessingStage = 'REPLYING' | 'ROUTING' | 'SCREENING' | 'ESCALATING';
export type XhsConsumerSkillId = 'openclaw-xhs-channel-supervisor' | 'openclaw-xhs-engagement-watch';
export type XhsHandoffActionType = 'claim' | 'escalate_commander' | 'route_catcher' | 'route_followup' | 'resolve';
export type XhsHandoffActionRole = 'echoer' | 'catcher';
export type XhsHandoffActionStatus = 'open' | 'resolved';
export type XhsCommanderQueueActionType = 'acknowledge' | 'assign' | 'close';
export type XhsCommanderQueueStatus = 'open' | 'acknowledged' | 'assigned' | 'closed' | 'resolved';
export type XhsCommanderTaskActionType = 'start' | 'complete';
export type XhsCommanderReminderPolicyPresetId = 'conservative' | 'standard' | 'aggressive' | 'custom';

export interface XhsRoleFeedItem {
  id: string;
  role: XhsRoleFeedKind;
  source_event_id: string;
  event_type: string;
  account_id: string;
  node_id: string;
  created_at: string;
  priority: XhsRoleFeedPriority;
  route_hint: XhsRouteHint;
  reason: string;
  suggested_action: string;
  content?: string;
  author_name?: string;
  note_id?: string | null;
  source_url?: string | null;
  lead_intent: XhsFeedLeadIntent;
  risk_level: XhsFeedRiskLevel;
  payload: Record<string, unknown>;
}

export interface XhsRoleFeedResponse {
  ok: boolean;
  tenant_id: string;
  role: XhsRoleFeedKind;
  total: number;
  items: XhsRoleFeedItem[];
}

export interface XhsSupervisorRoleHandoff {
  role: XhsRoleFeedKind;
  total: number;
  urgent_count: number;
  commander_count: number;
  default_action: string;
  top_items: XhsRoleFeedItem[];
}

export interface XhsSupervisorOverviewResponse {
  ok: boolean;
  tenant_id: string;
  summary: {
    total_events: number;
    high_intent_comment_count: number;
    risk_comment_count: number;
    unread_summary_present: boolean;
    new_connection_count: number;
    echoer_pending_count: number;
    catcher_pending_count: number;
    commander_escalation_count: number;
  };
  role_handoffs: {
    echoer: XhsSupervisorRoleHandoff;
    catcher: XhsSupervisorRoleHandoff;
  };
  warnings: string[];
}

export interface XhsHandoffEvidence {
  label: string;
  value: string;
}

export interface XhsRoleConsumerContract {
  schema_version: string;
  role: XhsRoleFeedKind;
  artifact_type: XhsArtifactType;
  consumer_skill: XhsConsumerSkillId;
  escalation_role: 'commander';
  notes: string;
}

export interface XhsRoleHandoffPack {
  schema_version: string;
  pack_id: string;
  role: XhsRoleFeedKind;
  artifact_type: XhsArtifactType;
  artifact_state: XhsArtifactState;
  stage: XhsRoleProcessingStage;
  priority: XhsRoleFeedPriority;
  route_hint: XhsRouteHint;
  source_event_id: string;
  source_event_type: string;
  account_id: string;
  node_id: string;
  created_at: string;
  summary: string;
  next_step: string;
  source_url?: string | null;
  consumer_contract: XhsRoleConsumerContract;
  evidence: XhsHandoffEvidence[];
  artifact_payload: Record<string, unknown>;
}

export interface XhsRoleHandoffBatch {
  schema_version: string;
  role: XhsRoleFeedKind;
  artifact_type: XhsArtifactType;
  consumer_contract: XhsRoleConsumerContract;
  total: number;
  items: XhsRoleHandoffPack[];
}

export interface XhsSupervisorHandoffPackResponse {
  ok: boolean;
  schema_version: string;
  tenant_id: string;
  generated_at: string;
  batches: {
    echoer: XhsRoleHandoffBatch;
    catcher: XhsRoleHandoffBatch;
  };
}

export interface XhsHandoffActionRecord {
  schema_version: string;
  action_id: string;
  tenant_id: string;
  pack_id: string;
  action: XhsHandoffActionType;
  note?: string;
  status: 'recorded';
  created_at: string;
  actor: {
    tenant_id: string;
    roles: string[];
    is_admin: boolean;
  };
}

export interface XhsHandoffActionListResponse {
  ok: boolean;
  schema_version: string;
  tenant_id: string;
  items: XhsHandoffActionRecord[];
}

export interface XhsHandoffActionSummaryResponse {
  ok: boolean;
  schema_version: string;
  tenant_id: string;
  summary: {
    total_history_count: number;
    latest_pack_count: number;
    open_pack_count: number;
    resolved_pack_count: number;
    commander_escalation_count: number;
    route_catcher_count: number;
    route_followup_count: number;
  };
  latest_counts_by_action: Record<string, number>;
  latest_counts_by_role: Record<string, number>;
  recent_escalations: XhsHandoffActionRecord[];
  recent_resolved: XhsHandoffActionRecord[];
}

export interface XhsCommanderEscalationQueueItem {
  schema_version: string;
  queue_id: string;
  tenant_id: string;
  pack_id: string;
  source_action_id: string;
  status: XhsCommanderQueueStatus;
  priority: 'high';
  reason: string;
  latest_action: XhsHandoffActionType | XhsCommanderQueueActionType;
  assignee?: string;
  note?: string;
  created_at: string;
  updated_at: string;
  actor: XhsHandoffActionRecord['actor'];
}

export interface XhsCommanderEscalationQueueResponse {
  ok: boolean;
  schema_version: string;
  tenant_id: string;
  items: XhsCommanderEscalationQueueItem[];
}

export interface XhsCommanderTaskRecord {
  schema_version: string;
  task_id: string;
  tenant_id: string;
  pack_id: string;
  queue_id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'done';
  priority: 'high';
  assignee: string;
  source: 'xhs_commander_queue';
  note?: string;
  created_at: string;
  updated_at: string;
  details: {
    queue_status: XhsCommanderQueueStatus;
    latest_action: XhsCommanderEscalationQueueItem['latest_action'];
    reason: string;
    source_action_id: string;
    latest_task_action?: XhsCommanderTaskActionType;
  };
}

export interface XhsCommanderTaskListResponse {
  ok: boolean;
  schema_version: string;
  tenant_id: string;
  items: XhsCommanderTaskRecord[];
}

export interface XhsCommanderAlertDismissalRecord {
  schema_version: string;
  tenant_id: string;
  alert_id: string;
  dismissed_at: string;
  actor: XhsHandoffActionRecord['actor'];
}

export interface XhsCommanderAlertDismissalListResponse {
  ok: boolean;
  schema_version: string;
  tenant_id: string;
  dismissed_alert_ids: string[];
  items: XhsCommanderAlertDismissalRecord[];
}

export interface XhsCommanderReminderPolicyPreset {
  schema_version: string;
  preset_id: Exclude<XhsCommanderReminderPolicyPresetId, 'custom'>;
  label: string;
  description: string;
  queue_open_enabled: boolean;
  task_running_enabled: boolean;
  pending_task_enabled: boolean;
  max_alerts: number;
}

export interface XhsCommanderReminderPolicy {
  schema_version: string;
  tenant_id: string;
  preset_id: XhsCommanderReminderPolicyPresetId;
  queue_open_enabled: boolean;
  task_running_enabled: boolean;
  pending_task_enabled: boolean;
  max_alerts: number;
  updated_at: string;
  available_presets: XhsCommanderReminderPolicyPreset[];
}

export type XhsCommanderReminderPolicyChangeField =
  | 'preset_id'
  | 'queue_open_enabled'
  | 'task_running_enabled'
  | 'pending_task_enabled'
  | 'max_alerts';

export interface XhsCommanderReminderPolicyChangeRecord {
  schema_version: string;
  change_id: string;
  tenant_id: string;
  changed_at: string;
  change_source: 'preset' | 'manual';
  from_preset_id: XhsCommanderReminderPolicyPresetId;
  to_preset_id: XhsCommanderReminderPolicyPresetId;
  changed_fields: Array<{
    field: XhsCommanderReminderPolicyChangeField;
    before: boolean | number | string;
    after: boolean | number | string;
  }>;
  previous: Pick<
    XhsCommanderReminderPolicy,
    'preset_id' | 'queue_open_enabled' | 'task_running_enabled' | 'pending_task_enabled' | 'max_alerts'
  >;
  next: Pick<
    XhsCommanderReminderPolicy,
    'preset_id' | 'queue_open_enabled' | 'task_running_enabled' | 'pending_task_enabled' | 'max_alerts'
  >;
  actor: XhsHandoffActionRecord['actor'];
}

export interface XhsCommanderReminderPolicyChangeListResponse {
  ok: boolean;
  schema_version: string;
  tenant_id: string;
  items: XhsCommanderReminderPolicyChangeRecord[];
}
