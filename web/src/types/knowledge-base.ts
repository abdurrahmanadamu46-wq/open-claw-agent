export interface KnowledgeBaseSummary {
  kb_id: string;
  name: string;
  tenant_id: string;
  created_at: string;
  doc_count: number;
  bound_lobsters: string[];
}

export interface KnowledgeBaseDocument {
  doc_id: string;
  filename: string;
  chunk_count: number;
  created_at: string;
}

export interface KnowledgeBaseDetail extends KnowledgeBaseSummary {
  documents: KnowledgeBaseDocument[];
}

export interface KnowledgeBaseSearchHit {
  chunk_id: string;
  doc_id: string;
  chunk_index: number;
  content: string;
  score: number;
  kb_id?: string;
  kb_name?: string;
}
