# Manifest × OpenClaw 龙虾池集成方案

## 一、Manifest 核心能力分析

| 能力 | Manifest 实现 | 我们的需求映射 |
|------|--------------|--------------|
| 23维请求评分 | `packages/backend/src/scoring/` | 龙虾任务分级 (P0-P3 风险) |
| 4层路由 (simple/standard/complex/reasoning) | `routing-core/` | 9只龙虾按能力匹配 |
| 实时 Dashboard (成本/Token/消息量) | SolidJS + uPlot | Next.js 龙虾监控面板 |
| Provider 管理 (300+模型) | `provider.controller.ts` | 已有 `llm_router` + `agent_model_registry` |
| 消息日志 + 审计追溯 | TypeORM entities | 已有 `audit_logger` + `lossless_memory` |
| 预算限制 (Budget Limits) | `Limits.tsx` | 已有 `billing` 模块 |

## 二、融合策略：不是替换，而是增强

### 已确认事实
- 我们的 `llm_router` 已有基础路由能力，但缺少 **23维评分** 和 **可视化监控**
- 我们的 9只龙虾已有角色定义，但没有 **统一的运行时可视化面板**
- 我们的 `web/` 已是 Next.js，可直接添加新页面

### 融合方案：3层架构

```
┌──────────────────────────────────────────────────┐
│ Layer 3: 龙虾监控 Dashboard (Next.js 新页面)       │
│  - 龙虾池总览 (9虾实时状态/成本/任务量)              │
│  - LLM 路由可视化 (模型选择/成本对比)                │
│  - 任务评分维度分析 (Manifest 23维)                 │
│  - 消息日志 + 审计日志查看                          │
└──────────────────────────────────────────────────┘
                        ↓ REST API
┌──────────────────────────────────────────────────┐
│ Layer 2: 龙虾管理 API (FastAPI 新端点)              │
│  GET  /lobster/pool/overview     → 9虾状态总览      │
│  GET  /lobster/pool/metrics      → Token/成本/任务量 │
│  GET  /lobster/{id}/detail       → 单虾详情          │
│  GET  /lobster/scoring/explain   → 评分维度解释      │
│  POST /lobster/scoring/simulate  → 模拟评分          │
│  GET  /lobster/routing/history   → 路由历史          │
└──────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────┐
│ Layer 1: 评分引擎 (Python 移植 Manifest Scorer)    │
│  - lobster_scorer.py  (23维评分 Python 版)          │
│  - 与现有 llm_router 融合                          │
│  - 每次路由记录到 lossless_memory                   │
└──────────────────────────────────────────────────┘
```

## 三、实施优先级

### Phase 1 — 龙虾池管理 API + 总览 (本次交付)
- `dragon-senate-saas-v2/lobster_pool_manager.py` — 9虾池管理器
- app.py 新增 `/lobster/pool/*` 系列 API
- 核心能力：虾状态、任务统计、LLM用量、成本追踪

### Phase 2 — 评分引擎移植 (下一轮)
- 将 Manifest 的 23 维 scoring 移植为 Python 版
- 与 `llm_router.py` 深度融合
- 添加 momentum (惯性) 和 tier-auto-assign

### Phase 3 — 前端 Dashboard (下下轮)
- Next.js 新页面: `/dashboard/lobster-pool`
- 实时图表 (uPlot / Recharts)
- 龙虾卡片 (状态/健康/任务/成本)

## 四、当前执行：Phase 1 — lobster_pool_manager.py
