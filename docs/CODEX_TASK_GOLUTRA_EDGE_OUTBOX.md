# CODEX TASK: 边缘消息发件箱 + 批量分发（借鉴 Golutra chat_outbox + batcher）
**任务ID**: CODEX-GOLUTRA-OUTBOX-P1-002  
**优先级**: 🔴 P1（云→边消息可靠投递）  
**依赖文件**: `dragon-senate-saas-v2/bridge_protocol.py`  
**参考项目**: Golutra（orchestration/chat_outbox.rs + chat_dispatch_batcher.rs）  
**预计工期**: 1天

---

## 一、核心概念

### Outbox 模式（发件箱）
云端龙虾生成的下发消息 → **先写入 DB（outbox 表）** → 后台线程异步投递 → 边缘 ACK 后标记 delivered → 超时自动重试

### Batcher 模式（批量合并）
同一边缘节点在 1 秒内的多条消息 → **合并成一个批次包** → 一次 WSS 发送 → 减少连接压力

### 当前痛点
`bridge_protocol.py` 直接 WSS 发送，如果边缘断连消息直接丢失，没有持久化保证。

---

## 二、实现代码

```python
# dragon-senate-saas-v2/edge_outbox.py（新建）
"""
边缘消息发件箱（Outbox Pattern + Batcher）

保证云端→边缘消息的至少一次投递（at-least-once delivery）

流程：
  龙虾/调度器 → write_to_outbox() → DB持久化
  后台flush线程 → 按node_id分组 → 批量WSS发送
  边缘ACK → mark_delivered()
  超时 → 自动重试（最多3次，指数退避）
"""

import asyncio
import json
import time
import logging
from dataclasses import dataclass, field
from typing import Optional
from collections import defaultdict
from uuid import uuid4

logger = logging.getLogger("edge_outbox")


@dataclass
class OutboxEntry:
    outbox_id: str
    tenant_id: str
    node_id: str
    msg_type: str           # task_dispatch / config_update / lobster_command
    payload: dict
    status: str = "pending"  # pending → sending → delivered → failed
    retry_count: int = 0
    max_retries: int = 3
    created_at: float = 0.0
    next_retry_at: float = 0.0


class EdgeOutbox:
    """
    边缘消息发件箱

    用法：
        outbox = EdgeOutbox(wss_sender=bridge_protocol.send_to_edge)
        
        # 写入（龙虾/调度器调用）
        await outbox.enqueue("tenant-1", "node-001", "task_dispatch", {...})
        
        # 后台投递（启动时开启）
        asyncio.create_task(outbox.flush_loop())
        
        # 边缘ACK回调
        await outbox.ack("outbox-id-xxx")
    """

    def __init__(self, wss_sender=None, flush_interval: float = 1.0,
                 batch_size: int = 50):
        self.wss_sender = wss_sender      # async def send(node_id, batch_payload)
        self.flush_interval = flush_interval
        self.batch_size = batch_size
        # 内存存储（生产环境替换为 DB）
        self._entries: dict[str, OutboxEntry] = {}
        self._running = False

    async def enqueue(self, tenant_id: str, node_id: str,
                      msg_type: str, payload: dict) -> str:
        """写入发件箱（持久化，保证不丢失）"""
        entry = OutboxEntry(
            outbox_id=f"outbox-{uuid4().hex[:12]}",
            tenant_id=tenant_id,
            node_id=node_id,
            msg_type=msg_type,
            payload=payload,
            created_at=time.time(),
            next_retry_at=time.time(),
        )
        self._entries[entry.outbox_id] = entry
        logger.info(f"Outbox enqueued: {entry.outbox_id} → {node_id}/{msg_type}")
        return entry.outbox_id

    async def ack(self, outbox_id: str):
        """边缘确认收到（标记 delivered）"""
        entry = self._entries.get(outbox_id)
        if entry:
            entry.status = "delivered"
            logger.info(f"Outbox ACK: {outbox_id}")

    async def flush_loop(self):
        """后台投递循环"""
        self._running = True
        while self._running:
            await self._flush_once()
            await asyncio.sleep(self.flush_interval)

    async def _flush_once(self):
        """一次投递：取出 pending 消息，按 node_id 分组批量发送"""
        now = time.time()
        
        # 取出可投递的消息
        pending = [
            e for e in self._entries.values()
            if e.status in ("pending", "sending")
            and e.next_retry_at <= now
            and e.retry_count <= e.max_retries
        ]
        
        if not pending:
            return
        
        # 按 node_id 分组（Batcher 逻辑）
        grouped: dict[str, list[OutboxEntry]] = defaultdict(list)
        for entry in pending[:self.batch_size]:
            grouped[entry.node_id].append(entry)
        
        # 按节点批量发送
        for node_id, entries in grouped.items():
            batch_payload = {
                "type": "batch_delivery",
                "items": [
                    {
                        "outbox_id": e.outbox_id,
                        "msg_type": e.msg_type,
                        "payload": e.payload,
                    }
                    for e in entries
                ],
                "count": len(entries),
            }
            
            try:
                for e in entries:
                    e.status = "sending"
                
                if self.wss_sender:
                    await self.wss_sender(node_id, batch_payload)
                
                logger.info(f"Batch sent to {node_id}: {len(entries)} items")
                
            except Exception as ex:
                logger.warning(f"Batch send failed for {node_id}: {ex}")
                for e in entries:
                    e.status = "pending"
                    e.retry_count += 1
                    # 指数退避：2^retry * 5秒
                    e.next_retry_at = now + (2 ** e.retry_count) * 5
        
        # 清理已投递/超过重试上限的消息
        expired = [
            oid for oid, e in self._entries.items()
            if e.status == "delivered"
            or (e.retry_count > e.max_retries and e.status != "delivered")
        ]
        for oid in expired:
            entry = self._entries.pop(oid)
            if entry.status != "delivered":
                logger.error(f"Outbox FAILED after {entry.max_retries} retries: {oid}")

    def stop(self):
        self._running = False

    def stats(self) -> dict:
        """统计信息"""
        statuses = defaultdict(int)
        for e in self._entries.values():
            statuses[e.status] += 1
        return dict(statuses)
```

---

## 三、与 bridge_protocol.py 集成

```python
# bridge_protocol.py 升级

from .edge_outbox import EdgeOutbox

outbox = EdgeOutbox(wss_sender=wss_connection_manager.send_to_node)

# 龙虾下发任务时使用 outbox（而非直接发送）
async def dispatch_to_edge(tenant_id, node_id, task_payload):
    await outbox.enqueue(tenant_id, node_id, "task_dispatch", task_payload)

# 边缘 ACK 处理
async def on_edge_ack(msg):
    await outbox.ack(msg["outbox_id"])
```

---

## 四、边缘侧适配（edge-runtime）

```python
# edge-runtime/wss_receiver.py 升级点

async def on_batch_delivery(batch_msg):
    """处理批量消息包"""
    for item in batch_msg["items"]:
        await process_single_command(item)
        # 逐条ACK
        await send_ack(item["outbox_id"])
```

---

## 五、验收标准

- [ ] enqueue 写入持久化（消息不丢）
- [ ] flush_loop 按 node_id 分组批量发送
- [ ] 边缘 ACK 后标记 delivered，不再重发
- [ ] 超时未 ACK 自动重试（指数退避，最多 3 次）
- [ ] 超过重试上限记录 FAILED 日志
- [ ] stats() 返回各状态消息数量
- [ ] 与 bridge_protocol.py 集成
