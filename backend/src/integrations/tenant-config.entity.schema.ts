/**
 * 租户配置实体 — 目标 schema（接入 TypeORM 时使用）
 * 当前实现：IntegrationsService 将 integrations 存于 Redis key tenant_integrations:{tenantId}
 * 迁移到 Postgres 时：建表 tenant_config (id, tenant_id, integrations JSONB, updated_at)
 */

export const TENANT_CONFIG_TABLE = 'tenant_config';

/** 表结构说明（TypeORM 实体可据此生成） */
export interface TenantConfigRow {
  id: string;
  tenant_id: string;
  /** 第三方集成 BYOK 配置，对应 TenantIntegrations */
  integrations: Record<string, unknown>;
  updated_at: Date;
}
