# ClawCommerce PRD v1.9 Phase 3 — Agent 端对接说明

> 商家前端控制台（Dashboard & CRUD）由小明后端提供 API；Agent 仅需提供「终止任务」时的节点释放接口，其余均为后端职责。

---

## 一、契约与行为对齐（Sprint 2）

- **ICampaignConfig** 已与小明后端同步：增加 **content_strategy**（template_type, min_clips, max_clips），publish_strategy 改为可选。
- **campaignConfigFromPayload**：优先用 `content_strategy.template_type` 作为 industry，供 getSemanticBoundaryInstructions / 弹性分镜使用。
- **validateClipLogic**：3 次重试仍失败则**抛异常**，不向后端提交脏数据；后端 422 防线为二次保障，Agent 侧不硬传。

---

## 二、后端可调用的 Agent 内部接口（供小明实现 Phase 3）

| 接口 | 用途 |
|------|------|
| `POST /internal/campaign/execute` | 执行单次 Campaign（BullMQ Processor 调用） |
| `POST /internal/campaign/terminate` | 强制终止任务时释放该 campaign 下所有节点 |
| `GET /api/agent/nodes/status` | 大盘节点健康度（可选：后端聚合进 dashboard metrics） |

**终止任务流程（小明实现）**：  
商家调用 `POST /api/v1/campaigns/{campaign_id}/terminate` → 后端将任务状态置为终止 → 后端请求 `POST {AGENT_INTERNAL_URL}/internal/campaign/terminate` Body `{ campaign_id }` → Agent 释放该 campaign 占用的所有节点 → 返回 `{ ok, released }`。

---

## 三、Phase 3 前端 API 与 Agent 的关系

- **GET /api/v1/dashboard/metrics**：由后端聚合（线索、任务数、发布数、**node_health_rate** 等）；若需节点健康率，后端可调 Agent `GET /api/agent/nodes/status` 汇总后写入 metrics。
- **POST/GET /api/v1/campaigns**、**GET/POST /api/v1/leads**、**GET /api/v1/leads/{id}/reveal**：纯后端 CRUD 与鉴权，Agent 不参与。
- **POST /api/v1/campaigns/{id}/terminate**：后端在更新状态后调用 Agent `POST /internal/campaign/terminate`，完成节点回收。

以上为 Agent 端对 PRD v1.9 Phase 3 的对接说明，供小明实现 src/services/ 与前端联调时参考。
