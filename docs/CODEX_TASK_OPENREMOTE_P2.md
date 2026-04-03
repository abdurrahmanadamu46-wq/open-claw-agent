# CODEX TASK: OpenRemote P2 合并（龙虾历史时序 + 边缘多协议适配）

**优先级：P2**  
**来源：OPENREMOTE_BORROWING_ANALYSIS.md P2-#3 + P2-#4**

---

## P2-3：龙虾历史时序指标（lobster_metrics_history）

### 背景

龙虾只有实时状态，没有"过去30天趋势"。借鉴 OpenRemote Attribute History，每天聚合一次龙虾核心指标，存入 `lobster_daily_metrics` 表，前端复用已有图表渲染趋势图。

### 实现

```python
# dragon-senate-saas-v2/lobster_metrics_history.py

import time
import logging
from datetime import date, timedelta

logger = logging.getLogger(__name__)

LOBSTERS = [
    "commander", "strategist", "radar", "inkwriter",
    "visualizer", "dispatcher", "echoer", "catcher",
    "abacus", "followup",
]


class LobsterMetricsHistory:
    """
    龙虾每日指标快照（按天聚合，复用 llm_call_logs 数据）
    
    Schema: lobster_daily_metrics
      date | lobster_name | tenant_id | task_count | success_count
          | avg_latency_ms | cost_usd | error_rate
    
    调度：每天 00:05 聚合昨日数据（复用 lobster_evolution_engine 的 cron）
    """

    def __init__(self, db):
        self.db = db

    async def aggregate_day(self, target_date: date, tenant_id: str):
        """聚合指定日期的龙虾指标"""
        for lobster in LOBSTERS:
            rows = self.db.query_raw(
                """
                SELECT
                    COUNT(*) as task_count,
                    SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success_count,
                    AVG(latency_ms) as avg_latency_ms,
                    SUM(cost_usd) as cost_usd
                FROM llm_call_logs
                WHERE tenant_id=? AND lobster_name=? AND DATE(created_at)=?
                """,
                [tenant_id, lobster, target_date.isoformat()],
            )
            if not rows or rows[0]["task_count"] == 0:
                continue

            row = rows[0]
            task_count = row["task_count"] or 0
            success_count = row["success_count"] or 0
            error_rate = 1 - (success_count / task_count) if task_count > 0 else 0

            self.db.upsert("lobster_daily_metrics", {
                "date": target_date.isoformat(),
                "lobster_name": lobster,
                "tenant_id": tenant_id,
                "task_count": task_count,
                "success_count": success_count,
                "avg_latency_ms": row["avg_latency_ms"] or 0,
                "cost_usd": row["cost_usd"] or 0,
                "error_rate": round(error_rate, 4),
            }, unique_keys=["date", "lobster_name", "tenant_id"])

        logger.info(f"[MetricsHistory] 聚合完成 date={target_date} tenant={tenant_id}")

    def get_history(
        self, lobster_name: str, tenant_id: str, days: int = 30
    ) -> list[dict]:
        """查询最近 N 天历史"""
        since = (date.today() - timedelta(days=days)).isoformat()
        return self.db.query_raw(
            """
            SELECT date, task_count, success_count, avg_latency_ms, cost_usd, error_rate
            FROM lobster_daily_metrics
            WHERE lobster_name=? AND tenant_id=? AND date >= ?
            ORDER BY date ASC
            """,
            [lobster_name, tenant_id, since],
        )
```

### API

```python
# GET /api/v1/metrics/lobster/{name}/history?days=30
@router.get("/api/v1/metrics/lobster/{name}/history")
async def get_lobster_history(name: str, days: int = 30, ctx=Depends(get_tenant_context)):
    hist = LobsterMetricsHistory(db)
    return hist.get_history(name, ctx.tenant_id, days)
```

### 验收标准

- [ ] `aggregate_day()`：聚合指定日期10个龙虾的指标
- [ ] `get_history()`：查询N天历史（默认30天）
- [ ] DB Schema：`lobster_daily_metrics` 表（含 upsert 去重）
- [ ] API：`GET /api/v1/metrics/lobster/{name}/history`
- [ ] 龙虾详情页增加"30天趋势图"（折线图复用 shadcn charts）

---

## P2-4：边缘多协议适配层（HTTP + MQTT Adapter）

### 背景

边缘层只支持 WSS 协议，无法接收第三方系统回调（ERP/CRM）和 MQTT 消息。借鉴 OpenRemote Protocol Stack，新增 `ProtocolAdapter` 支持 HTTP Webhook 入站和 MQTT 订阅。

### 实现

```python
# edge-runtime/protocol_adapter.py

import asyncio
import json
import logging
import os
from typing import Callable

logger = logging.getLogger(__name__)

# 统一任务事件（无论哪种协议，最终转为此结构）
def make_task_event(source: str, payload: dict) -> dict:
    return {
        "task_type": "external_trigger",
        "source_protocol": source,
        "payload": payload,
        "node_id": os.environ.get("EDGE_NODE_ID", "unknown"),
    }


# ── HTTP Adapter ─────────────────────────────────────────

class HttpWebhookAdapter:
    """
    边缘节点本地 HTTP Webhook 接收器
    
    第三方系统 → POST http://edge-node:8090/webhook → 转为边缘任务
    """

    def __init__(self, port: int = 8090, on_event: Callable = None):
        self.port = port
        self.on_event = on_event  # async def on_event(task_event: dict)

    async def start(self):
        try:
            from aiohttp import web

            async def handle_webhook(request):
                try:
                    body = await request.json()
                    event = make_task_event("http_webhook", body)
                    if self.on_event:
                        asyncio.create_task(self.on_event(event))
                    return web.json_response({"accepted": True})
                except Exception as e:
                    logger.warning(f"[HttpAdapter] 解析失败: {e}")
                    return web.json_response({"error": str(e)}, status=400)

            app = web.Application()
            app.router.add_post("/webhook", handle_webhook)
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, "0.0.0.0", self.port)
            await site.start()
            logger.info(f"[HttpAdapter] 监听 0.0.0.0:{self.port}/webhook")
        except ImportError:
            logger.warning("[HttpAdapter] aiohttp 未安装，HTTP 适配器已禁用")


# ── MQTT Adapter ─────────────────────────────────────────

class MqttAdapter:
    """
    边缘节点 MQTT 订阅适配器
    
    MQTT Broker → topic → 转为边缘任务
    
    配置：
      EDGE_MQTT_HOST=localhost
      EDGE_MQTT_PORT=1883
      EDGE_MQTT_TOPIC=openclaw/edge/{node_id}/tasks
    """

    def __init__(self, on_event: Callable = None):
        self.on_event = on_event
        self.host = os.environ.get("EDGE_MQTT_HOST", "localhost")
        self.port = int(os.environ.get("EDGE_MQTT_PORT", "1883"))
        self.node_id = os.environ.get("EDGE_NODE_ID", "unknown")
        self.topic = os.environ.get(
            "EDGE_MQTT_TOPIC",
            f"openclaw/edge/{self.node_id}/tasks",
        )

    async def start(self):
        try:
            import aiomqtt

            async with aiomqtt.Client(self.host, self.port) as client:
                await client.subscribe(self.topic)
                logger.info(f"[MqttAdapter] 订阅 {self.host}:{self.port} topic={self.topic}")
                async for message in client.messages:
                    try:
                        payload = json.loads(message.payload)
                        event = make_task_event("mqtt", payload)
                        if self.on_event:
                            asyncio.create_task(self.on_event(event))
                    except Exception as e:
                        logger.warning(f"[MqttAdapter] 消息解析失败: {e}")
        except ImportError:
            logger.warning("[MqttAdapter] aiomqtt 未安装，MQTT 适配器已禁用")
        except Exception as e:
            logger.error(f"[MqttAdapter] 连接失败: {e}")


# ── 集成入口（marionette_executor.py 使用）────────────────

class EdgeProtocolHub:
    """统一启动所有协议适配器"""

    def __init__(self, on_event: Callable):
        self.http = HttpWebhookAdapter(on_event=on_event)
        self.mqtt = MqttAdapter(on_event=on_event)

    async def start_all(self):
        await asyncio.gather(
            self.http.start(),
            self.mqtt.start(),
            return_exceptions=True,
        )
```

### 验收标准

- [ ] `HttpWebhookAdapter`：POST `/webhook` → `make_task_event("http_webhook", ...)` → `on_event()`
- [ ] `MqttAdapter`：订阅 MQTT topic → 转为 task_event → `on_event()`
- [ ] 两个 Adapter 都是**可选依赖**（库未安装时警告降级，不崩溃）
- [ ] `EdgeProtocolHub.start_all()`：并发启动两个 Adapter
- [ ] 环境变量配置：`EDGE_MQTT_HOST/PORT/TOPIC`
- [ ] 集成到 `marionette_executor.py` 的初始化流程

---

*Codex Task | 来源：OPENREMOTE_BORROWING_ANALYSIS.md P2-#3+4 | 2026-04-02*
