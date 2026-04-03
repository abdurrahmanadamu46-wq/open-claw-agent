export type MemoryLayer = 'L0' | 'L1' | 'L2';

export interface MemoryLayerCount {
  count: number;
  bytes?: number;
}

export interface MemoryCompressionStats {
  lobster_id: string;
  tenant_id?: string;
  l0_count: number;
  l1_count: number;
  l2_count: number;
  compression_ratio: number;
  layers?: Record<MemoryLayer, MemoryLayerCount>;
}

export interface MemoryCompressionRequest {
  tenant_id?: string;
  lobster_id?: string;
  mode?: 'l0_to_l1' | 'l1_to_l2' | 'full';
  force?: boolean;
}

export interface MemoryCompressionRunResult {
  ok: boolean;
  tenant_id?: string;
  lobster_id?: string;
  mode: 'l0_to_l1' | 'l1_to_l2' | 'full';
  created_count?: number;
  updated_count?: number;
  summary?: string;
  stats?: MemoryCompressionStats;
}
