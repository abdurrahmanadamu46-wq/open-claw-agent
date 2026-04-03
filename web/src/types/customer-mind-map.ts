export type ExploreStatus = 'unexplored' | 'partial' | 'explored';

export interface MindMapNode {
  node_id: string;
  dimension: string;
  label_cn: string;
  status: ExploreStatus;
  known_facts: string[];
  open_questions: string[];
  sources: string[];
  confidence: number;
  last_updated?: string | null;
}

export interface MindMapProgress {
  total_dimensions: number;
  explored: number;
  partial: number;
  unexplored: number;
  completion_pct: number;
  dimensions: Record<
    string,
    {
      status: ExploreStatus;
      label: string;
      known_count: number;
      open_questions: number;
    }
  >;
}

export interface CustomerMindMap {
  lead_id: string;
  tenant_id: string;
  nodes: Record<string, MindMapNode>;
  human_injections: Array<{
    content: string;
    injected_by: string;
    timestamp: string;
  }>;
  progress: MindMapProgress;
  updated_at: string;
}

export interface MindMapNodeUpdateRequest {
  new_facts: string[];
  answered_questions: string[];
  source: string;
  confidence?: number;
}
