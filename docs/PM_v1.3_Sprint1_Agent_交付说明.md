# ClawCommerce PM v1.3 Sprint 1 - Agent 端交付说明

> 对齐文档：研发协同协议 & 第一阶段双端开发任务书  
> 协作：小丽(PM)、小明(后端)、Cursor(AI Agent 工程师)

---

## 一、数据字典（双端严格遵守）

- **ICampaignConfig**、**NodeStatusEnum** 已落库：`src/shared/contracts.ts`
- 后端 BullMQ 下发的 job 形状：`CampaignJobData { type, payload: ICampaignConfig, jobId, tenantId }`
- Agent 上报心跳形状：`NodeHeartbeatPayload`（见 contracts.ts）

---

## 二、Sprint 1 Agent 任务完成情况

### 任务 2.1：node-manager.ts（主调度引擎）

- **状态机**：已支持 PM v1.3 约定状态：Idle → INIT → SCRAPING → GENERATING → PUBLISHING → COOLING / BANNED
- **带锁分配**：`NodeManager.allocate(campaign)` 使用 Redis 分布式锁，从节点池安全分配 1 节点 + 可选手机号
- **node-pool**：`setWorkflowState(nodeId, NodeStatusEnum)` 用于任务执行中状态流转；`release()` 时重置为 IDLE

### 任务 2.2：健康检测与 3 分钟无响应

- **health-monitor.ts**：若 `lastHeartbeatAt` 超过 **3 分钟** 无更新，直接判为 `unhealthy` 并触发 `onUnhealthy`（销毁/重启由运维或后端回调实现）
- 心跳间隔仍可配置（如 1 分钟一次），满足「无响应超过 3 分钟自动标记不可用」

### 任务 2.3：BullMQ campaign-queue 消费者

- **campaign-worker.ts**：监听队列 `campaign-queue`（可配置 `CAMPAIGN_QUEUE_NAME`）
- 收 job → 将 `ICampaignConfig` 转为内部 `CampaignConfig` → `nodeManager.allocate()` → 设置 SCRAPING → GENERATING → PUBLISHING → 执行完毕或异常时 `release`，异常时置 COOLING
- 后端只需往 `campaign-queue` 投递 `CampaignJobData`，Agent 不轮询、只消费队列

### 任务 2.4：反检测底座（browser-orchestrator）

- **Stealth**：`getStealthArgs()` 返回 Chrome 参数（如 `--disable-blink-features=AutomationControlled`），等价注入 puppeteer-extra-plugin-stealth 逻辑
- **指纹**：集成 `anti-detection`：User-Agent、viewport 从指纹池随机化；Canvas/WebGL 可后续在 page 内注入脚本扩展
- **人类化延迟**：`human-delay.ts` 正态分布延迟 `delayMs(min, max)` / `humanDelay(min, max)`，供点击、滑动、打字前调用；行为库可再接 human-cursor 贝塞尔轨迹

### 任务 2.5：手机号池与接码平台契约

- **ISmsActivateAdapter**（`sms-activate-adapter.ts`）：`getBalance()`、`getNumber(country, service)`、`getCode(activationId, options)`、`release(activationId)`；**withRetryAdapter** 包装后带异常重试
- **createSmsActivateAdapterStub**：基于 SMS-Activate 官方 API 的占位实现（需 `SMS_ACTIVATE_API_KEY`）；可替换为 5SIM 等实现同一 Interface
- **phone-pool**：`smsActivateToPhoneAdapter(sms)` 将 `ISmsActivateAdapter` 转为现有 `PhoneProviderAdapter`，接入现有 Node 分配流程

---

## 三、与后端（小明）的对接要点

1. **任务下发**：后端向 Redis 队列 `campaign-queue` 投递 job，data 为 `CampaignJobData`。Agent 进程内运行 `createCampaignWorker({ connection, nodeManager, nodePool, executeTask })` 即可消费。
2. **状态心跳**：Agent 每 5 分钟（或配置间隔）自检节点健康，并可通过后端提供的「带鉴权 WebSocket 或 REST 回调」上报 `NodeHeartbeatPayload`（见 contracts.ts）。
3. **战果回收**：线索（手机号/微信）由 Agent 通过**后端提供的内网 API** 回传；后端负责 AES 落库、租户、去重与 Webhook 推送。接口形状由后端在 PRD 中定义，Agent 按约定 POST。

---

## 四、文件清单（本次 Sprint 1 新增/修改）

| 路径 | 说明 |
|------|------|
| `src/shared/contracts.ts` | 新增：ICampaignConfig、NodeStatusEnum、CampaignJobData、NodeHeartbeatPayload |
| `src/agent/types.ts` | 增加 workflowState、NodeStatusEnum、cooling/banned 状态 |
| `src/agent/node-pool.ts` | setWorkflowState、allocate/release 时写 workflowState |
| `src/agent/health-monitor.ts` | 3 分钟无响应即判 unhealthy |
| `src/agent/workers/campaign-worker.ts` | 新增：BullMQ campaign-queue 消费者 |
| `src/agent/sms-activate-adapter.ts` | 新增：ISmsActivateAdapter、重试包装、SMS-Activate 占位实现 |
| `src/agent/phone-pool.ts` | smsActivateToPhoneAdapter 桥接 |
| `src/content/human-delay.ts` | 新增：正态分布人类化延迟 |
| `src/content/browser-orchestrator.ts` | 反检测配置、getUserAgent/getViewport/getStealthArgs、humanDelay |
| `src/content/anti-detection.ts` | 已有，未改 |

以上均已按 PM v1.3 与小明后端协议实现，可直接联调。
