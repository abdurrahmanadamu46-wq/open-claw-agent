# CODEX TASK: 边缘遥测批量上报（EdgeTelemetryBuffer）

**优先级：P1**  
**来源：GRAFANA_SIGNOZ_BORROWING_ANALYSIS.md P1-#4（SigNoz OTel Collector 模式）**

---

## 背景

边缘节点目前执行完每个龙虾任务后，立即调用云端 API 上报结果（逐条上报）。网络抖动时会丢失数据；高频执行时 API 调用次数过多；离线时数据直接丢失。

借鉴 OpenTelemetry Collector 的**批量缓存上报**模式：边缘节点内置遥测缓冲区，满 N 条或超过 T 秒时批量压缩上报，离线时本地持久化等待恢复后重传。

---

## 一、EdgeTelemetryBuffer 核心实现

```python
# edge-runtime/telemetry_buffer.py

import asyncio
import gzip
import json
import logging
import sqlite3
import time
from dataclasses import dataclass, asdict
from typing import List, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

@dataclass
class TelemetryEvent:
    """遥测事件（单条执行记录/指标/错误）"""
    event_id: str
    event_type: str          # "run_result" | "metric" | "error" | "heartbeat"
    timestamp: float         # Unix 时间戳
    lobster_id: str
    edge_node_id: str
    tenant_id: str
    payload: dict            # 具体内容（执行结果/指标数据等）
    trace_id: Optional[str] = None

class EdgeTelemetryBuffer:
    """
    边缘遥测缓冲区
    - 批量积累事件
    - 达到阈值或超时时批量压缩上报
    - 失败时本地 SQLite 持久化，恢复后重传
    """

    def __init__(
        self,
        cloud_endpoint: str,
        edge_node_id: str,
        batch_size: int = 100,       # 达到此条数立即上报
        flush_interval: float = 15.0, # 每隔 15 秒强制上报
        max_retry: int = 3,
        offline_db_path: str = "/var/lib/openclaw/telemetry_offline.db",
    ):
        self.cloud_endpoint = cloud_endpoint
        self.edge_node_id = edge_node_id
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self.max_retry = max_retry
        self.offline_db_path = offline_db_path

        self._buffer: List[TelemetryEvent] = []
        self._lock = asyncio.Lock()
        self._last_flush = time.time()
        self._offline_db: Optional[sqlite3.Connection] = None

        self._init_offline_db()

    def _init_offline_db(self):
        """初始化离线持久化 SQLite 数据库"""
        Path(self.offline_db_path).parent.mkdir(parents=True, exist_ok=True)
        self._offline_db = sqlite3.connect(self.offline_db_path, check_same_thread=False)
        self._offline_db.execute("""
            CREATE TABLE IF NOT EXISTS pending_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE,
                payload_json TEXT NOT NULL,
                created_at REAL NOT NULL,
                retry_count INTEGER DEFAULT 0
            )
        """)
        self._offline_db.commit()

    async def push(self, event: TelemetryEvent):
        """添加事件到缓冲区"""
        async with self._lock:
            self._buffer.append(event)
            should_flush = (
                len(self._buffer) >= self.batch_size or
                time.time() - self._last_flush >= self.flush_interval
            )
        if should_flush:
            await self.flush()

    async def flush(self):
        """将缓冲区内容批量上报"""
        async with self._lock:
            if not self._buffer:
                return
            batch = self._buffer.copy()
            self._buffer.clear()
            self._last_flush = time.time()

        await self._send_batch(batch)

    async def _send_batch(self, events: List[TelemetryEvent]):
        """压缩并发送批量事件到云端"""
        payload = {
            "edge_node_id": self.edge_node_id,
            "batch_size": len(events),
            "events": [asdict(e) for e in events],
            "sent_at": time.time(),
        }
        # gzip 压缩（减少带宽 60-80%）
        compressed = gzip.compress(json.dumps(payload).encode())

        import aiohttp
        for attempt in range(self.max_retry):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"{self.cloud_endpoint}/v1/edge/telemetry/batch",
                        data=compressed,
                        headers={
                            "Content-Type": "application/json",
                            "Content-Encoding": "gzip",
                            "X-Edge-Node-ID": self.edge_node_id,
                        },
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as resp:
                        if resp.status == 200:
                            logger.info(f"[EdgeTelemetry] 批量上报成功 {len(events)} 条")
                            return
                        logger.warning(f"[EdgeTelemetry] 上报失败 HTTP {resp.status}，重试 {attempt+1}")
            except Exception as e:
                logger.warning(f"[EdgeTelemetry] 上报异常 {e}，重试 {attempt+1}")
                await asyncio.sleep(2 ** attempt)  # 指数退避

        # 所有重试失败 → 持久化到本地 SQLite
        logger.error(f"[EdgeTelemetry] 批量上报彻底失败，持久化 {len(events)} 条到本地")
        self._save_offline(events)

    def _save_offline(self, events: List[TelemetryEvent]):
        """持久化到离线 SQLite"""
        cursor = self._offline_db.cursor()
        for event in events:
            cursor.execute(
                "INSERT OR IGNORE INTO pending_events (event_id, payload_json, created_at) VALUES (?,?,?)",
                (event.event_id, json.dumps(asdict(event)), event.timestamp)
            )
        self._offline_db.commit()

    async def retry_offline(self):
        """恢复在线时，重传本地持久化的事件"""
        cursor = self._offline_db.cursor()
        rows = cursor.execute(
            "SELECT id, event_id, payload_json FROM pending_events WHERE retry_count < ? ORDER BY created_at LIMIT 200",
            (self.max_retry * 2,)
        ).fetchall()

        if not rows:
            return

        events = [TelemetryEvent(**json.loads(row[2])) for row in rows]
        row_ids = [row[0] for row in rows]

        try:
            await self._send_batch(events)
            # 发送成功，删除本地记录
            cursor.execute(f"DELETE FROM pending_events WHERE id IN ({','.join(['?']*len(row_ids))})", row_ids)
            self._offline_db.commit()
            logger.info(f"[EdgeTelemetry] 离线重传成功 {len(events)} 条")
        except Exception:
            # 更新重试次数
            cursor.execute(
                f"UPDATE pending_events SET retry_count = retry_count + 1 WHERE id IN ({','.join(['?']*len(row_ids))})",
                row_ids
            )
            self._offline_db.commit()

    async def run_forever(self):
        """后台循环：定时 flush + 检查离线重传"""
        while True:
            await asyncio.sleep(self.flush_interval)
            await self.flush()
            await self.retry_offline()
```

---

## 二、集成到边缘执行器

```python
# edge-runtime/marionette_executor.py — 集成 TelemetryBuffer

from .telemetry_buffer import EdgeTelemetryBuffer, TelemetryEvent
import uuid, time

class MarionetteExecutor:
    def __init__(self, config: EdgeConfig):
        self.telemetry = EdgeTelemetryBuffer(
            cloud_endpoint=config.cloud_endpoint,
            edge_node_id=config.node_id,
            batch_size=config.telemetry_batch_size or 50,
            flush_interval=config.telemetry_flush_interval or 15.0,
            offline_db_path=config.telemetry_db_path or "/var/lib/openclaw/telemetry.db",
        )

    async def execute_skill(self, task: LobsterTask) -> SkillResult:
        start_time = time.time()
        result = None
        error = None

        try:
            result = await self._do_execute(task)
            return result
        except Exception as e:
            error = str(e)
            raise
        finally:
            # 无论成功失败，都推送遥测事件
            duration_ms = int((time.time() - start_time) * 1000)
            await self.telemetry.push(TelemetryEvent(
                event_id=str(uuid.uuid4()),
                event_type="run_result",
                timestamp=start_time,
                lobster_id=task.lobster_id,
                edge_node_id=self.config.node_id,
                tenant_id=task.tenant_id,
                trace_id=task.trace_id,
                payload={
                    "task_id": task.task_id,
                    "skill_name": task.skill_name,
                    "status": "success" if result else "error",
                    "duration_ms": duration_ms,
                    "quality_score": result.quality_score if result else None,
                    "token_count": result.token_count if result else None,
                    "error": error,
                }
            ))

    async def start(self):
        """启动时在后台运行 TelemetryBuffer"""
        asyncio.create_task(self.telemetry.run_forever())
```

---

## 三、云端批量接收 API

```python
# dragon-senate-saas-v2/api_edge_telemetry.py

import gzip
import json
from fastapi import Request, Header

@router.post("/edge/telemetry/batch")
async def receive_edge_telemetry_batch(
    request: Request,
    x_edge_node_id: str = Header(...),
    content_encoding: Optional[str] = Header(None),
):
    """接收边缘节点批量遥测数据"""
    raw = await request.body()
    
    # 解压 gzip
    if content_encoding == "gzip":
        raw = gzip.decompress(raw)
    
    batch = json.loads(raw)
    events = batch.get("events", [])
    
    # 批量写入（按事件类型分发）
    run_results = [e for e in events if e["event_type"] == "run_result"]
    metrics = [e for e in events if e["event_type"] == "metric"]
    errors = [e for e in events if e["event_type"] == "error"]
    
    if run_results:
        await bulk_insert_run_results(run_results)
    if metrics:
        await bulk_insert_metrics(metrics)
    if errors:
        await bulk_insert_errors(errors)
    
    # 更新边缘节点最后活跃时间
    await update_edge_node_last_seen(x_edge_node_id)
    
    return {"received": len(events), "status": "ok"}
```

---

## 四、配置项

```yaml
# edge-runtime 配置（edge_config.yaml）
telemetry:
  batch_size: 50          # 积累 50 条立即上报
  flush_interval: 15      # 最多等 15 秒
  max_retry: 3            # 最多重试 3 次
  offline_db_path: /var/lib/openclaw/telemetry.db
  compress: true          # gzip 压缩（默认开启）
```

---

## 验收标准

- [ ] `EdgeTelemetryBuffer` 类实现（batch_size + flush_interval 双触发）
- [ ] gzip 压缩（压缩率验证：同等数据量下网络传输减少 ≥ 60%）
- [ ] 指数退避重试（1s / 2s / 4s）
- [ ] 离线 SQLite 持久化（网络彻底断开时数据不丢失）
- [ ] `retry_offline()`：恢复在线时自动重传本地积压数据
- [ ] `MarionetteExecutor` 集成 TelemetryBuffer（execute_skill 的 finally 中推送）
- [ ] `POST /v1/edge/telemetry/batch` 云端接收 API
- [ ] 云端接收支持 gzip 解压
- [ ] 批量写入 run_results / metrics / errors 三张表
- [ ] 边缘节点接入测试：模拟 200 条执行结果，验证批量上报正确性
- [ ] 离线测试：断开网络执行 50 次，恢复后验证数据完整传输

---

*Codex Task | 来源：GRAFANA_SIGNOZ_BORROWING_ANALYSIS.md P1-#4 | 2026-04-02*
