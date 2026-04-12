# ClawCommerce Phase 3 后端交付与对接确认 v1.12

> 小明 Phase 3 商家前端控制台接口已交付；小军侧（前端 + Agent）对接状态与建议下一步。

---

## 一、小明交付与契约对齐

| 模块 | 小明实现 | 前端/Agent 对接状态 |
|------|----------|----------------------|
| **统一错误码** | CustomExceptionFilter → 40001/40101/40301/50001 | 前端 `api.ts` 已按该 code 做 Toast 与 401 强踢登录 |
| **GET /api/v1/dashboard/metrics** | getAggregatedMetrics(tenantId)，≤300ms | 前端 `fetchDashboardMetrics`、类型 `DashboardMetricsResponse` 已对齐 |
| **GET /api/v1/leads** | getMaskedLeadsList，脱敏 138****5678 | 前端 `fetchLeads`、类型 `LeadListItem`（含 webhook_status 联合类型）已对齐 |
| **GET /api/v1/leads/:id/reveal** | 解密 + 审计日志 + 返回明文 | 前端 `revealLead` 已调该接口，Mock 可关后直连 |
| **POST /api/v1/campaigns/:id/terminate** | 更新状态 + 可选调 Agent 释放 | 见下 |

---

## 二、终止任务与 Agent 对接

小明代码中：

```ts
// await this.agentService.abortCampaign(campaignId);
```

**小军侧已就绪**：Agent 提供 `POST {AGENT_INTERNAL_URL}/internal/campaign/terminate`，Body `{ "campaign_id": "xxx" }`，会释放该 campaign 下所有已分配节点。

建议小明在 `terminateCampaign` 内取消注释并实现：

```ts
await this.agentService.releaseCampaignNodes(campaignId);
// 即 HTTP POST 到 AGENT_INTERNAL_URL/internal/campaign/terminate，Body { campaign_id }
```

这样商家点击「终止」后，后端状态更新 + Agent 节点回收，一次闭环。

---

## 三、前端类型与 Cursor 使用

- 已在 **web/src/shared/types/** 增加与小明契约一致的类型：
  - **dashboard.ts**：`DashboardMetricsResponse`
  - **lead.ts**：`LeadListItem`（webhook_status: 'PENDING' | 'SUCCESS' | 'FAILED'）、`LeadRevealResponse`
- 前端 `services/endpoints` 可继续用现有接口，或改为从 `@/shared/types/dashboard`、`@/shared/types/lead` 引用类型，与后端 Swagger 保持一致，方便 Cursor 生成页面。

---

## 四、给 小丽 / 老板的「接下来」建议

小明问：**安排部署上线内测，还是先输出 SaaS 订阅与扣费逻辑？**

建议二选一（或分阶段）：

1. **先内测跑通 E2E**  
   用《全局 E2E 联调验收 Checklist》5 条把「创建任务 → Agent 执行 → 线索回传 → 大盘/列表/脱敏/解锁」全链路跑通，再安排内测部署。这样 V1 商业闭环先验证，再上计费更稳。

2. **再上订阅与扣费**  
   内测通过后，由小明输出「按线索/月卡扣费」的事务设计（配额、扣减、账单表），后端统一做计费与鉴权，前端只展示配额/用量即可。

以上为 Phase 3 后端交付的对接确认与下一步建议；小军侧前端类型与 Agent 终止接口均已就绪，可与小明联调。
