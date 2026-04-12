# C&C WebSocket 协议 — 小军（Agent）侧「宪法四问」速查

**角色：** 小军 — 起草/执行 Agent 客户端与 PoC 脚本  
**传输：** Socket.io，命名空间 `/agent-cc`  
**完整版：** `docs/C&C_WebSocket_协议规范_v1.21.md` + `docs/C&C_WebSocket_协议规范_v1.20.md`（握手钉死）

---

## 1. 安全握手鉴权 (Handshake & Auth)

### 第一条「消息」怎么发？

**不是**先发一条 JSON 再鉴权。Socket.io 在 **TCP/WebSocket 升级之前** 会走一次 HTTP 长轮询/握手；**凭证必须放在握手阶段**，否则后端无法在进房前拒绝。

### Tenant-ID / 设备标识怎么带？

| 凭证 | 放哪里 | 内容 |
|------|--------|------|
| **租户身份** | `socket.auth.token` | **JWT**，Payload **驼峰** 必含 `tenantId`（及 `sub`、`exp` 等） |
| **设备物理/逻辑唯一码** | **HTTP Header** `x-machine-code` | MAC 或首启生成的 **持久化 UUID**，与库表 `ClientDevice.machine_code` 一致 |

**客户端示例（Node / Tauri 内同源）：**

```ts
io('http://localhost:3000/agent-cc', {
  auth: { token: JWT_STRING },
  extraHeaders: { 'x-machine-code': MACHINE_CODE },
  transports: ['websocket'],
});
```

*若 Node 里 `extraHeaders` 进不了 handshake，由小明定兜底：`auth.machineCode` 或 `query.machineCode`，并写回协议。*

### 后端如何拒绝非法连接？

1. **缺 token 或缺 machine_code** → 不 `join` 任何 room → **`disconnect(true)`**。  
2. **JWT 验签失败 / 过期 / 无 `tenantId`** → 同上，客户端收到 `connect_error`。  
3. **合法** → Upsert `ClientDevice` 为 **ONLINE** → `emit('server.system.ready', ...)`（兼容可同时发 `system.ready`）。

**Agent 侧验收：** 连上后必须先收到 `server.system.ready`（或 `system.ready`）再发业务心跳；收不到就视为握手失败，打日志 + 重连。

---

## 2. 心跳与保活 (Heartbeat & Keep-Alive)

| 层级 | 谁发 | 谁回 | 频率 / 超时 |
|------|------|------|-------------|
| **引擎层 Ping/Pong** | **服务端引擎** 发 Ping | **客户端** 自动 Pong | Socket.io 默认约 **25s Ping / 20s 超时**（以实际引擎为准） |
| **应用层健康心跳** | **客户端** 主动 emit | **服务端** 可选 callback 或静默落库 | **每 15s 一次** |

**应用层事件名（v1.21 钉死）：** `client.heartbeat`  

**Payload 示例：**

```json
{
  "cpu_usage": 45.2,
  "memory_usage_mb": 1024,
  "active_browsers": 2
}
```

**后端多久算 OFFLINE？**  
**45s 规则：** 连续 **3 个周期（3×15s）** 未收到 `client.heartbeat`（或引擎层已断）→ 将该 `machine_code` 置 **OFFLINE**，并触发 **BullMQ 任务挂起/重分配**（不在此文档展开，由小明实现）。

**Agent 实现要点：** `connect` 后 `setInterval(15s)` 发 `client.heartbeat`；`disconnect` 必须 `clearInterval`，重连后再启。

---

## 3. 核心业务 Event 命名空间 (RPC)

**约定：** 事件名 = **方向 + 域 + 动作**，全小写 + 点号，和 Socket.io 的 `on/emit` 一一对应。

| 方向 | 事件名 | 用途 |
|------|--------|------|
| **Server → Client** | `server.task.dispatch` | 云端下发任务；body 含 `campaign_id`、`action`、`config`（策略 JSON） |
| **Client → Server** | `client.task.ack` | **防丢**：收到 dispatch 并成功拉起环境后必须 Ack；**10s 内无 Ack 小明侧视为失败重试** |
| **Client → Server** | `client.node.status` | 状态机：`SCRAPING` / `COOLING` / `IDLE` / `GENERATING` / `PUBLISHING` 等，给前端大盘画灯 |
| **Client → Server** | `client.lead.report` | 战果上报；**body 与 `ILeadSubmissionPayload` 对齐**（`src/shared/contracts.ts`） |

**client.task.ack 示例：**

```json
{
  "campaign_id": "CAMP_17A9B3",
  "status": "ACCEPTED",
  "timestamp": 1710001000
}
```

**client.lead.report：**  
字段与 `ILeadSubmissionPayload` 一致（如 `tenant_id`、`campaign_id`、`contact_info`、`intention_score`、`source_platform` 等）；服务端用 **callback** 回 `{ "status": "ok", "continue": true|false }`，`continue: false` 时 Agent **必须熔断**当前 Campaign。

---

## 4. 离线 / 断网重连与 QoS

| 问题 | 小军侧必须怎么做 |
|------|------------------|
| **闪断时线索放哪？** | **禁止只放内存**。必须 **本地持久化队列**（SQLite / lowdb / 追加写文件），disconnect 时未 Ack 的 lead 全部入队。 |
| **连上后怎么补发？** | `connect` 且收到 `server.system.ready`（或等价就绪）后，**串行** `emit('client.lead.report', item, ack)`；**每条 Ack 成功后再从队列物理删除**。 |
| **QoS** | Socket.io 默认可视为 at-most-once；**计费防重复**靠 **`client_message_id`（UUID）+ 服务端幂等**；补发间隔建议 **≥500ms**，避免冲网关。 |
| **重连退避** | 与 socket.io-client `reconnectionDelay` 一致即可；JWT 过期需先刷新再连。 |

**PoC 参考实现：** `scripts/lobster-client-poc.ts`（内存队列演示；正式 Tauri 请换 SQLite）。

---

## 给小明的时间答复（代答 PM）

- **规范已定稿**：本速查 + `docs/C&C_WebSocket_协议规范_v1.21.md` **现在即可作为唯一依据**。  
- **Gateway 握手 + 收 `client.heartbeat`**：约 **0.5 天** 可本地起端口。  
- **dispatch + ack 超时 + lead.report 回调 + 计费锁平移**：约 **1～2 天** 与小军 PoC 联调闭环。  

**小军行动：** 已可切分支；PoC 脚本已就绪：`npm run poc:lobster`（需有效 JWT）。

---

**维护：** 小军 + 小明；变更请同步 v1.21 主文档与 Changelog。
