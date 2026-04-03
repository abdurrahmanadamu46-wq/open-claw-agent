"""
Cron/scheduler engine for lobster runtime automation.

Borrowing notes:
- Awesome OpenClaw use cases inspired cron/every/once modes.
- This module stays runtime-focused and keeps execution delegated to LobsterRunner.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Awaitable, Callable

logger = logging.getLogger("cron_scheduler")

try:
    from pydantic import BaseModel, Field
except Exception:  # noqa: BLE001
    BaseModel = object  # type: ignore[assignment,misc]
    Field = lambda *args, **kwargs: None  # type: ignore[assignment]


class ScheduleKind(str, Enum):
    CRON = "cron"
    EVERY = "every"
    ONCE = "once"


class SessionMode(str, Enum):
    SHARED = "shared"
    ISOLATED = "isolated"


@dataclass(slots=True)
class ScheduledTask:
    task_id: str
    name: str
    kind: ScheduleKind
    schedule: str
    lobster_id: str
    prompt: str
    session_mode: SessionMode = SessionMode.ISOLATED
    delivery_channel: str = "last"
    max_retries: int = 2
    enabled: bool = True
    tenant_id: str = "default"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_run_at: str | None = None
    next_run_at: str | None = None
    run_count: int = 0
    fail_count: int = 0

    @staticmethod
    def generate_id(name: str, tenant_id: str = "default") -> str:
        return hashlib.sha256(f"{tenant_id}:{name}".encode("utf-8")).hexdigest()[:12]


class ScheduledTaskCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    kind: str = Field(..., pattern="^(cron|every|once)$")
    schedule: str = Field(..., min_length=1, max_length=120)
    lobster_id: str = Field(..., min_length=1, max_length=64)
    prompt: str = Field(..., min_length=1, max_length=4000)
    session_mode: str = Field(default="isolated", pattern="^(shared|isolated)$")
    delivery_channel: str = Field(default="last", min_length=1, max_length=64)
    max_retries: int = Field(default=2, ge=0, le=10)
    tenant_id: str = Field(default="default", min_length=1, max_length=128)
    enabled: bool = True


_INTERVAL_RE = re.compile(r"^(?P<value>\d+)(?P<unit>[smhd])$")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso_datetime(raw: str) -> datetime:
    value = str(raw or "").strip()
    if not value:
        raise ValueError("schedule timestamp is required")
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_interval(spec: str) -> timedelta:
    """Parse interval strings such as 30s / 15m / 1h / 2d."""
    match = _INTERVAL_RE.fullmatch(str(spec or "").strip().lower())
    if not match:
        raise ValueError(f"Invalid interval spec: {spec}")
    value = int(match.group("value"))
    unit = match.group("unit")
    mapping = {
        "s": "seconds",
        "m": "minutes",
        "h": "hours",
        "d": "days",
    }
    return timedelta(**{mapping[unit]: value})


def _parse_cron_next(cron_expr: str, now: datetime) -> datetime:
    """
    Resolve the next cron occurrence.

    Uses croniter when available and falls back to hourly when the dependency
    is absent to keep the runtime bootable in lightweight environments.
    """
    try:
        from croniter import croniter  # type: ignore

        next_run = croniter(cron_expr, now).get_next(datetime)
        if next_run.tzinfo is None:
            return next_run.replace(tzinfo=timezone.utc)
        return next_run.astimezone(timezone.utc)
    except ImportError:
        logger.warning("croniter not installed, falling back to hourly schedule for %s", cron_expr)
        return now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)


class SchedulerStore:
    """SQLite-backed scheduler task and run-log persistence."""

    def __init__(self, db_path: str = "data/scheduler.sqlite"):
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @property
    def db_path(self) -> str:
        return str(self._db_path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS scheduled_tasks (
                    task_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    schedule TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    session_mode TEXT NOT NULL DEFAULT 'isolated',
                    delivery_channel TEXT NOT NULL DEFAULT 'last',
                    max_retries INTEGER NOT NULL DEFAULT 2,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    tenant_id TEXT NOT NULL DEFAULT 'default',
                    created_at TEXT NOT NULL,
                    last_run_at TEXT,
                    next_run_at TEXT,
                    run_count INTEGER NOT NULL DEFAULT 0,
                    fail_count INTEGER NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_tenant
                    ON scheduled_tasks(tenant_id, enabled, next_run_at);

                CREATE TABLE IF NOT EXISTS task_run_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    status TEXT NOT NULL DEFAULT 'running',
                    result_summary TEXT,
                    error_message TEXT,
                    FOREIGN KEY (task_id) REFERENCES scheduled_tasks(task_id)
                );

                CREATE INDEX IF NOT EXISTS idx_task_run_log_task
                    ON task_run_log(task_id, started_at DESC);
                """
            )
            conn.commit()

    def upsert_task(self, task: ScheduledTask) -> ScheduledTask:
        payload = asdict(task)
        payload["kind"] = task.kind.value
        payload["session_mode"] = task.session_mode.value
        payload["enabled"] = 1 if task.enabled else 0
        columns = ", ".join(payload.keys())
        placeholders = ", ".join(["?"] * len(payload))
        with self._connect() as conn:
            conn.execute(
                f"INSERT OR REPLACE INTO scheduled_tasks ({columns}) VALUES ({placeholders})",
                list(payload.values()),
            )
            conn.commit()
        return task

    def get_task(self, task_id: str, tenant_id: str | None = None) -> ScheduledTask | None:
        query = "SELECT * FROM scheduled_tasks WHERE task_id = ?"
        params: list[Any] = [task_id]
        if tenant_id:
            query += " AND tenant_id = ?"
            params.append(tenant_id)
        with self._connect() as conn:
            row = conn.execute(query, params).fetchone()
        if row is None:
            return None
        return self._row_to_task(row)

    def list_tasks(self, tenant_id: str = "default", enabled_only: bool = True) -> list[ScheduledTask]:
        query = "SELECT * FROM scheduled_tasks WHERE tenant_id = ?"
        params: list[Any] = [tenant_id]
        if enabled_only:
            query += " AND enabled = 1"
        query += " ORDER BY COALESCE(next_run_at, created_at) ASC, created_at ASC"
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_task(row) for row in rows]

    def disable_task(self, task_id: str, tenant_id: str | None = None) -> bool:
        query = "UPDATE scheduled_tasks SET enabled = 0 WHERE task_id = ?"
        params: list[Any] = [task_id]
        if tenant_id:
            query += " AND tenant_id = ?"
            params.append(tenant_id)
        with self._connect() as conn:
            cur = conn.execute(query, params)
            conn.commit()
            return cur.rowcount > 0

    def start_run(self, task_id: str, started_at: str) -> int:
        with self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO task_run_log (task_id, started_at, status)
                VALUES (?, ?, 'running')
                """,
                (task_id, started_at),
            )
            conn.commit()
            return int(cur.lastrowid)

    def finish_run(
        self,
        run_id: int,
        *,
        finished_at: str,
        status: str,
        result_summary: str | None = None,
        error_message: str | None = None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE task_run_log
                   SET finished_at = ?, status = ?, result_summary = ?, error_message = ?
                 WHERE id = ?
                """,
                (finished_at, status, result_summary, error_message, run_id),
            )
            conn.commit()

    def update_run_status(self, task_id: str, now: str, next_run: str | None, *, success: bool) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE scheduled_tasks
                   SET last_run_at = ?,
                       next_run_at = ?,
                       run_count = run_count + 1,
                       fail_count = fail_count + ?
                 WHERE task_id = ?
                """,
                (now, next_run, 0 if success else 1, task_id),
            )
            conn.commit()

    def get_run_history(self, task_id: str, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                  FROM task_run_log
                 WHERE task_id = ?
                 ORDER BY started_at DESC
                 LIMIT ?
                """,
                (task_id, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_last_success_summary(self, task_id: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT result_summary
                  FROM task_run_log
                 WHERE task_id = ? AND status = 'success' AND result_summary IS NOT NULL
                 ORDER BY started_at DESC
                 LIMIT 1
                """,
                (task_id,),
            ).fetchone()
        if row is None:
            return None
        return str(row["result_summary"] or "").strip() or None

    @staticmethod
    def _row_to_task(row: sqlite3.Row) -> ScheduledTask:
        payload = dict(row)
        payload["kind"] = ScheduleKind(str(payload["kind"]))
        payload["session_mode"] = SessionMode(str(payload.get("session_mode") or SessionMode.ISOLATED.value))
        payload["enabled"] = bool(payload.get("enabled"))
        return ScheduledTask(**payload)


class CronScheduler:
    """Polling-based scheduler that executes due lobster tasks."""

    def __init__(
        self,
        store: SchedulerStore,
        executor: Callable[[ScheduledTask], Awaitable[str]],
        *,
        check_interval: float = 10.0,
    ):
        self._store = store
        self._executor = executor
        self._check_interval = max(0.2, float(check_interval))
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running

    def add_task(self, task: ScheduledTask) -> ScheduledTask:
        now = _now_utc()
        task.next_run_at = self._compute_next_run(task, now)
        self._store.upsert_task(task)
        logger.info(
            "Scheduled task %s (%s:%s) next run at %s",
            task.name,
            task.kind.value,
            task.schedule,
            task.next_run_at,
        )
        return task

    def remove_task(self, task_id: str, tenant_id: str | None = None) -> bool:
        removed = self._store.disable_task(task_id, tenant_id=tenant_id)
        if removed:
            logger.info("Disabled scheduled task %s", task_id)
        return removed

    async def run(self) -> None:
        self._running = True
        logger.info("CronScheduler started (check_interval=%ss)", self._check_interval)
        try:
            while self._running:
                try:
                    await self._tick()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Scheduler tick failed: %s", exc)
                await asyncio.sleep(self._check_interval)
        finally:
            self._running = False
            logger.info("CronScheduler stopped")

    def stop(self) -> None:
        self._running = False

    async def _tick(self) -> None:
        now = _now_utc()
        tenant_ids = self._list_tenants()
        for tenant_id in tenant_ids:
            for task in self._store.list_tasks(tenant_id=tenant_id, enabled_only=True):
                if not task.next_run_at:
                    task.next_run_at = self._compute_next_run(task, now)
                    self._store.upsert_task(task)
                    continue
                try:
                    next_run = _parse_iso_datetime(task.next_run_at)
                except Exception:
                    logger.warning("Invalid next_run_at for task %s, recomputing", task.task_id)
                    task.next_run_at = self._compute_next_run(task, now)
                    self._store.upsert_task(task)
                    continue
                if next_run <= now:
                    await self._execute_task(task, now)

    def _list_tenants(self) -> list[str]:
        with self._store._connect() as conn:  # noqa: SLF001
            rows = conn.execute("SELECT DISTINCT tenant_id FROM scheduled_tasks").fetchall()
        tenant_ids = [str(row["tenant_id"] or "default") for row in rows]
        return tenant_ids or ["default"]

    async def _execute_task(self, task: ScheduledTask, now: datetime) -> None:
        attempts = max(1, int(task.max_retries) + 1)
        result_summary: str | None = None

        for attempt in range(1, attempts + 1):
            attempt_started_at = _now_utc().isoformat()
            run_id = self._store.start_run(task.task_id, started_at=attempt_started_at)
            try:
                logger.info("Executing scheduled task %s attempt %s/%s", task.task_id, attempt, attempts)
                result_summary = await self._executor(task)
                self._store.finish_run(
                    run_id,
                    finished_at=_now_utc().isoformat(),
                    status="success",
                    result_summary=(result_summary or "")[:500] or None,
                )
                next_run = self._compute_next_run(task, now + timedelta(seconds=1))
                self._store.update_run_status(task.task_id, attempt_started_at, next_run, success=True)
                logger.info("Scheduled task %s completed; next run at %s", task.task_id, next_run)
                return
            except asyncio.CancelledError:
                self._store.finish_run(
                    run_id,
                    finished_at=_now_utc().isoformat(),
                    status="cancelled",
                    error_message="scheduler_cancelled",
                )
                raise
            except Exception as exc:  # noqa: BLE001
                self._store.finish_run(
                    run_id,
                    finished_at=_now_utc().isoformat(),
                    status="failed",
                    error_message=str(exc)[:500],
                )
                logger.warning(
                    "Scheduled task %s failed on attempt %s/%s: %s",
                    task.task_id,
                    attempt,
                    attempts,
                    exc,
                )
                if attempt >= attempts:
                    next_run = self._compute_next_run(task, now + timedelta(seconds=1))
                    self._store.update_run_status(task.task_id, attempt_started_at, next_run, success=False)
                    logger.error("Scheduled task %s exhausted retries; next run at %s", task.task_id, next_run)
                    return
                await asyncio.sleep(min(5.0, float(attempt)))

    def _compute_next_run(self, task: ScheduledTask, now: datetime) -> str | None:
        if task.kind == ScheduleKind.CRON:
            return _parse_cron_next(task.schedule, now).isoformat()
        if task.kind == ScheduleKind.EVERY:
            return (now + _parse_interval(task.schedule)).isoformat()
        if task.kind == ScheduleKind.ONCE:
            if task.run_count > 0 or task.last_run_at:
                return None
            return _parse_iso_datetime(task.schedule).isoformat()
        return None


def register_scheduler_routes(app: Any, scheduler: CronScheduler, store: SchedulerStore) -> None:
    """Register minimal scheduler CRUD and history routes onto FastAPI app."""
    from fastapi import HTTPException

    @app.get("/api/scheduler/tasks")
    async def list_scheduled_tasks(tenant_id: str = "default") -> dict[str, Any]:
        tasks = store.list_tasks(tenant_id=tenant_id, enabled_only=False)
        return {"ok": True, "tasks": [asdict(task) for task in tasks]}

    @app.post("/api/scheduler/tasks")
    async def create_scheduled_task(req: ScheduledTaskCreateRequest) -> dict[str, Any]:
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
            enabled=req.enabled,
        )
        try:
            scheduler.add_task(task)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "task_id": task.task_id, "next_run_at": task.next_run_at}

    @app.delete("/api/scheduler/tasks/{task_id}")
    async def delete_scheduled_task(task_id: str, tenant_id: str = "default") -> dict[str, Any]:
        removed = scheduler.remove_task(task_id, tenant_id=tenant_id)
        if not removed:
            raise HTTPException(status_code=404, detail="scheduled_task_not_found")
        return {"ok": True, "status": "disabled"}

    @app.get("/api/scheduler/tasks/{task_id}/history")
    async def get_task_history(task_id: str, limit: int = 20) -> dict[str, Any]:
        return {"ok": True, "history": store.get_run_history(task_id, limit=max(1, min(limit, 200)))}
