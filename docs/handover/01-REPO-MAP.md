# 仓库地图（Repo Map）

Last Updated: 2026-03-26

## A. 生产主干目录（真实运行链路）

### 1) 控制面
- `web/`：Next.js 商家控制台
- `backend/`：NestJS API 网关（鉴权、编排、指标、审计）

### 2) AI 子服务
- `dragon-senate-saas-v2/`：
  - 9 龙虾编排
  - RAG / 行业知识池
  - Senate Kernel（治理/验证/记忆）
  - 飞书/钉钉/Telegram 通道（按配置启用）

### 3) 边缘执行
- `edge-runtime/`：边缘执行器（无脑执行，不持有策略）

### 4) 模块桥接入口
- `apps/web` -> `../../web`
- `apps/backend` -> `../../backend`
- `apps/ai-subservice` -> `../../dragon-senate-saas-v2`
- `apps/edge-runtime` -> `../../edge-runtime`
- `apps/desktop-client`：桌面客户端

### 5) 运维与门禁
- `scripts/modules/module.ps1`：模块启停
- `scripts/apps/apps.ps1`：apps 统一控制
- `.github/workflows/mainline-gate.yml`：主干门禁

## B. 历史/实验目录（默认不作为真相源）
- `dragon-senate-saas/`
- `liayouan_os/`
- `textsrc/` / `textdesign/`
- `openclaw_ref_20260323/`

> 新团队接手时：优先基于 `web + backend + dragon-senate-saas-v2 + edge-runtime` 交付，不从历史目录回抄。

## C. 常见误判目录（不直接修改）
- `web/.next`、`backend/dist`：构建产物
- `*_test_*.sqlite`：本地测试库
- `logs/`：运行日志
- `node_modules`：依赖缓存

## D. 当前交接范围内关键文档
- `PROJECT_STATE.md`
- `COMMERCIALIZATION_SCORE.md`
- `BACKLOG.md`
- `DECISIONS.md`
- `SKIP_TEMP.md`
- `docs/handover/*`

## E. 强边界约束
1. 前端不允许直连 AI 子服务，统一经 `backend`。
2. 高风险动作必须 HITL 审批。
3. 边缘端只执行，不下放策略推理。
4. 关键动作必须留下可回放审计证据。
5. 收口优先级：先 P0 商业闭环，再 P1/P2 体验优化。
