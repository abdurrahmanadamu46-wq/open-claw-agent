export interface HybridMemorySearchItem {
  final_score: number;
  memory_details: Record<string, unknown>;
  dense_rank?: number;
  sparse_rank?: number;
}

export interface HybridMemorySearchResponse {
  ok: boolean;
  backend: string;
  query: string;
  items: HybridMemorySearchItem[];
}
