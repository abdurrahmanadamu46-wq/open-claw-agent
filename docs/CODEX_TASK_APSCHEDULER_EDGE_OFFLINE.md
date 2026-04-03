# CODEX TASK: APScheduler v4 EdgeScheduler 离线自治
**任务ID**: CODEX-APSCHEDULER-P0-001  
**优先级**: 🔴 P0（架构铁律缺失：边缘节点断网后任务必须继续执行）  
**依赖文件**: `edge-runtime/edge_heartbeat.py`, `edge-runtime/marionette_executor.py`, `edge-runtime/wss_receiver.py`  
**参考项目**: APScheduler v4（https://github.com/agronholm/apscheduler）  
**预计工期**: 2天

---

## 一、当前痛点分析

**现有边缘层架构问题**：
```
wss_receiver.py → 收 SOP 任务包 → marionette_executor.py 执行

致命缺陷：断网时 wss_receiver 无法收到任务 → 边缘节点完全停摆
```

**真实场景**：
- 每天早上 8:00 自动发布小红书内容（定时 SOP）
- 网络抖动导致 WSS 断开 → 8:00 任务未收到 → **客户当天断更**
- 销售告警：客户流失风险

**APScheduler v4 解决什么**：
- 边缘节点本地存储 SOP 调度计划（SQLite/文件）
- 即使断网，本地调度器也能在指定时间自动触发任务
- 网络恢复后：上报执行日志 + 拉取新的 SOP 更新

---

## 二、EdgeScheduler 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                   边缘节点（Edge）                        │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │  wss_receiver    │    │   EdgeScheduler          │   │
│  │  (在线时同步SOP)  │───▶│   (APScheduler v4)       │   │
│  └──────────────────┘    │                          │   │
│                          │  ┌─────────────────────┐ │   │
│                          │  │  LocalJobStore       │ │   │
│                          │  │  (SQLite 持久化)      │ │   │
│                          │  │                     │ │   │
│                          │  │  job_id: sop_001    │ │   │
│                          │  │  cron: "0 8 * * *"  │ │   │
│                          │  │  payload: {...}     │ │   │
│                          │  └─────────────────────┘ │   │
│                          │                          │   │
│                          │  断网时 ──────────────────│───│──▶ 本地继续执行
│                          │  联网时 ──────────────────│───│──▶ 上报日志+拉新SOP
│                          └──────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 三、核心实现

```python
# edge-runtime/edge_scheduler.py
"""
EdgeScheduler - 基于 APScheduler v4 的离线自治调度器

解决边缘节点断网时 SOP 任务必须继续执行的核心问题。

依赖：
    pip install apscheduler>=4.0.0a1
"""

from datetime import datetime, timezone
from pathlib import Path
import json
import logging
import asyncio

from apscheduler import AsyncScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.datastores.sqlalchemy import SQLAlchemyDataStore
from apscheduler.eventbrokers.local import LocalEventBroker

logger = logging.getLogger(__name__)

# 本地调度数据库（SQLite，边缘节点断网也能读写）
EDGE_DB_PATH = Path.home() / ".openclaw" / "edge_scheduler.db"
EDGE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)


class EdgeScheduler:
    """
    边缘节点离线自治调度器
    
    核心能力：
    1. 持久化存储 SOP 调度计划（断电/重启不丢失）
    2. 断网时自动执行定时 SOP 任务
    3. 网络恢复时上报执行日志 + 拉取最新 SOP
    4. 支持 cron 定时 + 一次性触发 + 延时执行
    """
    
    def __init__(self, edge_node_id: str):
        self.edge_node_id = edge_node_id
        self.scheduler: AsyncScheduler = None
        self._pending_logs: list = []  # 断网期间缓存执行日志
        
    async def start(self):
        """启动调度器"""
        data_store = SQLAlchemyDataStore(
            f"sqlite+aiosqlite:///{EDGE_DB_PATH}"
        )
        event_broker = LocalEventBroker()
        
        self.scheduler = AsyncScheduler(
            data_store=data_store,
            event_broker=event_broker,
            identity=self.edge_node_id,
        )
        
        await self.scheduler.start_in_background()
        logger.info(f"EdgeScheduler 启动 | node={self.edge_node_id}")
    
    async def sync_sop_from_cloud(self, sop_schedule: dict):
        """
        从云端同步 SOP 调度计划（wss_receiver 调用此方法）
        
        sop_schedule 格式：
        {
            "job_id": "sop_xiaohongshu_morning",
            "cron": "0 8 * * *",           # 每天早上8点
            "timezone": "Asia/Shanghai",
            "payload": {
                "sop_type": "publish_post",
                "platform": "xiaohongshu",
                "content_template": "...",
                "account_id": "xxx",
            },
            "expires_at": "2026-12-31"     # 可选：过期自动停止
        }
        """
        job_id = sop_schedule["job_id"]
        cron_expr = sop_schedule.get("cron")
        payload = sop_schedule["payload"]
        tz = sop_schedule.get("timezone", "Asia/Shanghai")
        
        # 删除旧的同名任务（更新）
        try:
            await self.scheduler.remove_job(job_id)
        except Exception:
            pass
        
        # 创建新调度
        if cron_expr:
            trigger = CronTrigger.from_crontab(cron_expr, timezone=tz)
        else:
            # 一次性触发
            run_at = sop_schedule.get("run_at")
            trigger = DateTrigger(run_time=datetime.fromisoformat(run_at))
        
        await self.scheduler.add_job(
            self._execute_sop,
            trigger,
            id=job_id,
            kwargs={"payload": payload, "job_id": job_id},
        )
        
        logger.info(f"SOP 调度已同步 | job_id={job_id} | cron={cron_expr}")
    
    async def _execute_sop(self, payload: dict, job_id: str):
        """
        执行 SOP 任务（调度器触发时调用）
        
        即使断网也能执行，执行结果缓存到 _pending_logs
        网络恢复后通过 flush_pending_logs() 上报
        """
        start_time = datetime.now(timezone.utc)
        success = False
        error_msg = None
        
        try:
            logger.info(f"执行 SOP | job_id={job_id} | payload={payload['sop_type']}")
            
            # 调用 marionette_executor 执行实际操作
            from marionette_executor import MarionetteExecutor
            executor = MarionetteExecutor()
            result = await executor.execute(payload)
            success = result.get("success", False)
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"SOP 执行失败 | job_id={job_id} | error={e}")
        
        # 缓存执行日志（断网时也缓存）
        log_entry = {
            "edge_node_id": self.edge_node_id,
            "job_id": job_id,
            "sop_type": payload.get("sop_type"),
            "started_at": start_time.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "success": success,
            "error": error_msg,
            "offline_executed": True,  # 标记是否离线执行
        }
        
        self._pending_logs.append(log_entry)
        
        # 尝试立即上报（联网时）
        await self._try_flush_logs()
    
    async def _try_flush_logs(self):
        """尝试上报缓存的执行日志（联网时）"""
        if not self._pending_logs:
            return
        
        try:
            # 通过 wss 上报（如果连接可用）
            from wss_receiver import WSSReceiver
            receiver = WSSReceiver.get_instance()
            if receiver and receiver.is_connected():
                await receiver.report_execution_logs(self._pending_logs)
                self._pending_logs.clear()
                logger.info("离线执行日志已上报")
        except Exception:
            # 继续缓存，下次再试
            pass
    
    async def remove_sop(self, job_id: str):
        """移除 SOP 调度"""
        try:
            await self.scheduler.remove_job(job_id)
            logger.info(f"SOP 调度已移除 | job_id={job_id}")
        except Exception as e:
            logger.warning(f"移除 SOP 调度失败 | job_id={job_id} | error={e}")
    
    async def list_scheduled_sops(self) -> list:
        """列出当前所有调度任务（用于边缘节点状态上报）"""
        jobs = await self.scheduler.get_jobs()
        return [
            {
                "job_id": job.id,
                "next_run_time": job.next_fire_time.isoformat() if job.next_fire_time else None,
                "status": "active",
            }
            for job in jobs
        ]
    
    async def stop(self):
        """停止调度器"""
        if self.scheduler:
            await self.scheduler.stop()


# ══════════════════════════════════════════════════════════
# 集成到 wss_receiver.py
# ══════════════════════════════════════════════════════════

INTEGRATION_EXAMPLE = """
# edge-runtime/wss_receiver.py — 新增 SOP 调度同步处理

class WSSReceiver:
    def __init__(self, edge_node_id: str):
        self.edge_node_id = edge_node_id
        self.scheduler = EdgeScheduler(edge_node_id)
    
    async def start(self):
        # 先启动本地调度器（确保断网时也有调度）
        await self.scheduler.start()
        # 再连接 WSS
        await self._connect_wss()
    
    async def handle_message(self, msg: dict):
        msg_type = msg.get("type")
        
        if msg_type == "sop_schedule_sync":
            # 云端下发 SOP 调度计划
            await self.scheduler.sync_sop_from_cloud(msg["schedule"])
            
        elif msg_type == "sop_schedule_remove":
            # 云端取消某个 SOP 调度
            await self.scheduler.remove_sop(msg["job_id"])
            
        elif msg_type == "request_schedule_status":
            # 云端查询本地调度状态
            sops = await self.scheduler.list_scheduled_sops()
            await self.send({"type": "schedule_status", "jobs": sops})
    
    async def on_reconnect(self):
        # 网络恢复时：上报离线执行日志
        await self.scheduler._try_flush_logs()
        # 请求最新 SOP 调度同步
        await self.send({"type": "request_sop_sync"})
"""
```

---

## 四、云端 SOP 下发接口

```python
# dragon-senate-saas-v2/api_governance_routes.py — 新增

@app.post("/api/edge/{edge_node_id}/schedule/sync")
async def sync_edge_schedule(
    edge_node_id: str,
    schedule: dict,
    admin_token: str = None,
):
    """
    下发 SOP 调度计划到指定边缘节点
    
    调用方：dispatcher 龙虾生成 ExecutionPlan 后调用此接口
    """
    from bridge_protocol import BridgeProtocol
    bridge = BridgeProtocol()
    
    await bridge.send_to_edge(
        edge_node_id=edge_node_id,
        message={
            "type": "sop_schedule_sync",
            "schedule": schedule,
        }
    )
    
    return {"status": "synced", "edge_node_id": edge_node_id}


@app.get("/api/edge/{edge_node_id}/schedule/status")
async def get_edge_schedule_status(edge_node_id: str):
    """查询边缘节点当前调度状态"""
    # 通过 bridge 请求边缘节点上报
    from bridge_protocol import BridgeProtocol
    bridge = BridgeProtocol()
    status = await bridge.request_from_edge(
        edge_node_id=edge_node_id,
        request={"type": "request_schedule_status"},
        timeout=10,
    )
    return status
```

---

## 五、requirements 更新

```txt
# edge-runtime/requirements.txt 新增

apscheduler>=4.0.0a4
aiosqlite>=0.19.0
sqlalchemy[asyncio]>=2.0.0
```

---

## 六、验收标准

- [ ] APScheduler v4 安装成功，`EdgeScheduler` 类正确初始化
- [ ] SOP 调度计划存入 SQLite（重启后仍保留）
- [ ] 断网场景：cron 定时 SOP 在指定时间自动执行（不依赖 WSS）
- [ ] 断网执行的日志缓存到 `_pending_logs`，联网后自动上报
- [ ] 网络恢复时自动触发 `on_reconnect()` → 上报日志 + 请求最新 SOP
- [ ] `wss_receiver` 正确处理 `sop_schedule_sync` / `sop_schedule_remove` 消息
- [ ] 云端 API `POST /api/edge/{id}/schedule/sync` 正确下发调度
- [ ] 边缘节点重启后：从 SQLite 恢复所有调度，下次 cron 时间正确
- [ ] 场景测试：模拟断网30分钟，8:00 SOP 自动执行，8:31 联网后日志上报
