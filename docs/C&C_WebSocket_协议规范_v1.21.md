# ClawCommerce C&C WebSocket 协议规范 v1.21

**Endpoint：**  
- 生产：`wss://api.clawcommerce.com/agent-cc`  
- 本地：`http://localhost:3000/agent-cc`（Socket.io 握手用 **http/https**，非纯 `ws://` URL）

---

## 1. 安全握手鉴权 (Handshake & Auth)

所有 Agent 必须通过 **Socket.io** 连接，在**建立连接的初始化阶段**传递鉴权参数。

### 连接参数

```js
const socket = io('http://localhost:3000/agent-cc', {
  auth: { token: 'eyJhbGciOiJIUzI1...' }, // 租户 JWT，Payload 须含 tenantId（驼峰）
  extraHeaders: {
    'x-machine-code': 'MAC-A1-B2-C3-D4-E5' // 设备唯一标识（MAC 或持久化 UUID）
  },
  transports: ['websocket'],
});
```

### 后端拦截规则

| 条件 | 行为 |
|------|------|
| Token 无效 / 过期 / 无 `tenantId` | `UnauthorizedException`，**断开**（`connect_error` 或升级失败） |
| 鉴权成功 | Upsert `ClientDevice`，状态 **ONLINE**，并向客户端下发 **`server.system.ready`**（若小明仍发 `system.ready`，客户端应双监听以兼容） |

---

## 2. 心跳与保活 (Heartbeat & Keep-Alive)

**双机制：**

| 层级 | 说明 |
|------|------|
| **底层探活** | Socket.io 内置 Ping/Pong（默认约 25s ping / 20s timeout，以引擎为准） |
| **应用层心跳** | **Client → Server**，事件 **`client.heartbeat`**，**每 15s** |

### client.heartbeat Payload

```json
{
  "cpu_usage": 45.2,
  "memory_usage_mb": 1024,
  "active_browsers": 2
}
```

### 后端离线判定（45s Rule）

连续 **3 个周期（45s）** 未收到应用层 `client.heartbeat`（或未收到底层 Pong 视为断线）→ 设备标为 **OFFLINE**；若该节点正在执行任务 → 触发 BullMQ **重分配/挂起**。

---

## 3. 核心业务 Event 命名空间 (RPC)

### 3.1 server.task.dispatch（云端 → 客户端）

```json
{
  "campaign_id": "CAMP_17A9B3",
  "action": "START_SCRAPING",
  "config": {
    "industry_template_id": "15秒故事带货",
    "target_urls": ["https://..."],
    "content_strategy": { "min_clips": 5, "max_clips": 9 }
  }
}
```

多设备时服务端仍可通过 `targetMachineCode` 区分（与 v1.20 §3.1 兼容）。

### 3.2 client.task.ack（客户端 → 云端）

收到下发并成功拉起无头浏览器后 **必须** Ack；**10s 内无 Ack** 后端视为下发失败并重试。

```json
{
  "campaign_id": "CAMP_17A9B3",
  "status": "ACCEPTED",
  "timestamp": 1710001000
}
```

`status` 也可为 `REJECTED_RESOURCE_BUSY`。

### 3.3 client.node.status（客户端 → 云端）

供 Dashboard 状态灯使用。

```json
{
  "campaign_id": "CAMP_17A9B3",
  "current_status": "SCRAPING",
  "progress": "已采集 15/20 个对标账号"
}
```

`current_status`：`IDLE` | `SCRAPING` | `GENERATING` | `PUBLISHING` | `COOLING` 等。

### 3.4 client.lead.report（战果回收）

复用 **`ILeadSubmissionPayload`**（`src/shared/contracts.ts`），示例：

```json
{
  "campaign_id": "CAMP_17A9B3",
  "contact_info": "13812341234",
  "intention_score": 85,
  "source_platform": "douyin"
}
```

**Ack 回调（Socket.io callback）：** `{ "status": "ok", "continue": true }` 或 `false`。`continue: false` 时客户端必须**立即挂起**当前任务（余额不足等）。

---

## 4. 离线 / 断网重连 (Zero Data Loss)

| 策略 | 说明 |
|------|------|
| **断网暂存** | 所有新线索与关键日志写入 **本地队列**（SQLite / lowdb / 文件） |
| **重连补偿** | `connect` 且收到 `server.system.ready`（或等价就绪信号）后，**串行** `emit('client.lead.report', ..., ack)`，**每条等 Ack 成功后再删本地** |
| **并发** | 补发间隔建议 ≥500ms，避免冲垮网关 |

---

## 5. 联调验收

1. 后端 Gateway 启用 `/agent-cc`，放行 `auth.token` + `x-machine-code`。  
2. 运行 `npx tsx scripts/lobster-client-poc.ts`（需配置真实 MOCK_JWT）。  
3. 终端应出现连接成功 + 每 15s 心跳；服务端可 `emit('server.task.dispatch', ...)` 验证 Ack 与 lead.report Ack。

**脚本路径：** `scripts/lobster-client-poc.ts`

---

## 6. PM v1.24 信封与扫码绑定（协同指令）

统一信封 `{ "event", "payload" }`、`client.ping`（15s / 45s 离线）、`server.task.dispatch` 带 **`job_id`**、**3s 内** `client.task.ack`，以及 Tauri **bind-ticket → confirm-bind → server.auth.success** 与 JWT 凭据存储，见：

- `docs/ClawCommerce_PM_研发协同指令_v1.24.md`

---

## 7. 多节点调度（PM v1.23）

多设备场景下的**租户隔离、IDLE 过滤、ACK 锁、BUSY 掉线重分配**见（v1.24 将 Ack 收紧为 3s 时以 v1.24 为准）：

- `docs/ClawCommerce_PM_v1.23_智能调度策略.md`
- `docs/C&C_协议规范_v1.23_调度增补.md`
