export interface DualTrackMemorySourceRef {
  source_type: string;
  source_id: string;
  summary?: string;
  url?: string;
}

export interface DualTrackResidentMemoryItem {
  resident_id: string;
  tenant_id: string;
  scope: string;
  key: string;
  content: string;
  source_refs: DualTrackMemorySourceRef[];
  priority: number;
  lobster_id?: string;
  checksum?: string;
  created_at: number;
  updated_at: number;
}

export interface DualTrackHistoryMemoryItem {
  history_id: string;
  tenant_id: string;
  source_type: string;
  source_id: string;
  content: string;
  content_hash: string;
  source_refs: DualTrackMemorySourceRef[];
  lobster_id?: string;
  task_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
  created_at: number;
  score?: number;
}

export interface DualTrackMemoryContextResponse {
  ok: boolean;
  tenant_id: string;
  query: string;
  resident_context: string;
  resident_items: DualTrackResidentMemoryItem[];
  history_matches: DualTrackHistoryMemoryItem[];
  source_chain: DualTrackMemorySourceRef[];
  resident_max_chars: number;
  original_retained_in_history: boolean;
}

export interface DualTrackMemoryStatsResponse {
  ok: boolean;
  tenant_id: string;
  stats: {
    tenant_id: string;
    resident_count: number;
    history_count: number;
    resident_max_chars: number;
    latest_history_at?: number | null;
    tracks: {
      resident: string;
      history: string;
    };
  };
}

export interface DualTrackMemoryRememberPayload {
  tenant_id: string;
  content: string;
  source_type?: string;
  source_id?: string;
  source_refs?: DualTrackMemorySourceRef[];
  lobster_id?: string;
  task_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
  promote_to_resident?: boolean;
  resident_key?: string;
  resident_priority?: number;
  scope?: string;
}

export interface DualTrackMemoryRememberResponse {
  ok: boolean;
  tenant_id: string;
  history: DualTrackHistoryMemoryItem;
  resident?: DualTrackResidentMemoryItem | null;
  secret_guard_labels?: string[];
}
