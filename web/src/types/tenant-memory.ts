export interface TenantMemoryScopeDetail {
  count: number;
  shared: boolean;
  durable: boolean;
}

export interface TenantMemoryStatsResponse {
  ok: boolean;
  tenant_id: string;
  total_entries: number;
  by_scope: Record<string, number>;
  scope_details: Record<string, TenantMemoryScopeDetail>;
  by_category: Record<string, number>;
  by_lobster: Record<string, number>;
  last_updated_at?: number | null;
  scopes_available: string[];
}

export interface TenantMemoryEntry {
  entry_id: string;
  tenant_id: string;
  scope: string;
  scope_shared: boolean;
  scope_durable: boolean;
  category: string;
  key: string;
  value: string;
  source_lobster: string;
  checksum: string;
  version: number;
  is_deleted: boolean;
  created_at: number;
  updated_at: number;
}

export interface TenantMemoryEntriesResponse {
  ok: boolean;
  total: number;
  entries: TenantMemoryEntry[];
}
