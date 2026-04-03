# 统一控制面收口说明（2026-03-20）

## 目标

按优先级完成以下收口：

1. 明确唯一控制面：`web + backend`
2. 合并 compose（profile 化，去重基础组件）
3. 修复 UTF-8 中文乱码（优先 demo 与主导航）
4. 真链路回归作为唯一发版阻断（禁 mock fallback）
5. 强化合规边界（人机协同优先）

## 已完成变更

### 1) 控制面与 AI 子服务边界

- 新增 backend 代理层：
  - `POST /api/v1/ai/run-dragon-team`
  - `POST /api/v1/ai/analyze-competitor-formula`
  - `GET /api/v1/ai/status`
  - `GET /api/v1/ai/health`
- 新增模块：
  - `backend/src/ai-subservice/*`
- backend 通过服务账号访问 `dragon-senate-saas-v2`，前端不再直接依赖 AI 子服务地址。

### 2) 统一 Compose

- 根目录 `docker-compose.yml` 已切换为统一入口。
- 单实例共享基础设施：
  - `redis`, `postgres`, `qdrant`, `ollama`
- profile 化可选组件：
  - `monitoring`, `telegram`, `anythingllm`, `tunnel`
- 原根 compose 备份为：
  - `docker-compose.agent-legacy.yml`

### 3) UTF-8 中文修复（首批）

已修复并重写：

- `web/src/components/layout/Sidebar.tsx`
- `web/src/components/layouts/Header.tsx`
- `web/src/app/login/page.tsx`
- `web/src/app/demo/page.tsx`
- `web/src/app/nodes/page.tsx`
- `web/src/app/page.tsx`
- `web/src/services/api.ts`
- `web/src/app/layout.tsx`

结果：页面主要导航、登录、demo 入口、nodes 向导均为正常中文显示。

### 4) 真链路 CI 门禁

- 工作流 `week3-e2e.yml` 已收敛为单一 live gate。
- 显式禁用 mock：
  - `NEXT_PUBLIC_USE_MOCK=false`
  - `NEXT_PUBLIC_DASHBOARD_ALLOW_MOCK_FALLBACK=false`
- 发版阻断改为真实后端联调链路。

### 5) 合规边界

- backend 新增开关：
  - `COMPLIANCE_REQUIRE_HITL=true`（默认）
- 若请求显式 `execution_mode=auto`，会被 backend 拒绝，要求 assistive 模式。
- 保持 HITL 审批机制作为关键动作保护。

## 本地验证

- `backend`: `npm run build` ✅
- `web`: `npm run build` ✅
- `docker compose config` ✅

