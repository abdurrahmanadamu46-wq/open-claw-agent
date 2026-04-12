# ClawCommerce 后端与 Agent 对接契约（Sprint 1 闭环）

> 边界：**后端绝对权威** — 前端零业务逻辑，**Agent 零数据落盘权**。所有流转经后端强校验与加解密。

---

## 一、小明（后端）→ 小军（Agent）的调用

### 1. 执行 Campaign 任务（CampaignProcessor 消费 BullMQ 后）

后端 `CampaignProcessor.process(job)` 中调用：

```ts
await this.agentService.executeCampaignTask(payload);
```

**实现方式**：后端对 Agent 服务发起 **HTTP POST**，无需 Agent 自己消费 BullMQ。

| 项目 | 说明 |
|------|------|
| **URL** | `POST {AGENT_BASE_URL}/internal/campaign/execute` |
| **Body** | `ICampaignConfig`（JSON），与 PM v1.3 数据字典一致 |
| **Response 200** | `{ ok: boolean, nodeId?: string, campaignId: string, tenantId: string, error?: string }` |
| **Response 400** | Body 非法或缺少 `campaign_id` / `tenant_id` |
| **Response 500** | Agent 内部异常；body 仍为上述形状，`ok: false` + `error` |

**Agent 端行为**：分配节点 → 状态机 SCRAPING → GENERATING → PUBLISHING → 释放节点；不落库、不直接调 Webhook。

**后端 AgentService 示例**（供小明实现）：

```ts
// agent.service.ts
async executeCampaignTask(payload: ICampaignConfig): Promise<ExecuteCampaignResult> {
  const agentUrl = process.env.AGENT_INTERNAL_URL || 'http://agent:38789';
  const res = await firstValueFrom(
    this.httpService.post(`${agentUrl}/internal/campaign/execute`, payload, {
      timeout: 120000,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  return res.data;
}
```

---

## 二、小军（Agent）→ 小明（后端）的调用：线索回传

**原则**：Agent 不写数据库、不直接推商家 Webhook。Agent 只把「原始线索」POST 到后端，由后端加密落库并入 `lead-webhook-queue`。

### 2. 线索入库 API（后端需提供，Agent 调用）

| 项目 | 说明 |
|------|------|
| **URL** | 由后端定义，例如 `POST /internal/agent/leads` 或 `POST /api/internal/leads` |
| **Body** | `ILeadSubmissionPayload`（见 shared/contracts.ts） |
| **字段** | `tenant_id`, `campaign_id`, `contact_info`（明文，后端加密后存 lead.contact_info）, `intention_score`, `source?`, `extra?` |

**后端职责**：

1. 校验 `tenant_id`、`campaign_id`、权限（如内部 API Key 或 IP 白名单）。
2. 使用 Lead 实体的 **BeforeInsert 钩子** 对 `contact_info` 做 AES 加密后落库。
3. 去重、租户归属、写 `push_status = 'PENDING'`。
4. 入队 **lead-webhook-queue**，由 `LeadWebhookProcessor` 推送到商家 `webhook_url`。

**Agent 端**（lead-extractor / lead-pusher 实现时）：从私信/评论提取到线索后，只调用上述后端 API，不落库、不直接请求商家 Webhook。

---

## 三、数据字典（双端共用）

- **ICampaignConfig**、**NodeStatusEnum**、**CampaignJobData**、**NodeHeartbeatPayload**：`src/shared/contracts.ts`（Agent 仓库）；后端需同步或引用同一定义。
- **ILeadSubmissionPayload**：同上，线索回传 Body 契约。

---

## 四、Sprint 1 闭环检查

| 角色 | 交付 | 状态 |
|------|------|------|
| 小明（后端） | 全局拦截器 + 异常过滤器、Lead 实体 AES、CampaignProcessor + LeadWebhookProcessor、docker-compose | 已交付 |
| 小军（Agent） | 提供 `POST /internal/campaign/execute`，实现 `runCampaignTask`；线索仅调用后端 API（契约已定） | 已就绪 / 契约已定 |

联调时：后端将 `AGENT_INTERNAL_URL` 指向 Agent 服务地址，CampaignProcessor 消费到 job 后 POST 到该 URL 即可完成闭环。

---

## 六、强制终止任务（Phase 3 PRD v1.9）

商家在控制台点击「终止任务」时，后端 `POST /api/v1/campaigns/{campaign_id}/terminate` 除将任务状态置为终止外，**需调 Agent 强制释放该任务占用的所有节点**。

| 项目 | 说明 |
|------|------|
| **URL** | `POST {AGENT_BASE_URL}/internal/campaign/terminate` |
| **Body** | `{ "campaign_id": "CAMP_xxx" }` |
| **Response 200** | `{ "ok": true, "released": ["nodeId1", "nodeId2"] }` |

Agent 端已实现：`NodeManager.releaseByCampaignId(campaignId)` 带锁释放该 campaign 下所有已分配节点并回收手机号；Server 路由 `POST /internal/campaign/terminate` 已挂载。

---

## 五、线索回传（战果回收）— 已打通

- **后端**：已提供 `POST /api/internal/leads` + `InternalApiGuard`（请求头 `x-internal-secret`）+ `CreateInternalLeadDto`（tenant_id, campaign_id, contact_info, intention_score, source_platform, raw_context）。
- **Agent**：`pushLeadToBackend(payload)` 在 `src/agent/lead/lead-pusher.ts` 中实现，使用 `BACKEND_INTERNAL_URL` 与 `INTERNAL_API_SECRET` 环境变量，POST 到后端并携带 `x-internal-secret`。Body 与 DTO 对齐（含 source_platform、raw_context）。
- 联调：设置 `BACKEND_INTERNAL_URL`、`INTERNAL_API_SECRET` 后，Agent 侧可用 mock 数据调用 `pushLeadToBackend` 验证；Playwright 抓到的线索统一经此接口回传，由后端 AES 落库并触发 lead-webhook-queue。
