# C&C 协议规范 v1.23 增补 — 与智能调度四法则对齐

本文是对 `C&C_WebSocket_协议规范_v1.21.md` 的**增量约定**，不重复全文。

## 1. client.node.status 与调度 IDLE/BUSY/COOLING

调度器以**最近一次** `client.node.status`（或心跳扩展字段）判定是否可派单：

```json
{
  "campaign_id": null,
  "current_status": "IDLE",
  "progress": null
}
```

| current_status | 调度行为 |
|----------------|----------|
| `IDLE` | 可参与 Round-Robin / 随机选取 |
| `BUSY` / `SCRAPING` / `GENERATING` / `PUBLISHING` | 不可派新单 |
| `COOLING` | 默认不可派单；若产品允许「冷却池」则单独策略 |

**小军：** 状态变化后应尽快上报，避免调度器基于陈旧 IDLE 误派。

---

## 2. ACK 超时与 Redis Pending Lock（QoS 1）

| 项目 | v1.21 | v1.23 PM 建议 |
|------|--------|----------------|
| 无 Ack 重试 | 10s 内无 Ack 视为失败重试 | 5s Redis 锁过期即释放并 **requeue** |
| 实现 | 二选一或并存：5s 锁释放 + 10s 总超时兜底 | 以小明 Gateway/BullMQ 配置为准 |

**约定：** `client.task.ack` 必须在收到 `server.task.dispatch` 后 **尽快** 发出；服务端以 **收到 Ack 的时刻** 将设备置 BUSY 并确认任务绑定。

---

## 3. BUSY 节点心跳熔断（30s）

| 场景 | 离线阈值 |
|------|----------|
| 一般 ONLINE 未执行任务 | 维持 v1.21：**45s** 无应用层 heartbeat → OFFLINE |
| **BUSY** 执行中节点 | v1.23：**30s** 无 heartbeat → 视为死亡，**requeue** 当前 campaign |

实现上可用同一 `client.heartbeat`，仅对「当前绑定 campaign 的设备」使用更短的 `last_heartbeat_at` 判定。

---

## 4. 防双跑（同一 campaign 单设备）

- 下发前：Redis `SET dispatch_lock:{tenantId}:{campaignId} {machineCode} NX EX <ttl>` 或 DB 唯一约束。
- 仅当 Ack 成功后再延长锁或写入「执行中设备」字段。
- 重分配前必须 **释放或覆盖** 旧绑定，避免两台同时执行。

---

## 5. 参考

- `docs/ClawCommerce_PM_v1.23_智能调度策略.md` — 四法则原文与产品语言
- `scripts/lobster-client-poc.ts` — Ack / heartbeat 联调示例
