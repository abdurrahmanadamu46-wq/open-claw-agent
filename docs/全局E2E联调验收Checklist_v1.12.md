# ClawCommerce 全局 E2E 联调验收 Checklist v1.12

> 5 个核心必须通过的测试用例 — P0 大动脉 + P1 线索闭环

---

## 1. 前端 → 后端：创建任务并返回成功

**步骤**：前端「创建任务」表单提交（industry_template_id、target_urls、content_strategy 等），调用 `POST /api/v1/campaigns`。

**验收**：后端返回 200，body 含 `campaign_id`、`status`；数据库/日志中存在该 campaign 记录，且已向 BullMQ 投递任务。

**负责**：小明（接口 + 落库 + 投递）；小军（前端表单调用该接口）。

---

## 2. 后端 → Agent：任务被消费并执行

**步骤**：后端 CampaignProcessor 消费 BullMQ job，请求 `POST {AGENT_INTERNAL_URL}/internal/campaign/execute`，Body 为 ICampaignConfig。

**验收**：Agent 返回 200，body 含 `ok: true`、`nodeId`（或无节点时 `ok: false, error: NO_NODE_AVAILABLE`）；Agent 日志可见「分配节点 → SCRAPING → … → 释放」或占位执行。

**负责**：小明（Processor 调 Agent）；小军（Agent 提供 /internal/campaign/execute）。

---

## 3. Agent → 后端：线索回传落库

**步骤**：Agent（或联调时手动）调用 `POST {BACKEND_INTERNAL_URL}/api/internal/leads`，Header `x-internal-secret`，Body 含 tenant_id、campaign_id、contact_info、intention_score、source_platform。

**验收**：后端返回 200，Lead 表新增一条，contact_info 为 AES 密文；lead-webhook-queue 收到推送 job（若配置了 webhook）。

**负责**：小军（Agent lead-pusher）；小明（InternalApiGuard + Lead 落库 + 队列）。

---

## 4. 前端 → 后端：线索列表与大盘可见

**步骤**：前端打开「线索管理」页，请求 `GET /api/v1/leads?page=1&limit=20`；打开「数据大盘」，请求 `GET /api/v1/dashboard/metrics`。

**验收**：后端返回 200，线索列表含上一步落库的数据（脱敏展示）；大盘含 total_leads_today、node_health_rate 等。

**负责**：小明（接口 + 解密/脱敏）；小军（前端仅调用接口并渲染）。

---

## 5. 前端 → 后端：终止任务且 Agent 释放节点

**步骤**：前端点击某任务的「终止」，调用 `POST /api/v1/campaigns/{campaign_id}/terminate`；后端再请求 Agent `POST {AGENT_INTERNAL_URL}/internal/campaign/terminate`，Body `{ campaign_id }`。

**验收**：后端返回 200；Agent 返回 `released: [nodeId, …]`，该 campaign 下节点回到空闲池。

**负责**：小明（terminate 接口 + 调 Agent 释放）；小军（Agent /internal/campaign/terminate）。

---

## 通过标准

- 上述 5 条全部通过，即「大动脉 + 线索闭环」联调验收通过。
- 建议按 1 → 2 → 3 → 4 → 5 顺序执行；2 依赖 1，4 依赖 3。
