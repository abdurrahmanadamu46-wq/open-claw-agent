export interface RuntimeCompactionStatsResponse {
  ok: boolean;
  session_id: string;
  compactor_version?: string;
  compaction_count: number;
  recent_files_tracked: number;
  has_workflow: boolean;
  skills_tracked: number;
  runtime_policy_attached?: boolean;
  skill_schema_attachment_count?: number;
  account_snapshot_attached?: boolean;
  estimated_tokens?: number;
  trigger_threshold?: number;
  usage_percent?: number;
  should_compact?: boolean;
  tokens_until_compact?: number;
  fresh_tail_count?: number;
  tool_call_count?: number;
  tool_result_count?: number;
  tool_pair_boundary_preserved?: boolean;
  workflow_attached?: boolean;
}
