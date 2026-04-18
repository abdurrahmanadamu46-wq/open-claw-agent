export interface RuntimeProviderSummary {
  id?: string;
  name?: string;
  type?: string;
  route?: string;
  base_url?: string;
  enabled?: boolean;
  priority?: number;
  weight?: number;
  default_model?: string;
}

export interface RuntimeMcpServerSummary {
  id?: string;
  name?: string;
  transport?: string;
  status?: string;
  enabled?: boolean;
  edge_node_id?: string | null;
  allowed_lobsters?: string[];
}

export interface RuntimeConnectorCredentialSummary {
  tenant_id?: string;
  connector?: string;
  present?: boolean;
  expired?: boolean;
  updated_at?: string;
  has_refresh_token?: boolean;
  fields?: string[];
}

export interface RuntimeCapabilityOverviewResponse {
  ok: boolean;
  tenant_id: string;
  generated_at: string;
  summary: {
    provider_count: number;
    enabled_provider_count: number;
    mcp_server_count: number;
    healthy_mcp_server_count: number;
    connector_credential_count: number;
    configured_connector_count: number;
  };
  providers: RuntimeProviderSummary[];
  mcp_servers: RuntimeMcpServerSummary[];
  connector_credentials: RuntimeConnectorCredentialSummary[];
}
