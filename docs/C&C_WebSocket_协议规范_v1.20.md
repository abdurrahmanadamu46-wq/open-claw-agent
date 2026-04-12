# C&C WebSocket 协议数据格式规范 (JSON) — v1.20

**目的：** 对齐小明（Nest C&C Gateway）与小军（Agent 客户端 / Tauri-Electron）双端契约，避免先写壳后返工。  
**传输：** Socket.io，命名空间 **`/agent-cc`**。  
**安全：** 握手阶段必须同时校验 **JWT（租户身份）** 与 **x-machine-code（设备物理身份）**；缺一不可，防止伪造客户端抢任务或刷爆连接。

---

## 0. 握手鉴权契约（钉死 — 分布式算力池安全大门）

### 0.1 客户端连接时必须携带的凭证

小军的 Tauri / Node 脚本在 `io.connect()` 时 **必须** 同时带上：

| 凭证 | 位置 | 说明 |
|------|------|------|
| **Auth Token** | `client.handshake.auth.token` | 商家 JWT，由现有登录/签发接口下发 |
| **Machine Code** | `client.handshake.headers['x-machine-code']` | 本机 MAC 或 **持久化 UUID**（首启生成后写盘），全局唯一，对应库表 `ClientDevice.machine_code` |

- **禁止** 只带 JWT 不带 machine code：否则同一 JWT 可被多台假设备复用，无法绑定物理机。  
- **禁止** 只带 machine code 不带 JWT：否则任意人伪造机器码连入，无法归属租户。

### 0.2 JWT Payload 标准（驼峰 — 与库表下划线区分）

与数据库实体对齐时，**JWT 内统一驼峰**；落库仍用 `tenant_id`、`machine_code` 等下划线。

```json
{
  "sub": "user_uuid_here",
  "tenantId": "tenant_uuid_here",
  "planType": "PRO",
  "exp": 1710000000
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `sub` | 是 | 用户 UUID |
| `tenantId` | 是 | 租户 UUID；**WsGuard / AgentAuthService 以此 join 房间并 upsert 设备** |
| `planType` | 否 | 套餐，便于 C&C 侧限流或策略 |
| `exp` | 是 | Unix 秒，过期拒绝连接 |

服务端校验：`jwtService.verify(token, { secret: process.env.JWT_SECRET })`，取 `payload.tenantId`；缺失则 `UnauthorizedException` 并断开。

### 0.3 后端握手与设备自动注册（小明实现标准）

**模块：** `AgentAuthService.verifyAndRegisterDevice(client)`（或等价的 WsGuard + DeviceService）。

**流程（钉死）：**

1. 读取 `token = client.handshake.auth?.token`、`machineCode = client.handshake.headers['x-machine-code']`。  
2. 任一缺失 → `UnauthorizedException('Missing token or machine code')` → `client.disconnect(true)`。  
3. JWT 校验通过且 `tenantId` 存在 → 调用 **Upsert**：  
   - 该 `machine_code` 首次出现 → **新建** `ClientDevice`，绑定 `tenant_id`；  
   - 已存在 → 更新为 **ONLINE**，刷新最后上线时间。  
4. 成功则 `client.data = { tenantId, machineCode }`，`client.join('tenant_${tenantId}')`。  
5. 可选回执：v1.21 使用 **`server.system.ready`**（服务端 emit）；兼容旧客户端可保留 `system.ready`。

**鉴权失败：** 统一 `client.disconnect(true)`，不进入任何业务房间。

**网关入口（与小明片段一致）：**

```ts
async handleConnection(client: Socket) {
  try {
    const { tenantId, machineCode } = await this.agentAuthService.verifyAndRegisterDevice(client);
    client.data = { tenantId, machineCode };
    client.join(`tenant_${tenantId}`);
    client.emit('server.system.ready', { message: 'Connected to C&C Pool' });
  } catch {
    // 已在 verifyAndRegisterDevice 内断开
  }
}
```

**日志验收：**  
- 成功：`[Handshake Success] Device ${machineCode} registered for Tenant ${tenantId}`  
- 失败：`[Handshake Failed] ...`

---

## 1. 连接与房间（摘要）

| 项目 | 约定 |
|------|------|
| Namespace | `/agent-cc`；本地调试示例 **`ws://localhost:3000`** + 路径 **`/agent-cc`**（以小明实际端口为准） |
| 凭证 | **必须同时**：`auth.token`（JWT）+ **Header `x-machine-code`** |
| JWT | Payload **仅认驼峰** `tenantId`（及 `sub`、`exp` 等见 §0.2） |
| Agent 入室 | `client.join('tenant_${tenantId}')`；下发用 `targetMachineCode` 精确到单设备 |
| 前端大盘（画面探针） | 房间 `frontend_tenant_${tenantId}`，事件 `probe.render` |

### 1.1 小军首波连通性验收（Node 脚本）

小明 Gateway 监听后，小军可用 **socket.io-client** 发起第一波连接：

- URL：`http://localhost:3000/agent-cc`（或小明公布的 base + namespace）  
- `auth: { token: '<Mock JWT 含 tenantId>' }`  
- **必须** 把 **`x-machine-code`** 送进握手：若 Socket.io 客户端默认不把自定义头写入 `handshake.headers`，小明应在网关侧同时支持 **`auth.machineCode`** 或 **`query.machineCode`** 作为兜底，并在文档中钉死最终实现方式（建议最终仍统一到 headers，便于中间层透传）。  

**验收标准：**  
- 客户端收到 **`system.ready`**；  
- 服务端控制台 **`[Handshake Success]`**；  
- 数据库 `client_devices` 出现对应 `machine_code` + `tenant_id`，`status = ONLINE`。

**Node 脚本示例（socket.io-client）：**

```js
// npm i socket.io-client
const { io } = require('socket.io-client');
const JWT = process.env.MOCK_JWT || 'eyJhbGciOiJIUzI1NiJ9...'; // 需含 tenantId
const MACHINE_CODE = process.env.MACHINE_CODE || 'test-machine-uuid-001';

const socket = io('http://localhost:3000/agent-cc', {
  auth: { token: JWT },
  // 部分环境需用 extraHeaders 才能进 handshake.headers（与小明确认）
  extraHeaders: { 'x-machine-code': MACHINE_CODE },
  transports: ['websocket'],
});

socket.on('connect', () => console.log('connected', socket.id));
socket.on('system.ready', (d) => console.log('system.ready', d));
socket.on('disconnect', (r) => console.log('disconnect', r));
socket.on('connect_error', (e) => console.error('connect_error', e.message));
```

---

## 2. 客户端 → 服务端（Agent 上报）

### 2.1 `heartbeat`

**频率建议：** 每 **10s**（与 PRD 一致，可 5–15s 可配）。

```json
{
  "health_status": {
    "cpuPercent": 42,
    "memoryPercent": 68,
    "networkLatencyMs": 120,
    "platforms": ["wechat", "douyin"]
  }
}
```

- 服务端：`deviceService.recordHeartbeat(machineCode, payload.health_status)`，更新 `last_health_status`、`last_heartbeat_at`、`status`（若当前非 BUSY/UPDATING 可置 ONLINE）。

---

### 2.2 `lead.report`

**语义：** 战果回收；服务端走 V1.13 悲观锁扣费，返回是否继续抓取。

**请求 body 示例：**

```json
{
  "lead_id": "LD_xxx",
  "campaign_id": "CAMP_yyy",
  "contact_info_masked": "138****0000",
  "intent_score": 92,
  "captured_at": "2026-03-10T12:00:00.000Z",
  "raw_payload": {}
}
```

**Ack（服务端 → 本次 invoke 的 callback 或单独 emit）：**

```json
{
  "status": "ack",
  "continue": true
}
```

- `continue: false`：余额不足等，Agent 应停止当前 Campaign 或进入冷却。

---

### 2.3 `probe.stream`（远程画面探针）

**语义：** Agent 将当前 Playwright 截图发给服务端，服务端 **Relay** 到前端房间，不在此落库（可选后续审计再存）。

**body 建议二选一：**

- **A. Base64（易调试）**

```json
{
  "format": "jpeg",
  "data": "<base64 string>"
}
```

- **B. 二进制**  
  Socket.io 支持 binary；若用二进制，建议首包带 meta JSON，或统一用 base64 首版避免分帧复杂度。

**服务端转发：**

```ts
// 小明已有逻辑
this.server.to(`frontend_tenant_${tenantId}`).emit('probe.render', {
  machineCode,
  image: imageBuffer // 或 { format, data }
});
```

**前端订阅事件名：** `probe.render`

---

## 3. 服务端 → 客户端（总控下发）

### 3.1 `task.dispatch`

**语义：** BullMQ 找到可用设备后，向租户房间广播；**只有 `targetMachineCode` 匹配的 Agent 应消费**。

```json
{
  "targetMachineCode": "MAC_OR_UUID_AS_MACHINE_CODE",
  "campaignId": "CAMP_xxx",
  "config": {
    "industry_template_id": "15秒故事带货",
    "target_urls": [],
    "content_strategy": {},
    "publish_strategy": {}
  },
  "commandId": "cmd_uuid_optional"
}
```

- Agent 收到后若 `machineCode !== targetMachineCode` 则忽略。  
- 执行中 Agent 应将本地状态置 BUSY；完成后heartbeat 恢复或发 `task.ack`。

---

### 3.2 `task.ack`（可选，客户端 → 服务端）

Agent 执行完或失败时上报，便于总控释放设备、BullMQ 完成 job。

```json
{
  "commandId": "cmd_uuid_optional",
  "campaignId": "CAMP_xxx",
  "ok": true,
  "error": null
}
```

（若小明首版只做单向 dispatch，可二期再加。）

---

## 4. 离线容错（与 BullMQ 对齐）

| 情况 | 行为 |
|------|------|
| 无 ONLINE 且非 BUSY 设备 | Worker `throw new Error('DEVICES_OFFLINE_OR_BUSY')`，任务延迟重试 / 指数退避 |
| 设备断线 | `handleDisconnect` → `OFFLINE`；进行中任务由小明策略决定：超时回队列或标记失败 |

---

## 5. 建议落地顺序（回答小明的问题）

1. **先冻结本页协议**（event 名 + JSON 字段），小明 Gateway 按此实现 `heartbeat` / `lead.report` / `probe.stream` / `task.dispatch`。  
2. **小军并行**：Tauri/Electron 壳子 + 仅实现 **连接 + JWT + heartbeat** 循环，用 **本地 Node 脚本 + socket.io-client** 模拟 `task.dispatch` 验证房间与 targetMachineCode 过滤。  
3. **再接** `lead.report` 与计费 ack，最后 **probe.stream** + 前端 `probe.render` 订阅。

这样不需要等完整客户端也能做 **WS 握手与 task.dispatch 连通性**；协议一旦变更有文档可 diff。

---

## 6. 与现有前端的衔接

- Fleet / MQTT 可与 C&C **并行**：MQTT 适合海量 Pub/Sub；Socket.io 适合 **强会话 + ack +  probe 中继**。后续可由小明统一只保留 WS，或 MQTT 仅作状态、WS 作指令。  
- `web/src/types` 中 `RemoteNode`、`TaskCommand` 的字段可与 `last_health_status`、`task.dispatch.config` 对齐，减少二义性。

---

**文档路径：** `docs/C&C_WebSocket_协议规范_v1.20.md`  
**维护：** 小丽 PM；实现变更请同步改版本号与 changelog。

---

## 7. v1.21 核心生命周期（RPC 风格事件命名 — 宪法级）

**原则：** Socket.io 事件名为 **点分 RPC 风格**，一眼区分方向与域；实现上即为 `socket.on('server.task.dispatch', ...)` / `socket.emit('client.lead.report', ...)`。  
**兼容：** 过渡期可对旧事件名 `task.dispatch` / `heartbeat` 做别名转发，PoC 建议 **只实现 v1.21 命名**，避免双栈。

### 7.1 安全握手鉴权（小结）

- **不是**「第一条业务消息里带 Token」；**是**连接 **握手阶段**（HTTP Upgrade 前）携带：  
  - `auth.token` = JWT（含 `tenantId`）  
  - `headers['x-machine-code']` = 设备唯一码  
- **非法连接：** 缺任一凭证或 JWT 无效 → **立即 `disconnect(true)`**，不进入任何 room。  
- **握手成功后第一条服务端推送：** **`server.system.ready`**（v1.21 正式名）；兼容可继续发 `system.ready`。

### 7.2 心跳与保活（Ping / Pong）

| 项目 | 约定 |
|------|------|
| **谁发** | **客户端**主动发心跳（Agent 侧定时）；服务端可 **不** 主动 Ping，以减轻 C&C 负载 |
| **事件名（建议）** | `client.node.ping` — body 含 `health_status`（同 §2.1）；服务端可 `emit('server.node.pong', { ts })` 作 ACK（可选） |
| **频率** | **15s**（PM 建议；与 PRD 10s 二选一后钉死，PoC 可用 15s） |
| **服务端离线判定** | **45s 未收到** 该 `machineCode` 的任何 `client.node.ping`（或旧名 `heartbeat`）→ 将设备标为 **OFFLINE**，并触发 BullMQ 任务挂起/重分配（与 §4 一致） |
| **Socket.io 层 keepalive** | 依赖引擎 ping/pong；**业务心跳仍必须**，否则无法带上 CPU/内存等指标 |

**client.node.ping body 示例：**

```json
{
  "health_status": {
    "cpuPercent": 40,
    "memoryPercent": 65,
    "networkLatencyMs": 80,
    "platforms": ["wechat"]
  }
}
```

### 7.3 核心业务 Event 命名空间（RPC）

| 方向 | 事件名 | 说明 |
|------|--------|------|
| **Server → Client** | **`server.task.dispatch`** | 云端下发任务；body 含 `targetMachineCode`、`campaignId`、`config`（同 §3.1） |
| **Client → Server** | **`client.task.ack`** | 客户端确认收到任务，防丢；body 含 `commandId`、`campaignId`、`receivedAt` |
| **Client → Server** | **`client.node.status`** | 实时状态：`SCRAPING` / `COOLING` / `IDLE` / `BUSY` 等，供前端大盘画灯 |
| **Client → Server** | **`client.lead.report`** | 线索回传；**body 必须与 `ILeadSubmissionPayload` 对齐**（见仓库 `src/shared/contracts.ts`） |

**server.task.dispatch** 与 §3.1 JSON 一致，仅事件名改为 RPC。  

**client.lead.report** 与计费锁：服务端处理完后 **Ack** 建议事件 **`server.lead.ack`**，body：`{ continue: boolean }`（同原 `lead.report` ack）。

**client.task.ack 示例：**

```json
{
  "commandId": "cmd_xxx",
  "campaignId": "CAMP_yyy",
  "receivedAt": "2026-03-10T12:00:00.000Z"
}
```

**client.node.status 示例：**

```json
{
  "state": "SCRAPING",
  "campaignId": "CAMP_yyy",
  "message": "正在抓取评论页 3/10"
}
```

### 7.4 离线 / 断网重连与 QoS

| 场景 | 策略 |
|------|------|
| **断网瞬间新产生的线索** | 客户端 **本地落盘队列**（SQLite/LevelDB/JSON 文件），**不丢**；禁止仅内存持有 |
| **重连后** | 按 **FIFO** 补发 `client.lead.report`；每条带 `client_message_id`（UUID）防服务端重复扣费 |
| **QoS** | Socket.io 默认可视为 at-most-once；**线索类**必须由 **client_message_id + 服务端幂等** 保证 at-least-once 不重复计费 |
| **重连退避** | 1s → 2s → 4s … 上限 60s；JWT 过期则刷新 Token 再连 |

**补发载荷建议增加字段：**

```json
{
  "client_message_id": "uuid-v4",
  "retried": false,
  "...ILeadSubmissionPayload"
}
```

---

**Changelog**  
- v1.20.1：钉死握手契约 — `auth.token` + `headers['x-machine-code']`；JWT Payload 驼峰；`system.ready`；Node 验收脚本。  
- **v1.21**：PM 研发协同指令 + §7 生命周期 — RPC 事件名、`client.node.ping` 15s、45s 离线、`client.lead.report` 对齐 `ILeadSubmissionPayload`、断网队列与 `client_message_id` 幂等。
