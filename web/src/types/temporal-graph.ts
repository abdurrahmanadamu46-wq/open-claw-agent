export interface TemporalGraphEntity {
  entity_id: string;
  name: string;
  entity_type: string;
  namespace: string;
  attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TemporalGraphEdge {
  edge_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  fact: string;
  namespace: string;
  valid_at: string;
  expired_at?: string | null;
  episode_id: string;
  confidence: number;
}

export interface TemporalGraphSnapshot {
  namespace: string;
  entities: TemporalGraphEntity[];
  edges: TemporalGraphEdge[];
  reference_time: string;
}
