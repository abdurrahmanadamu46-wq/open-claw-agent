export interface MCPServer {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'edge';
  command?: string;
  url?: string;
  env: Record<string, string>;
  enabled: boolean;
  status: 'healthy' | 'unavailable' | 'unknown';
  created_at: string;
  last_ping?: string | null;
  allowed_lobsters?: string[];
  edge_node_id?: string | null;
}

export interface MCPTool {
  server_id: string;
  tool_name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface MCPCallRecord {
  id: string;
  tenant_id?: string;
  lobster_id: string;
  server_id: string;
  tool_name: string;
  args_summary: string;
  result_summary: string;
  duration_ms: number;
  status: 'success' | 'error' | 'denied';
  created_at: string;
}

export interface MCPToolMonitorTopItem {
  tool: string;
  count: number;
}

export interface MCPToolMonitorHeatmapItem {
  lobster: string;
  tool: string;
  count: number;
}

export interface MCPToolMonitorFailureItem {
  lobster: string;
  tool: string;
  total: number;
  failed: number;
  denied: number;
  failure_rate_pct: number;
  avg_latency_ms: number;
}

export interface MCPToolPolicyLimit {
  max_calls_per_minute: number;
  max_calls_per_session: number;
  max_cost_per_call: number;
}

export interface MCPToolPolicy {
  lobster_name: string;
  allowed_tools: string[];
  denied_tools: string[];
  limits: Record<string, MCPToolPolicyLimit>;
  allow_unknown_tools: boolean;
}

export interface ToolMarketplaceListing {
  tool_id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  mcp_endpoint: string;
  version: string;
  author: string;
  is_builtin: boolean;
  is_active: boolean;
  monthly_cost_usd: number;
  created_at: number;
  tags: string[];
  subscribed?: boolean;
}

export interface ToolMarketplaceSubscription {
  tenant_id: string;
  tool_id: string;
  subscribed_at: number;
  is_active: boolean;
  name?: string;
  description?: string;
  category?: string;
  icon?: string;
  version?: string;
  monthly_cost_usd?: number;
  tags?: string[];
}
