# ClawCommerce Agent 内部 API 清单（供后端对接）

> 后端通过内部 REST/WebSocket 调用以下能力，**不直接暴露给前端**。前端只调用后端的 `agent.service.ts` 等封装接口。

---

## 一、节点管理（已实现）

| 能力 | 类型 | 说明 | 当前实现 |
|------|------|------|----------|
| 获取节点状态 | 内部调用 | 返回所有节点列表及 idle/allocated/unhealthy 计数 | `NodeManager.getNodesStatus()` → `NodesStatusResponse` |
| 分配节点 | 内部调用 | 按 Campaign 配置分配 1 节点 + 可选 1 手机号 | `NodeManager.allocate(campaign: CampaignConfig)` → `AllocationResult \| null` |
| 释放节点 | 内部调用 | 释放指定节点及绑定手机号 | `NodeManager.release(nodeId: string)` → `boolean` |
| 注册节点 | 内部调用 | 新容器启动后注册到池（扩容） | `NodeManager.registerNode(overrides)` → `NodeStatus` |
| 节点事件流 | WebSocket/回调 | 实时推送 node_allocated / node_released / node_unhealthy 等 | 创建 NodeManager 时传入 `onEvent: (event: NodePoolEvent) => void`，后端转发到自己的 WS |

**后端对接方式**  
- 方案 A：后端进程内创建 `NodeManager`（需 Redis），直接调用上述方法；`GET /api/agent/nodes/status` 内部调 `getNodesStatusHandler(nodeManager)`；WS 在 `onEvent` 里广播。  
- 方案 B：后端通过 HTTP 调 Agent 侧独立服务（如 `GET http://agent-service/internal/nodes/status`），由 Agent 仓库提供的 `agent-dashboard-server` 或等价服务实现。  

**类型定义位置**  
- `src/agent/types.ts`：`NodeStatus`、`CampaignConfig`、`AllocationResult`、`NodesStatusResponse`、`NodePoolEvent`。

---

## 二、内容与二创（已实现骨架）

| 能力 | 类型 | 说明 | 当前实现 |
|------|------|------|----------|
| 生成二创脚本 | 内部调用 | 根据行业、平台、对标账号内容生成文案/视频脚本等 | `generateErChuangScript(options: ContentGeneratorOptions, llm: LLMAdapter)` → `ErChuangScript \| null` |
| 加载 Prompt 模板 | 内部 | 按行业/平台/用途加载 JSON 模板 | `loadTemplate(industry, platform, purpose)` |
| 执行发帖 Skill | 内部 | 小红书发帖等（真实浏览器操作） | `skills/xiaohongshu-post.run(ctx)`（当前为占位，待 Playwright 接入） |

**后端对接方式**  
- 后端在「创建内容任务」时调用 Agent 的 `generateErChuangScript`（需注入 LLM 客户端）；或通过 Agent 提供的内部 HTTP 接口如 `POST /internal/content/generate`，Body 为 `ContentGeneratorOptions`，返回 `ErChuangScript`。  
- 发帖/点赞等执行由 Agent 定时或由后端触发（BullMQ 任务调 Agent）。

**类型定义位置**  
- `src/content/types.ts`：`ContentGeneratorOptions`、`ErChuangScript`、`BenchmarkAccount`。

---

## 三、线索提取与回传（待实现）

| 能力 | 类型 | 说明 | 计划实现 |
|------|------|------|----------|
| 每日线索扫描 | 定时/触发 | 扫描私信/评论/咨询入口，AI 提取有效线索 | `lead/lead-extractor.ts` + BullMQ |
| 线索推送 | 内部调用 | Webhook/邮件/钉钉/企微/CRM；去重、打分、标签 | `lead/lead-pusher.ts` |
| RAG 自学习 | 内部 | 成功线索案例入 RAG，迭代 Prompt | `lead/rag-knowledge.ts` |

**后端对接方式**  
- 后端 BullMQ 每日任务触发 Agent 的「线索扫描」接口（或 Agent 自建定时调后端「写入线索」API）；  
- 线索落库、加密、多租户由后端负责；Agent 只负责提取与推送（或推送至后端统一入口）。

---

## 四、建议的后端「Agent 服务层」接口形态（供 agent.service.ts 参考）

后端对**前端**暴露的 API 以 PRD 为准；以下为后端**内部**调 Agent 的抽象形态，便于实现 `agent.service.ts`：

- `getNodesStatus()` → 调 `NodeManager.getNodesStatus()` 或 Agent 内部 GET。  
- `allocateNode(campaignId, merchantId, rule)` → 构造 `CampaignConfig`，调 `NodeManager.allocate(campaign)`。  
- `releaseNode(nodeId)` → 调 `NodeManager.release(nodeId)`。  
- `generateContent(campaignId, industry, platform, benchmarkAccountIds)` → 调 Agent `generateErChuangScript` 或内部 POST。  
- 节点/线索/告警实时数据：后端从 Agent 的 `onEvent` 或 Agent 的 WS 接收，再通过自己的 WebSocket 推给前端。

---

以上清单随 Agent 仓库迭代更新；后端与 PM 可据此对齐接口与职责边界。
