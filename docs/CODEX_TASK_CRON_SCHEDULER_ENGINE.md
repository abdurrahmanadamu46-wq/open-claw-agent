# CODEX-TD-02: Cron/Scheduler 定时调度引擎

> **编号**: CODEX-TD-02
> **优先级**: P0（Layer 2 最大缺口）
> **算力**: 高
> **来源**: awesome-openclaw-usecases-zh (电商多Agent PoC + 竞品情报 + 内容工厂)
> **印证**: 46 个真实用例中 15+ 依赖定时调度，无此能力等于所有自动化只能手动触发
> **前端对齐**: 需要 web/ 增加「定时任务管理」页面（创建/编辑/暂停/历史记录）

---

## 一、背景

当前龙虾系统**没有任何定时调度能力**。所有任务必须由人类手动触发或外部系统推送。
awesome-openclaw-usecases-zh 的电商多 Agent 用例展示了三种调度模式：

| 模式 | 配置示例 | 场景 |
|------|---------|------|
| Cron 表达式 | `cron: "0 8 * * *"` | 每日早报 |
| 间隔轮询 | `every: "30m"` | 库存预警实时监控 |
| 一次性延迟 | `once: "2026-04-01T10:00:00+08:00"` | 定时发布 |

---

## 二、目标

在 `dragon-senate-saas-v2/` 中新增 `cron_scheduler.py`，作为 Layer 2 云边调度层的核心组件。

---

## 三、需要创建的文件

### 3.1 `dragon-senate-saas-v2/cron_scheduler.py`

```python
"""
CODEX-TD-02: Cron/Scheduler 定时调度引擎

支持三种调度模式:
1. cron 表达式 (标准 5 段式)
2. every 间隔 (15m / 1h / 30s)
3. once 一次性延迟 (ISO 8601 时间戳)

每个调度任务可绑定:
- lobster_id: 由哪只龙虾执行
- prompt: 执行什么任务
- session_mode: shared(复用对话) | isolated(隔离会话)
- delivery_channel: 结果推送到哪个渠道
- max_retries: 失败重试次数
- enabled: 是否启用
"""

import asyncio
import hashlib
import json
import logging
import sqlite3
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Optional, Callable, Awaitable

logger = logging.getLogger("cron_scheduler")

# ── 调度模式 ──

class ScheduleKind(str, Enum):
    CRON = "cron"
    EVERY = "every"
    ONCE = "once"

class SessionMode(str, Enum):
    SHARED = "shared"      # 复用已有对话上下文
    ISOLATED = "isolated"  # 隔离会话，不污染对话历史

# ── 调度任务定义 ──

@dataclass
class ScheduledTask:
    task_id: str
    name: str
    kind: ScheduleKind
    schedule: str           # cron 表达式 / "30m" / ISO 时间戳
    lobster_id: str         # 绑定的龙虾
    prompt: str             # 执行的任务描述
    session_mode: SessionMode = SessionMode.ISOLATED
    delivery_channel: str = "last"  # "last" = 上次对话渠道
    max_retries: int = 2
    enabled: bool = True
    tenant_id: str = "default"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_run_at: Optional[str] = None
    next_run_at: Optional[str] = None
    run_count: int = 0
    fail_count: int = 0

    @staticmethod
    def generate_id(name: str, tenant_id: str = "default") -> str:
        return hashlib.sha256(f"{tenant_id}:{name}".encode()).hexdigest()[:12]

# ── Cron 表达式解析器 (最小实现) ──

def _parse_interval(spec: str) -> timedelta:
    """解析 every 间隔: 15m, 1h, 30s, 2d"""
    unit = spec[-1]
    value = int(spec[:-1])
    mapping = {"s": "seconds", "m": "minutes", "h": "hours", "d": "days"}
    if unit not in mapping:
        raise ValueError(f"Unknown interval unit: {unit}")
    return timedelta(**{mapping[unit]: value})

def _parse_cron_next(cron_expr: str, now: datetime) -> datetime:
    """
    最小 cron 解析: 仅支持 "分 时 日 月 星期" 五段。
    生产环境建议替换为 croniter 库。
    """
    try:
        from croniter import croniter
        return croniter(cron_expr, now).get_next(datetime)
    except ImportError:
        # Fallback: 每小时整点
        logger.warning("croniter not installed, falling back to hourly schedule")
        return now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)

# ── 持久化存储 ──

class SchedulerStore:
    """SQLite 持久化调度任务"""

    def __init__(self, db_path: str = "data/scheduler.sqlite"):
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self._db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS scheduled_tasks (
                    task_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    schedule TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    session_mode TEXT DEFAULT 'isolated',
                    delivery_channel TEXT DEFAULT 'last',
                    max_retries INTEGER DEFAULT 2,
                    enabled INTEGER DEFAULT 1,
                    tenant_id TEXT DEFAULT 'default',
                    created_at TEXT NOT NULL,
                    last_run_at TEXT,
                    next_run_at TEXT,
                    run_count INTEGER DEFAULT 0,
                    fail_count INTEGER DEFAULT 0
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS task_run_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    status TEXT DEFAULT 'running',
                    result_summary TEXT,
                    error_message TEXT,
                    FOREIGN KEY (task_id) REFERENCES scheduled_tasks(task_id)
                )
            """)
            conn.commit()

    def upsert_task(self, task: ScheduledTask):
        with sqlite3.connect(self._db_path) as conn:
            d = asdict(task)
            d["enabled"] = 1 if d["enabled"] else 0
            cols = ", ".join(d.keys())
            placeholders = ", ".join(["?"] * len(d))
            conn.execute(
                f"INSERT OR REPLACE INTO scheduled_tasks ({cols}) VALUES ({placeholders})",
                list(d.values()),
            )
            conn.commit()

    def list_tasks(self, tenant_id: str = "default", enabled_only: bool = True) -> list[ScheduledTask]:
        with sqlite3.connect(self._db_path) as conn:
            conn.row_factory = sqlite3.Row
            query = "SELECT * FROM scheduled_tasks WHERE tenant_id = ?"
            params = [tenant_id]
            if enabled_only:
                query += " AND enabled = 1"
            rows = conn.execute(query, params).fetchall()
            return [ScheduledTask(**{**dict(r), "enabled": bool(r["enabled"])}) for r in rows]

    def update_run_status(self, task_id: str, now: str, next_run: Optional[str]):
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                "UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ?, run_count = run_count + 1 WHERE task_id = ?",
                (now, next_run, task_id),
            )
            conn.commit()

    def log_run(self, task_id: str, started_at: str, status: str = "running",
                finished_at: str = None, result_summary: str = None, error_message: str = None):
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                "INSERT INTO task_run_log (task_id, started_at, finished_at, status, result_summary, error_message) VALUES (?, ?, ?, ?, ?, ?)",
                (task_id, started_at, finished_at, status, result_summary, error_message),
            )
            conn.commit()

    def get_run_history(self, task_id: str, limit: int = 20) -> list[dict]:
        with sqlite3.connect(self._db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM task_run_log WHERE task_id = ? ORDER BY started_at DESC LIMIT ?",
                (task_id, limit),
            ).fetchall()
            return [dict(r) for r in rows]

# ── 调度引擎 ──

class CronScheduler:
    """
    定时调度引擎。

    用法:
        scheduler = CronScheduler(store, executor_fn)
        scheduler.add_task(ScheduledTask(...))
        await scheduler.run()  # 阻塞运行，或作为 asyncio task 启动
    """

    def __init__(
        self,
        store: SchedulerStore,
        executor: Callable[[ScheduledTask], Awaitable[str]],
        check_interval: float = 10.0,
    ):
        self._store = store
        self._executor = executor
        self._check_interval = check_interval
        self._running = False

    def add_task(self, task: ScheduledTask):
        """添加或更新调度任务"""
        now = datetime.now(timezone.utc)
        task.next_run_at = self._compute_next_run(task, now)
        self._store.upsert_task(task)
        logger.info(f"Scheduled task '{task.name}' ({task.kind.value}: {task.schedule}), next run: {task.next_run_at}")

    def remove_task(self, task_id: str):
        """停用任务"""
        tasks = self._store.list_tasks(enabled_only=False)
        for t in tasks:
            if t.task_id == task_id:
                t.enabled = False
                self._store.upsert_task(t)
                logger.info(f"Disabled task '{t.name}'")
                return

    async def run(self):
        """主循环: 每 check_interval 秒扫描一次到期任务"""
        self._running = True
        logger.info(f"CronScheduler started (check every {self._check_interval}s)")
        while self._running:
            try:
                await self._tick()
            except Exception as e:
                logger.error(f"Scheduler tick error: {e}")
            await asyncio.sleep(self._check_interval)

    def stop(self):
        self._running = False

    async def _tick(self):
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        tasks = self._store.list_tasks()
        for task in tasks:
            if task.next_run_at and task.next_run_at <= now_iso:
                await self._execute_task(task, now)

    async def _execute_task(self, task: ScheduledTask, now: datetime):
        now_iso = now.isoformat()
        self._store.log_run(task.task_id, now_iso, status="running")
        try:
            result = await self._executor(task)
            next_run = self._compute_next_run(task, now)
            self._store.update_run_status(task.task_id, now_iso, next_run)
            self._store.log_run(task.task_id, now_iso, finished_at=datetime.now(timezone.utc).isoformat(),
                               status="success", result_summary=result[:500] if result else None)
            logger.info(f"Task '{task.name}' completed, next run: {next_run}")
        except Exception as e:
            next_run = self._compute_next_run(task, now)
            self._store.update_run_status(task.task_id, now_iso, next_run)
            self._store.log_run(task.task_id, now_iso, finished_at=datetime.now(timezone.utc).isoformat(),
                               status="failed", error_message=str(e)[:500])
            logger.error(f"Task '{task.name}' failed: {e}")

    def _compute_next_run(self, task: ScheduledTask, now: datetime) -> Optional[str]:
        if task.kind == ScheduleKind.CRON:
            return _parse_cron_next(task.schedule, now).isoformat()
        elif task.kind == ScheduleKind.EVERY:
            delta = _parse_interval(task.schedule)
            return (now + delta).isoformat()
        elif task.kind == ScheduleKind.ONCE:
            # once 类型只运行一次，之后不再调度
            if task.run_count > 0:
                return None
            return task.schedule
        return None

# ── API 路由 (FastAPI) ──

def register_scheduler_routes(app, scheduler: CronScheduler, store: SchedulerStore):
    """
    注册到 app.py 的 FastAPI 路由。
    前端工程师对齐: GET/POST/DELETE /api/scheduler/tasks, GET /api/scheduler/tasks/{id}/history
    """
    from fastapi import HTTPException
    from pydantic import BaseModel

    class TaskCreate(BaseModel):
        name: str
        kind: str           # "cron" | "every" | "once"
        schedule: str
        lobster_id: str
        prompt: str
        session_mode: str = "isolated"
        delivery_channel: str = "last"
        max_retries: int = 2
        tenant_id: str = "default"

    @app.get("/api/scheduler/tasks")
    async def list_scheduled_tasks(tenant_id: str = "default"):
        tasks = store.list_tasks(tenant_id, enabled_only=False)
        return {"tasks": [asdict(t) for t in tasks]}

    @app.post("/api/scheduler/tasks")
    async def create_scheduled_task(req: TaskCreate):
        task = ScheduledTask(
            task_id=ScheduledTask.generate_id(req.name, req.tenant_id),
            name=req.name,
            kind=ScheduleKind(req.kind),
            schedule=req.schedule,
            lobster_id=req.lobster_id,
            prompt=req.prompt,
            session_mode=SessionMode(req.session_mode),
            delivery_channel=req.delivery_channel,
            max_retries=req.max_retries,
            tenant_id=req.tenant_id,
        )
        scheduler.add_task(task)
        return {"task_id": task.task_id, "next_run_at": task.next_run_at}

    @app.delete("/api/scheduler/tasks/{task_id}")
    async def delete_scheduled_task(task_id: str):
        scheduler.remove_task(task_id)
        return {"status": "disabled"}

    @app.get("/api/scheduler/tasks/{task_id}/history")
    async def get_task_history(task_id: str, limit: int = 20):
        history = store.get_run_history(task_id, limit)
        return {"history": history}
```

### 3.2 测试文件 `dragon-senate-saas-v2/tests/test_cron_scheduler.py`

```python
"""CODEX-TD-02 测试"""
import pytest
import asyncio
from datetime import datetime, timezone
from cron_scheduler import (
    ScheduledTask, ScheduleKind, SessionMode,
    SchedulerStore, CronScheduler, _parse_interval
)

def test_parse_interval():
    assert _parse_interval("30m").total_seconds() == 1800
    assert _parse_interval("1h").total_seconds() == 3600
    assert _parse_interval("2d").total_seconds() == 172800

def test_task_id_generation():
    id1 = ScheduledTask.generate_id("daily-report", "tenant-1")
    id2 = ScheduledTask.generate_id("daily-report", "tenant-2")
    assert id1 != id2
    assert len(id1) == 12

def test_store_upsert_and_list(tmp_path):
    store = SchedulerStore(str(tmp_path / "test.sqlite"))
    task = ScheduledTask(
        task_id="test-001",
        name="每日早报",
        kind=ScheduleKind.CRON,
        schedule="0 8 * * *",
        lobster_id="radar",
        prompt="生成今日早报",
    )
    store.upsert_task(task)
    tasks = store.list_tasks()
    assert len(tasks) == 1
    assert tasks[0].name == "每日早报"

@pytest.mark.asyncio
async def test_scheduler_executes_every_task(tmp_path):
    store = SchedulerStore(str(tmp_path / "test.sqlite"))
    results = []

    async def mock_executor(task):
        results.append(task.name)
        return "ok"

    scheduler = CronScheduler(store, mock_executor, check_interval=0.1)
    task = ScheduledTask(
        task_id="test-every",
        name="库存检查",
        kind=ScheduleKind.EVERY,
        schedule="1s",
        lobster_id="dispatcher",
        prompt="检查库存",
    )
    scheduler.add_task(task)
    run_task = asyncio.create_task(scheduler.run())
    await asyncio.sleep(1.5)
    scheduler.stop()
    await run_task
    assert len(results) >= 1
```

---

## 四、接入点

### 4.1 `app.py` 集成

在 `dragon-senate-saas-v2/app.py` 的 startup 中：

```python
from cron_scheduler import CronScheduler, SchedulerStore, register_scheduler_routes

scheduler_store = SchedulerStore()

async def scheduler_executor(task):
    """将调度任务转发给对应龙虾执行"""
    from lobster_runner import run_lobster_task
    return await run_lobster_task(
        lobster_id=task.lobster_id,
        prompt=task.prompt,
        session_mode=task.session_mode,
        delivery_channel=task.delivery_channel,
    )

scheduler = CronScheduler(scheduler_store, scheduler_executor)
register_scheduler_routes(app, scheduler, scheduler_store)

@app.on_event("startup")
async def start_scheduler():
    asyncio.create_task(scheduler.run())
```

### 4.2 前端对齐清单

| API | 前端页面 | 功能 |
|-----|---------|------|
| `GET /api/scheduler/tasks` | `web/src/app/operations/scheduler/page.tsx` | 任务列表(名称/龙虾/调度/状态/上次运行) |
| `POST /api/scheduler/tasks` | 同上，创建对话框 | 新建定时任务(选龙虾/写prompt/选模式) |
| `DELETE /api/scheduler/tasks/{id}` | 同上，行操作 | 禁用任务 |
| `GET /api/scheduler/tasks/{id}/history` | 展开行详情 | 运行历史(时间/状态/耗时/摘要) |

---

## 五、与已有组件关系

| 组件 | 关系 |
|------|------|
| `heartbeat_engine.py` | 心跳是龙虾状态检查，Scheduler 是任务调度，**互补不重叠** |
| `lobster_runner.py` | Scheduler 通过 runner 执行任务 |
| `dispatcher.py` (点兵虾) | 点兵虾的"定时发布"能力由 Scheduler 驱动 |
| `CODEX_TASK_LIFECYCLE_HEARTBEAT.md` | 心跳检查间隔 ≠ 业务定时任务 |

---

## 六、验收标准

- [ ] `cron_scheduler.py` 支持 cron/every/once 三种模式
- [ ] SQLite 持久化，重启不丢失
- [ ] isolated session 模式不污染对话历史
- [ ] 4 个 API 端点正常工作
- [ ] 测试覆盖 ≥ 80%
- [ ] `app.py` startup 中自动启动 scheduler
