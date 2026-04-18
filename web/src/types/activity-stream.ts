export interface ActivityStreamUsage {
  total_tokens?: number;
  tool_uses?: number;
  duration_ms?: number;
}

export interface ActivityStreamMetadata {
  task_id?: string;
  lobster_id?: string;
  [key: string]: unknown;
}

export interface ActivityStreamDetails {
  status?: string;
  mode?: string;
  summary?: string;
  usage?: ActivityStreamUsage;
  metadata?: ActivityStreamMetadata;
  [key: string]: unknown;
}

export interface ActivityStreamItem {
  activity_id: string;
  tenant_id: string;
  trace_id?: string;
  activity_type: string;
  actor_type: string;
  actor_id: string;
  actor_name: string;
  target_type: string;
  target_id: string;
  target_name: string;
  details: ActivityStreamDetails;
  created_at: string;
}

export interface ActivityStreamListResponse {
  ok: boolean;
  total: number;
  items: ActivityStreamItem[];
}

export interface ActivityStreamDetailResponse {
  ok: boolean;
  activity: ActivityStreamItem;
}
