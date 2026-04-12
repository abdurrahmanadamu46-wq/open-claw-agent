export declare const TENANT_CONFIG_TABLE = "tenant_config";
export interface TenantConfigRow {
    id: string;
    tenant_id: string;
    integrations: Record<string, unknown>;
    updated_at: Date;
}
