-- v1.25 一号客户 — 手动开户 + ClientDevice 白名单（按实际 schema 改表名/字段）
-- 执行前请替换 tenant_id、machine_code、邮箱等占位符

-- 1) 租户（示例：tenants 表，按你们真实表结构调整）
-- INSERT INTO tenants (id, name, plan, lead_quota, created_at)
-- VALUES (
--   'tenant_vip_001',
--   '一号客户公司名',
--   'PRO',
--   999999,
--   NOW()
-- );

-- 2) ClientDevice 强绑定 — 小军 exe 里写死的 MACHINE_CODE 必须一致
-- INSERT INTO client_devices (tenant_id, machine_code, status, bound_at)
-- VALUES (
--   'tenant_vip_001',
--   'VIP-CLIENT-001',
--   'ONLINE',
--   NOW()
-- )
-- ON CONFLICT (machine_code) DO UPDATE SET
--   tenant_id = EXCLUDED.tenant_id,
--   status = 'ONLINE';

-- 3) JWT 须由后端用同一 JWT_SECRET 签发，payload 示例：
-- { "sub": "VIP-CLIENT-001", "tenantId": "tenant_vip_001", "role": "agent_node" }
-- 不要把 JWT 写进 SQL；发给小军放入 .env.vip 的 CLIENT_DEVICE_TOKEN

-- 4) 若使用 backend/ 内存 DeviceService，需换成 PG upsert 后 WS 握手才会持久归属
