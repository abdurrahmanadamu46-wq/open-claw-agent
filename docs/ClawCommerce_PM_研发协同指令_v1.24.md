# ClawCommerce PM 研发协同指令 v1.24

**主题：** C&C 分布式架构 — **WebSocket 调度协议** 与 **客户端授权闭环**  
**致：** 小明（后端总控）· 小军（Tauri / Agent 客户端）  
**小军复述：** 下面全文即 v1.24 契约；实现时以本文 + `src/websocket/` 代码为单一真相，v1.21 事件可并行兼容至迁移完成。

---

## 总则

- **后端**：在 **`src/websocket/`** 下按 **统一 JSON 信封** `{ "event", "payload" }` 实现收发；BullMQ 消费到新任务后，只对**本租户 + IDLE** 节点派发。
- **客户端**：Tauri 面向零代码商家 —— **禁止**手填 API Key；绑定流程对标「微信扫码登录」；JWT **必须**进系统安全存储，重连时 **Handshake 带 Bearer**。

---

# 第一部分：给后端（小明）的《多节点 WebSocket 调度契约》

总控靠 **严谨 JSON + 状态机** 指挥龙虾池；所有业务消息建议统一为：

```json
{
  "event": "<命名空间>",
  "payload": { }
}
```

Socket.io 实现可为：**事件名仍用 `client.ping`**，body 为整包；或 **单一事件 `message`** + body 内 `event` 字段 —— **二选一钉死**，避免双解析。

---

## 1. 客户端上报：心跳与状态同步 — `client.ping`

| 项 | 约定 |
|----|------|
| **频率** | 客户端 **每 15 秒** 发送一次 |
| **后端** | 超过 **45 秒** 未收到 → 设备 **OFFLINE**，并 **回收未完成**任务（重入队 / 释放锁，与 v1.23 法则 4 一致） |

```json
{
  "event": "client.ping",
  "payload": {
    "device_id": "MAC_A1_B2_C3_D4",
    "status": "IDLE",
    "metrics": { "cpu": 45, "ram": "2.4GB" }
  }
}
```

- `status`：**`IDLE` | `BUSY` | `COOLING`**（调度只从 IDLE 池派单，见 v1.23）。
- **与 v1.21 兼容**：若线上仍有 `client.heartbeat`，建议 Gateway **同时订阅**或 **15s 内任收其一即刷新 `last_seen`**，迁移期后只保留 `client.ping`。

---

## 2. 服务端下发：派发抓取/二创任务 — `server.task.dispatch`

| 项 | 约定 |
|----|------|
| **触发** | BullMQ 消费到新任务，且本租户存在 **在线 + IDLE** 节点 |
| **派发** | 经该节点 **独占 WebSocket** 下发（禁止广播到多机导致双跑） |

```json
{
  "event": "server.task.dispatch",
  "payload": {
    "job_id": "JOB_99812",
    "campaign_id": "CAMP_17A9B3",
    "action": "EXECUTE_CAMPAIGN",
    "config": { }
  }
}
```

- `config`：**完整的 `ICampaignConfig` JSON**（与现有 Campaign 配置结构一致，字段以代码/types 为准）。
- 若仍使用 Socket.io 原生 `emit('server.task.dispatch', payload)`，则 **payload 内必须含 `job_id`**，与下节 Ack 对齐。

---

## 3. 客户端回执：接单确认 — `client.task.ack`（防丢）

| 项 | 约定 |
|----|------|
| **时限** | 节点收到派单后 **必须在 3 秒内**回复（比 v1.21 的 10s 更严；Redis 锁建议 TTL ≤ 3～5s） |
| **后端** | 收到 Ack 后 **再在 Redis 扣除该节点空闲态**（置 BUSY / 绑定 job_id），未收到则锁释放、任务回队列 |

```json
{
  "event": "client.task.ack",
  "payload": {
    "job_id": "JOB_99812",
    "status": "ACCEPTED"
  }
}
```

- `status`：**`ACCEPTED`** 或 **`REJECTED_DUE_TO_LOAD`**（与 v1.21 的 `REJECTED_RESOURCE_BUSY` 语义等价，命名以 v1.24 为准或双接受）。

---

## 4. 客户端上报：线索回传与任务进度 — `client.lead.report`

| 项 | 约定 |
|----|------|
| **动作** | 客户端抓到线索经 **WS 直推**后端 |
| **后端** | **AES 加密存储** + **计费锁扣费**（与现有线索结构复用，如 `ILeadSubmissionPayload`） |

信封与 v1.21 一致即可，例如：

```json
{
  "event": "client.lead.report",
  "payload": { }
}
```

`payload` 内字段与小明侧计费/落库契约钉死；需 Ack 回调时保持 v1.21 的 callback 语义。

---

## 小明实现清单（`src/websocket/`）

1. 入站：`client.ping` → 更新 `ClientDevice.last_seen`、`status`、`metrics`。  
2. 入站：`client.task.ack` → 按 `job_id` 确认绑定，Redis 扣 IDLE。  
3. 入站：`client.lead.report` → 加密 + 扣费 + 持久化。  
4. 出站：BullMQ Worker 调 `server.task.dispatch`（带 `job_id` + `campaign_id` + `config`）。  
5. 离线：45s 无 `client.ping` → OFFLINE + 未完成任务回收。

---

# 第二部分：给前端/客户端（小军）的《Tauri 扫码授权交互流》

目标：**商家零配置** —— 不输入 API Key / Token；体验对齐扫码登录。

---

## 1. 交互流程（The Binding Flow）

### Step 1：客户端就绪（Tauri）

1. 商家双击打开 ClawCommerce 客户端。  
2. 客户端用 **主板序列号或 MAC** 生成唯一 **`device_id`**（与协议里 `device_id` / `x-machine-code` 对齐）。  
3. **REST**：`POST /api/v1/devices/bind-ticket`  
   - 后端返回 **5 分钟有效** 的 **ticket**（及短链或二维码内容）。  
4. Tauri **全屏中央**渲染 **大二维码**（内容 = ticket 或短链 URL，与小明约定）。

### Step 2：商家扫码授权（Web 控制台）

1. 商家手机登录 **移动端适配页**：控制台 → 设备大盘 → **添加设备**。  
2. 调起摄像头 **扫 Tauri 屏幕上的码**。  
3. **REST**：`POST /api/v1/devices/confirm-bind`  
   - Body 带：**当前登录 `tenant_id`** + **二维码中的 ticket**。  
4. 后端将 **`device_id` 归属到该 `tenant_id`**（写 `ClientDevice` 或等价表）。

### Step 3：WebSocket 鉴权放行（全自动握手）

1. 后端在 DB 完成绑定后，通过 **已连接的 WebSocket**（该 `device_id` 若已连则推；若未连则下次握手凭 ticket 换 JWT）推送：  
   - **`server.auth.success`**  
   - 并下发 **长效 JWT**（payload 含 `tenantId`、`device_id` 等）。  
2. **Tauri UI**：二维码消失 → **绿色 ✅「设备已成功接入龙虾池」** → 跳转 **简易监控页**（CPU 占用 + 文案「等待云端指令…」）。

---

## 2. 安全底线（小军必须做到）

| 项 | 要求 |
|----|------|
| **JWT 存储** | **禁止**明文落盘；必须写入 **OS 安全凭据管理器**（Windows Credential Manager / macOS Keychain；Linux 用 libsecret 等）。 |
| **重连** | 每次 WS 握手在 **Header** 中携带：`Authorization: Bearer <Token>`，供后端校验。 |
| **断线** | 重连前从凭据管理器读取 Token；失效则回到 Step 1 重新扫码绑定流。 |

---

## 小军实现清单（Tauri）

1. `device_id` 生成与持久化（与后端 bind-ticket 请求体一致）。  
2. `POST .../bind-ticket` → 展示二维码；轮询或 WS 等 `server.auth.success`。  
3. 收到 JWT → **写入 Keychain/Credential Manager**；后续 `io(url, { extraHeaders: { Authorization: 'Bearer ...' } })` 或与小明统一为 `auth: { token }`。  
4. **每 15s** 发 `client.ping`；收到 `server.task.dispatch` → **3s 内** `client.task.ack`；执行中发 `client.lead.report`。  
5. 无扫码绑定前：**不**把长效 Token 写进普通文件。

---

## 文档关系

| 文档 | 作用 |
|------|------|
| **本文 v1.24** | 调度信封 + 3s Ack + bind-ticket / confirm-bind / server.auth.success + JWT 安全存储 |
| `ClawCommerce_小明_Redis调度与扫码绑定_落地蓝图.md` | **小明已拍板**：Redis SINTER/SRANDMEMBER、Ack 锁 TTL、10s Watcher + 30s BUSY 熔断、EmergencyReallocation、临时 WS 扫码通道 |
| `C&C_WebSocket_协议规范_v1.21.md` | 握手 `x-machine-code`、lead.report Ack、离线 45s（与 client.ping 对齐） |
| `ClawCommerce_PM_v1.23_智能调度策略.md` | IDLE 池、防双跑、BUSY 熔断与重入队 |

---

**版本：** v1.24  
**小军确认：** 以上即 PM 研发协同指令全文复述；小明按 `src/websocket/` 与 REST 两条线落地，小军按 Tauri 扫码 + 凭据存储落地，联调以 `job_id` + `client.task.ack` 3s 为硬门槛。
