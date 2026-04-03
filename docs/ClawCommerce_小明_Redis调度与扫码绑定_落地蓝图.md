# ClawCommerce 小明侧落地蓝图 — Redis 调度中心 + 扫码绑定闭环

**角色：** 后端架构师（小明）  
**目标：** 四大调度法则 **不依赖 PG 扛派单查询**；高并发下 **毫秒级寻址** + **强一致防丢** + **断电熔断重分配**；Tauri 端 **微信扫码式** Onboarding。  
**关联：** `ClawCommerce_PM_v1.23_智能调度策略.md`、`ClawCommerce_PM_研发协同指令_v1.24.md`

---

## 一、法则 1 & 2：毫秒级寻址（租户隔离 + 负载均衡）

### 问题

BullMQ 每吐一个任务若 **SELECT PG 找空闲设备**，高并发下连接池与行锁会把数据库打爆。

### 方案：Redis Set 交集 + 随机抽取

小军客户端连上 WS 并上报 **IDLE** 时，小明在 Redis 维护：

| Redis Key | 类型 | 含义 |
|-----------|------|------|
| `tenant:{tenant_id}:devices` | **SET** | 该商家已绑定的全部 `device_id` |
| `status:IDLE` | **SET** | 当前全网处于 IDLE 的 `device_id` |

**派单时：**

1. `SINTER tenant:{tenant_id}:devices status:IDLE` → **毫秒级**得到该租户当前所有闲置龙虾。
2. 若结果非空：`SRANDMEMBER`（或 Round-Robin 用 LIST + LPOP）**随机抽一只**，避免总打同一台。
3. 通过该 `device_id` 映射到 **Socket 连接**，`emit('server.task.dispatch', payload)`。

**状态变更时（小军必须驱动 Redis 侧集合）：**

- 进入 IDLE：`SADD status:IDLE {device_id}`，并从 `status:BUSY` 等集合移除（若用多集合模型）。
- 进入 BUSY：`SREM status:IDLE {device_id}`，必要时 `SADD status:BUSY {device_id}`。
- 离线/45s 无 ping：从 `status:IDLE` / `status:BUSY` 中 **一律移除**，并更新 `tenant:*:devices` 仅表示「仍绑定」可不删，调度只信 **SINTER**。

> **原则：** PG 只做 **绑定关系与审计**；**实时可派单集合** 以 Redis 为唯一真相源。

---

## 二、法则 3：QoS 1 防丢锁（3s / 5s 统一建议）

### 问题

「任务发出去了，对方收没收到」—— 网络薛定谔态。

### 方案：Redis `SET key value EX NX` + 超时重试

dispatch 同一时刻写入 **短 TTL 锁**（与 v1.24 对齐：**3s** 为硬门槛；若曾设计 5s，以 **3s** 为准或二者取严）。

| 键示例 | 值 | TTL |
|--------|-----|-----|
| `task_ack:{job_id}` 或 `task_ack:{campaign_id}` | `device_id` / job 元数据 | **3s**（或 5s，二选一钉死） |

**分支 A（成功）：**  
小军 **3s 内** `client.task.ack` 且 `status: "ACCEPTED"` → 删除锁 → 设备切 **BUSY** → Redis IDLE 集合移除 → 扣费引擎待命。

**分支 B（黑洞）：**  
TTL 到期锁消失 → **Keyspace 通知 / 延时队列 / 定时扫描** 判定派单失败 → **BullMQ `job.retry()`** 或 **requeue 到队列前端**，换下一只 IDLE。

**REJECTED：**  
收到 `REJECTED_DUE_TO_LOAD`（或 v1.21 的 `REJECTED_RESOURCE_BUSY`）→ 不转 BUSY，立即 **换人重派**。

---

## 三、法则 4：断电熔断 + Dead-Letter 续传

### 场景

保洁拔电源 → BUSY 节点静默 → 任务不能死。

### 方案：Heartbeat Watcher（每 10s）

- **Cron / 微服务**：每 **10s** 扫描 **BUSY** 设备（或 Redis 中带 `last_heartbeat` 的 Hash）。
- **规则：** BUSY 且 **30s** 无有效 `client.ping`（或心跳）→ **强制 OFFLINE**，从 IDLE/BUSY 集合剔除。
- **补偿：** 查该设备当前 `campaign_id` / `job_id` → 发 **EmergencyReallocation**：
  - 任务以 **最高优先级（如 Priority: 1）** 重新进入 BullMQ **队列前端**；
  - 调度引擎按 **§一** 再次 `SINTER` → 另一只 IDLE 龙虾 **接力**（断点续传粒度由 campaign 状态机与 job 幂等定义）。

**与 v1.24 对齐：** 45s 无 ping 可做「通用离线」；**BUSY 路径 30s** 先熔断，符合 v1.23 法则 4。

---

## 四、DTO 与防线小结（小明侧已锁定）

| 契约事件 | 防线 |
|----------|------|
| `client.ping` | 15s 上报；45s 未更新 → Redis 状态抹除 + 有 job 则 retry/requeue |
| `server.task.dispatch` | 仅对 SINTER 得到的单台 emit；payload 含 `job_id` |
| `client.task.ack` | **3s** 内 ACCEPTED 才转 BUSY；否则锁过期即换人 |
| `client.lead.report` | 既有 AES + 计费锁；与 WS 契约一致 |

---

# 第二部分：Tauri 扫码授权 — 临时握手通道 + server.auth.success

**产品价值：** 商家零 API Key、零环境变量；手机一扫，电脑进龙虾池 —— **B2B Onboarding 壁垒**。

## 时序（技术流）

```
Tauri                          小明后端                         手机 Web
  |                                |                                |
  |-- MAC/device_id ------------->|                                |
  |-- POST bind-ticket ---------->|                                |
  |<-- ticket_id (5min) ----------|                                |
  |                                |                                |
  |  Redis: ticket:{id} -> MAC     |                                |
  |  展示大二维码                  |                                |
  |-- WS 临时连接 ticket_id ----->|  (房间/连接与 ticket 绑定)      |
  |                                |<-- POST confirm-bind ----------|
  |                                |    tenant_id + ticket_id       |
  |                                |  PG: 绑定 MAC -> tenant        |
  |                                |  签发 JWT                      |
  |<-- server.auth.success + JWT --|  (仅该临时 WS 通道)            |
  |                                |                                |
  |  销毁二维码 UI -> ✅ 已接入     |                                |
  |  keyring 存 JWT               |                                |
  |  后续重连 Header Bearer JWT -->|                                |
```

### 后端要点

1. **bind-ticket**  
   - 生成 `ticket_id`，**TTL 5 分钟** 存 Redis：`bind_ticket:{ticket_id}` → `{ device_id/MAC, created_at }`。  
   - 返回 Tauri：`ticket_id` 或二维码内容（URL 含 ticket）。

2. **Tauri 临时 WS**  
   - 连接时带 `ticket_id`（query 或首条消息），Gateway 把 **socket ↔ ticket** 挂接；**未 confirm 前**不进入租户 Room。

3. **confirm-bind**  
   - 校验 ticket 未过期 → 写 PG **ClientDevice 归属 tenant_id** → 生成 **长效 JWT**（含 `tenantId`、`device_id`）。  
   - 向 **该 ticket 绑定的 socket** 单独 `emit('server.auth.success', { token, ... })`。

4. **安全**  
   - ticket **一次性**：confirm 后 Redis 删除 ticket，防重放。  
   - JWT 由 Tauri 写入 **Keychain / Credential Manager**；业务 WS 只认 **Authorization: Bearer**。

### 小军（Tauri）要点

- 收到 `server.auth.success` → **立刻**关二维码 → 绿色呼吸灯「已接入」。  
- **Rust keyring** 写 JWT；重连从 keyring 读，**不写明文文件**。  
- 临时 WS 可在拿到 JWT 后断开，改连 **正式 agent-cc** 长连接。

---

## 五、Redis Key 命名速查（建议）

| Key | 用途 |
|-----|------|
| `tenant:{tid}:devices` | SET，租户设备池 |
| `status:IDLE` | SET，全局 IDLE |
| `task_ack:{job_id}` | STRING + TTL，Ack 防丢锁 |
| `bind_ticket:{ticket_id}` | STRING/HASH + TTL 300s，扫码前握手 |
| `device:{did}:last_ping` | STRING 时间戳 或 Hash 字段，Watcher 用 |

（实际以小明仓库 `src/websocket/` + 配置为准，本文作协同对齐。）

---

## 六、文档索引

| 文档 | 内容 |
|------|------|
| `ClawCommerce_PM_v1.23_智能调度策略.md` | 四法则业务语言 |
| `ClawCommerce_PM_研发协同指令_v1.24.md` | client.ping / dispatch / ack / bind-ticket 契约 |
| `C&C_协议规范_v1.23_调度增补.md` | Ack 与 BUSY 30s 与 v1.21 并存说明 |
| **本文** | Redis SINTER + 锁 + Watcher + 扫码临时 WS 工程蓝图 |

---

**小军确认：** 已吸收上述蓝图；客户端侧会 **每 15s client.ping**、**3s 内 ack**、IDLE/BUSY 切换时配合你更新 Redis 集合（若你改为全服务端维护集合，则我仅保证 ping/ack 准时可靠）。扫码流按 **bind-ticket → 临时 WS → server.auth.success → keyring** 实现。
