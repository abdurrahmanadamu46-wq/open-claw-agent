# ClawCommerce PM 文档 v1.23

## 龙虾池核心大脑：分布式多节点智能调度策略 (Smart Dispatching)

**致：** 小明（后端总控）与 小军（Agent 客户端）

**目标：** 当商家绑定 **5 台甚至 50 台**「龙虾」客户端时，云端调度引擎必须遵守下列 **4 大派单法则**，**禁止**：

- 两台设备跑同一任务（重复抓取/发帖）
- 任务派给已死机/离线设备

---

## 法则 1：租户隔离与资源池锁定 (Tenant Isolation)

| 维度 | 说明 |
|------|------|
| **业务规则** | 商家 A 创建的任务，**只能**下发给商家 A 扫码绑定过的龙虾。 |
| **技术实现（小明）** | BullMQ 消费任务时，**第一步**从 `ClientDevice` 圈定算力池：  
  `SELECT * WHERE tenant_id = :tenantId AND status = 'ONLINE'`  
  后续所有 dispatch 仅在该集合内选人，**禁止跨租户 emit**。 |

**验收：** 租户 B 的 WS 连接永远收不到租户 A 的 `server.task.dispatch`。

---

## 法则 2：状态感知与负载均衡 (State-Aware Routing)

| 维度 | 说明 |
|------|------|
| **业务规则** | 不能把任务派给**正在干活**的龙虾，必须派给**闲着**的。 |
| **技术实现（小明 & 小军）** | 小军通过 WebSocket **实时上报**节点状态，供调度器过滤： |

| 状态 | 含义 | 是否可派单 |
|------|------|------------|
| **IDLE** | 空闲 | ✅ 可派单 |
| **BUSY** | 忙碌（执行中） | ❌ 不可派单 |
| **COOLING** | 风控冷却中 | ❌ 不可派单（除非策略明确允许冷却池） |

**调度流程：**

1. 拿到该租户 **ONLINE** 设备列表。
2. **过滤** `current_status === IDLE`（或与协议中 `client.node.status` 对齐的等价字段）。
3. 若多台 IDLE：**Round-Robin** 或 **随机** 选一台，经该设备**独占**的 WebSocket 长连接 **`emit('server.task.dispatch', ...)`**。
4. **同一 campaign 同一时刻只绑定一台设备**（由 Redis 锁或 DB 唯一约束保证，见法则 3）。

---

## 法则 3：任务回执与防丢机制 (QoS 1 - ACK)

| 维度 | 说明 |
|------|------|
| **业务规则** | 云端下发后不能当甩手掌柜；必须确认龙虾**真的接单**，否则断线即任务黑洞。 |
| **技术实现（双端）** | |

1. **小明**：通过 WS 下发后，在 **Redis** 为该任务加 **Pending Lock**（建议 **TTL 5s**，与 v1.21 的 10s 无 Ack 重试可二选一或分层：5s 内未 Ack 即释放锁并 requeue）。
2. **小军**：收到 dispatch、JSON 解析无误后，**立即** `emit('client.task.ack', { campaign_id, status: 'ACCEPTED', ... })`。
3. **小明**：收到 ACK → 设备标 **BUSY**，任务进入执行态；**超时未 ACK** → 锁释放，任务 **打回 BullMQ**，由法则 2 再派给下一只 IDLE 龙虾。

**与协议对齐：** `client.task.ack` 载荷见 `docs/C&C_WebSocket_协议规范_v1.21.md` §3.2；`REJECTED_RESOURCE_BUSY` 时调度器应换机重试。

---

## 法则 4：死亡熔断与断点续传 (Dead-Letter Reallocation)

| 维度 | 说明 |
|------|------|
| **业务规则** | 龙虾 SCRAPING 到一半停电/断网，任务**不能死**，必须转移给其他在线龙虾。 |
| **技术实现（小明）** | |

1. **心跳监听**：若某台 **BUSY** 设备超过 **30s** 未收到应用层 `client.heartbeat`（或等价探活失败）→ 强制 **OFFLINE**（踢下线/标记不可用）。
2. **补偿**：查出该设备**正在执行**的 `campaign_id`（及 BullMQ job 关联），将任务状态重置，**重新入队** BullMQ。
3. **接力**：调度引擎按法则 1 + 2 从同租户 IDLE 池再派单，实现**断点续传/重跑**（具体「从哪一步续」由 campaign 状态机与 job 幂等设计决定，V1.23 先保证**不丢单、不双跑**）。

**与协议对齐：** v1.21 通用离线为 **45s**；v1.23 对 **BUSY** 路径收紧为 **30s** 可单独实现（例如 BUSY 节点用更短 heartbeat 超时）。

---

## 进阶商业化预留（V1.5）：「龙虾打标签」

跑通上述四法则后，为 `ClientDevice` 增加**标签**能力，例如：

- `overseas` — 海外宽带
- `domestic` — 国内宽带

前端发任务时可选择 **「仅调度海外标签」**，直接切入跨境电商 / TikTok 代运营场景。

**技术要点：** BullMQ 消费时 `WHERE tenant_id = A AND status = ONLINE AND 'overseas' = ANY(tags)`（实现以 ORM 为准）。

---

## 文档关系

| 文档 | 作用 |
|------|------|
| `C&C_WebSocket_协议规范_v1.21.md` | 事件名、Ack、heartbeat、node.status 载荷 |
| `C&C_小军侧协议速查_宪法四问.md` | 小军侧握手/心跳/重连速查 |
| **本文 v1.23** | 多节点调度**业务法则**与后端消费顺序 |

---

## 双端 Checklist（联调用）

| 角色 | 动作 |
|------|------|
| **小军** | 空闲时持续上报 `client.node.status` → `IDLE`；接单后 → `BUSY`/`SCRAPING`；收到 dispatch 后立即 `client.task.ack`。 |
| **小明** | Worker 只查本租户 ONLINE；只向 IDLE 派单；dispatch 后 Redis 锁 + 等 Ack；BUSY 掉线 30s 内 requeue。 |

**版本：** v1.23  
**状态：** 已写入仓库，与 C&C v1.21 并行生效；ACK TTL 与 BUSY 心跳阈值以最终实现为准，建议在 Gateway 配置中可配。
