"""
Edge scheduler for offline-capable background jobs and persisted SOP schedules.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

try:  # pragma: no cover - optional dependency
    from apscheduler import AsyncScheduler  # type: ignore
    from apscheduler.datastores.sqlalchemy import SQLAlchemyDataStore  # type: ignore
    from apscheduler.eventbrokers.local import LocalEventBroker  # type: ignore
    from apscheduler.triggers.cron import CronTrigger  # type: ignore
    from apscheduler.triggers.date import DateTrigger  # type: ignore

    APSCHEDULER_AVAILABLE = True
except Exception:  # noqa: BLE001
    AsyncScheduler = None  # type: ignore[assignment]
    SQLAlchemyDataStore = None  # type: ignore[assignment]
    LocalEventBroker = None  # type: ignore[assignment]
    CronTrigger = None  # type: ignore[assignment]
    DateTrigger = None  # type: ignore[assignment]
    APSCHEDULER_AVAILABLE = False


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


@dataclass
class CronJob:
    name: str
    interval_seconds: int
    handler: Callable[[], Awaitable[Any]]
    description: str = ""
    last_run: datetime | None = None
    run_count: int = 0
    error_count: int = 0
    enabled: bool = True
    running: bool = False


class EdgeScheduler:
    """Hybrid scheduler: legacy interval loop + persisted SOP scheduler."""

    def __init__(
        self,
        edge_node_id: str = "",
        *,
        db_path: str | None = None,
        use_apscheduler: bool | None = None,
        sop_poll_interval_seconds: int = 15,
    ) -> None:
        self.edge_node_id = str(edge_node_id or "edge-node").strip() or "edge-node"
        raw_db = db_path or os.getenv("EDGE_SCHEDULER_DB_PATH", "~/.openclaw/edge_scheduler.db")
        self._db_path = Path(raw_db).expanduser()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self.jobs: dict[str, CronJob] = {}
        self._running = False
        self._loop_task: asyncio.Task[None] | None = None
        self._sop_loop_task: asyncio.Task[None] | None = None
        self._apscheduler = None
        self._apscheduler_ready = False
        self._use_apscheduler = APSCHEDULER_AVAILABLE if use_apscheduler is None else bool(use_apscheduler)
        self._sop_executor: Callable[[dict[str, Any], str], Awaitable[Any]] | None = None
        self._execution_log_reporter: Callable[[list[dict[str, Any]]], Awaitable[Any]] | None = None
        self._sync_requester: Callable[[], Awaitable[Any]] | None = None
        self._sop_poll_interval_seconds = max(5, int(sop_poll_interval_seconds or 15))
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS scheduled_sops (
                    job_id TEXT PRIMARY KEY,
                    cron_expr TEXT DEFAULT '',
                    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
                    run_at TEXT DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    expires_at TEXT DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'active',
                    last_fire_at TEXT DEFAULT '',
                    next_fire_at TEXT DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_scheduled_sops_status_next
                    ON scheduled_sops(status, next_fire_at);
                CREATE TABLE IF NOT EXISTS scheduler_execution_logs (
                    log_id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    sent INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_scheduler_logs_sent
                    ON scheduler_execution_logs(sent, created_at);
                """
            )
            conn.commit()

    def set_sop_executor(self, executor: Callable[[dict[str, Any], str], Awaitable[Any]]) -> None:
        self._sop_executor = executor

    def set_execution_log_reporter(self, reporter: Callable[[list[dict[str, Any]]], Awaitable[Any]]) -> None:
        self._execution_log_reporter = reporter

    def set_sync_requester(self, requester: Callable[[], Awaitable[Any]]) -> None:
        self._sync_requester = requester

    def register_job(
        self,
        *,
        name: str,
        interval_seconds: int,
        handler: Callable[[], Awaitable[Any]],
        description: str = "",
        enabled: bool = True,
    ) -> None:
        self.jobs[name] = CronJob(
            name=name,
            interval_seconds=max(1, int(interval_seconds)),
            handler=handler,
            description=description,
            enabled=enabled,
        )
        logger.info("[Scheduler] Registered job %s (%ss)", name, interval_seconds)

    def enable_job(self, name: str) -> None:
        if name in self.jobs:
            self.jobs[name].enabled = True
            return
        with self._connect() as conn:
            conn.execute("UPDATE scheduled_sops SET status='active', updated_at=? WHERE job_id=?", (_utc_now_iso(), name))
            conn.commit()

    def disable_job(self, name: str) -> None:
        if name in self.jobs:
            self.jobs[name].enabled = False
            return
        with self._connect() as conn:
            conn.execute("UPDATE scheduled_sops SET status='disabled', updated_at=? WHERE job_id=?", (_utc_now_iso(), name))
            conn.commit()

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        await self._start_apscheduler_backend()
        self._refresh_next_fire_times()
        logger.info("[Scheduler] Started with %s interval jobs", len(self.jobs))
        self._loop_task = asyncio.create_task(self._scheduler_loop())
        if not self._apscheduler_ready:
            self._sop_loop_task = asyncio.create_task(self._sop_poll_loop())

    async def stop(self) -> None:
        self._running = False
        if self._loop_task:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass
            self._loop_task = None
        if self._sop_loop_task:
            self._sop_loop_task.cancel()
            try:
                await self._sop_loop_task
            except asyncio.CancelledError:
                pass
            self._sop_loop_task = None
        if self._apscheduler_ready and self._apscheduler is not None:  # pragma: no cover - optional dependency path
            try:
                stop_method = getattr(self._apscheduler, "stop", None)
                if callable(stop_method):
                    await self._maybe_await(stop_method())
            except Exception:
                pass
            self._apscheduler = None
            self._apscheduler_ready = False
        logger.info("[Scheduler] Stopped")

    async def _start_apscheduler_backend(self) -> None:
        if not self._use_apscheduler or not APSCHEDULER_AVAILABLE:  # pragma: no cover - optional dependency
            return
        try:
            data_store = SQLAlchemyDataStore(f"sqlite+aiosqlite:///{self._db_path}")
            event_broker = LocalEventBroker()
            self._apscheduler = AsyncScheduler(
                data_store=data_store,
                event_broker=event_broker,
                identity=self.edge_node_id,
            )
            if hasattr(self._apscheduler, "start_in_background"):
                await self._maybe_await(self._apscheduler.start_in_background())
            elif hasattr(self._apscheduler, "start"):
                await self._maybe_await(self._apscheduler.start())
            self._apscheduler_ready = True
            await self._reload_sop_jobs_into_apscheduler()
            logger.info("[Scheduler] APScheduler backend active")
        except Exception as exc:  # noqa: BLE001
            self._apscheduler = None
            self._apscheduler_ready = False
            logger.warning("[Scheduler] APScheduler unavailable, fallback to local poller: %s", exc)

    async def _reload_sop_jobs_into_apscheduler(self) -> None:  # pragma: no cover - optional dependency
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT job_id, cron_expr, timezone, run_at, payload_json, status FROM scheduled_sops WHERE status = 'active'"
            ).fetchall()
        for row in rows:
            try:
                await self._upsert_aps_job(dict(row))
            except Exception as exc:
                logger.warning("[Scheduler] failed to restore APS job %s: %s", row["job_id"], exc)

    async def _scheduler_loop(self) -> None:
        try:
            while self._running:
                now = datetime.now()
                for job in self.jobs.values():
                    if not job.enabled or job.running:
                        continue
                    if job.last_run is None or (now - job.last_run).total_seconds() >= job.interval_seconds:
                        job.running = True
                        asyncio.create_task(self._run_job(job, now))
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            return

    async def _run_job(self, job: CronJob, run_time: datetime) -> None:
        try:
            await job.handler()
            job.last_run = run_time
            job.run_count += 1
        except Exception as exc:  # noqa: BLE001
            job.error_count += 1
            logger.error("[Scheduler] Job %s failed: %s", job.name, exc)
        finally:
            job.running = False

    async def _sop_poll_loop(self) -> None:
        try:
            while self._running:
                await self.run_due_sops()
                await asyncio.sleep(self._sop_poll_interval_seconds)
        except asyncio.CancelledError:
            return

    async def sync_sop_from_cloud(self, sop_schedule: dict[str, Any]) -> dict[str, Any]:
        normalized = self._normalize_sop_schedule(sop_schedule)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO scheduled_sops(
                    job_id, cron_expr, timezone, run_at, payload_json, expires_at,
                    status, last_fire_at, next_fire_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'active', '', ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                    cron_expr=excluded.cron_expr,
                    timezone=excluded.timezone,
                    run_at=excluded.run_at,
                    payload_json=excluded.payload_json,
                    expires_at=excluded.expires_at,
                    status='active',
                    next_fire_at=excluded.next_fire_at,
                    updated_at=excluded.updated_at
                """,
                (
                    normalized["job_id"],
                    normalized["cron_expr"],
                    normalized["timezone"],
                    normalized["run_at"],
                    json.dumps(normalized["payload"], ensure_ascii=False),
                    normalized["expires_at"],
                    normalized["next_fire_at"],
                    normalized["created_at"],
                    normalized["updated_at"],
                ),
            )
            conn.commit()
        if self._apscheduler_ready:
            try:
                await self._upsert_aps_job(normalized)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[Scheduler] APS sync failed for %s: %s", normalized["job_id"], exc)
        return normalized

    async def remove_sop(self, job_id: str) -> bool:
        normalized = str(job_id or "").strip()
        if not normalized:
            return False
        deleted = False
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM scheduled_sops WHERE job_id = ?", (normalized,))
            conn.commit()
            deleted = int(cur.rowcount or 0) > 0
        if deleted and self._apscheduler_ready:
            try:
                await self._remove_aps_job(normalized)
            except Exception:
                pass
        return deleted

    async def list_scheduled_sops(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT job_id, cron_expr, timezone, run_at, expires_at, status, last_fire_at, next_fire_at, created_at, updated_at
                FROM scheduled_sops
                ORDER BY next_fire_at ASC, created_at ASC
                """
            ).fetchall()
        return [dict(row) for row in rows]

    async def run_due_sops(self) -> int:
        now = _utc_now()
        executed = 0
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT job_id, cron_expr, timezone, run_at, payload_json, expires_at, status, last_fire_at, next_fire_at
                FROM scheduled_sops
                WHERE status = 'active'
                ORDER BY next_fire_at ASC, created_at ASC
                """
            ).fetchall()
        for row in rows:
            schedule = dict(row)
            expires_at = self._parse_datetime(str(schedule.get("expires_at") or ""))
            if expires_at is not None and expires_at <= now:
                await self.remove_sop(str(schedule["job_id"]))
                continue
            next_fire = self._parse_datetime(str(schedule.get("next_fire_at") or ""))
            if next_fire is None:
                run_at = self._parse_datetime(str(schedule.get("run_at") or ""))
                last_fire = self._parse_datetime(str(schedule.get("last_fire_at") or ""))
                if run_at is None or last_fire is not None or run_at > now:
                    continue
            elif next_fire > now:
                continue
            await self._execute_sop(schedule)
            executed += 1
        return executed

    async def flush_pending_logs(self) -> int:
        reporter = self._execution_log_reporter
        if reporter is None:
            return 0
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT log_id, payload_json FROM scheduler_execution_logs WHERE sent = 0 ORDER BY created_at ASC"
            ).fetchall()
        if not rows:
            return 0
        payloads = [json.loads(str(row["payload_json"] or "{}")) for row in rows]
        try:
            result = reporter(payloads)
            if inspect.isawaitable(result):
                await result
        except Exception:
            return 0
        ids = [str(row["log_id"]) for row in rows]
        placeholders = ",".join("?" for _ in ids)
        with self._connect() as conn:
            conn.execute(f"UPDATE scheduler_execution_logs SET sent = 1 WHERE log_id IN ({placeholders})", ids)
            conn.commit()
        return len(ids)

    async def on_reconnect(self) -> None:
        await self.flush_pending_logs()
        requester = self._sync_requester
        if requester is not None:
            try:
                result = requester()
                if inspect.isawaitable(result):
                    await result
            except Exception:
                pass

    def get_status(self) -> list[dict[str, Any]]:
        now = datetime.now()
        rows: list[dict[str, Any]] = []
        for job in self.jobs.values():
            if job.last_run is None:
                next_run_in = job.interval_seconds
            else:
                elapsed = (now - job.last_run).total_seconds()
                next_run_in = max(0, int(job.interval_seconds - elapsed))
            rows.append(
                {
                    "name": job.name,
                    "description": job.description,
                    "kind": "interval",
                    "interval_seconds": job.interval_seconds,
                    "enabled": job.enabled,
                    "running": job.running,
                    "last_run": job.last_run.isoformat() if job.last_run else None,
                    "run_count": job.run_count,
                    "error_count": job.error_count,
                    "next_run_in": next_run_in,
                    "backend": "legacy",
                }
            )
        with self._connect() as conn:
            sop_rows = conn.execute(
                "SELECT job_id, cron_expr, timezone, run_at, status, last_fire_at, next_fire_at FROM scheduled_sops ORDER BY next_fire_at ASC"
            ).fetchall()
        now_utc = _utc_now()
        for row in sop_rows:
            next_fire = self._parse_datetime(str(row["next_fire_at"] or ""))
            next_run_in = int(max(0, (next_fire - now_utc).total_seconds())) if next_fire else None
            rows.append(
                {
                    "name": str(row["job_id"]),
                    "description": f"sop:{row['cron_expr'] or row['run_at']}",
                    "kind": "sop",
                    "interval_seconds": None,
                    "enabled": str(row["status"]) == "active",
                    "running": False,
                    "last_run": str(row["last_fire_at"] or "") or None,
                    "run_count": 0,
                    "error_count": 0,
                    "next_run_in": next_run_in,
                    "cron": str(row["cron_expr"] or "") or None,
                    "timezone": str(row["timezone"] or "Asia/Shanghai"),
                    "run_at": str(row["run_at"] or "") or None,
                    "backend": "apscheduler" if self._apscheduler_ready else "sqlite_fallback",
                }
            )
        return rows

    def _normalize_sop_schedule(self, sop_schedule: dict[str, Any]) -> dict[str, Any]:
        job_id = str(sop_schedule.get("job_id") or sop_schedule.get("id") or "").strip()
        if not job_id:
            raise ValueError("job_id is required")
        cron_expr = str(sop_schedule.get("cron") or "").strip()
        run_at = str(sop_schedule.get("run_at") or "").strip()
        timezone_name = str(sop_schedule.get("timezone") or "Asia/Shanghai").strip() or "Asia/Shanghai"
        payload = sop_schedule.get("payload") if isinstance(sop_schedule.get("payload"), dict) else {}
        expires_at = str(sop_schedule.get("expires_at") or "").strip()
        now_iso = _utc_now_iso()
        next_fire = self._compute_next_fire(cron_expr=cron_expr, run_at=run_at, timezone_name=timezone_name, after_dt=_utc_now())
        return {
            "job_id": job_id,
            "cron_expr": cron_expr,
            "run_at": run_at,
            "timezone": timezone_name,
            "payload": payload,
            "expires_at": expires_at,
            "next_fire_at": next_fire.isoformat() if next_fire else "",
            "created_at": now_iso,
            "updated_at": now_iso,
        }

    def _refresh_next_fire_times(self) -> None:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT job_id, cron_expr, timezone, run_at, last_fire_at, status FROM scheduled_sops"
            ).fetchall()
            for row in rows:
                row_dict = dict(row)
                if str(row_dict.get("status") or "active") != "active":
                    continue
                after_dt = self._parse_datetime(str(row_dict.get("last_fire_at") or "")) or _utc_now()
                next_fire = self._compute_next_fire(
                    cron_expr=str(row_dict.get("cron_expr") or ""),
                    run_at=str(row_dict.get("run_at") or ""),
                    timezone_name=str(row_dict.get("timezone") or "Asia/Shanghai"),
                    after_dt=after_dt,
                )
                conn.execute(
                    "UPDATE scheduled_sops SET next_fire_at = ?, updated_at = ? WHERE job_id = ?",
                    ((next_fire.isoformat() if next_fire else ""), _utc_now_iso(), row_dict["job_id"]),
                )
            conn.commit()

    async def _execute_sop(self, schedule: dict[str, Any]) -> None:
        payload = json.loads(str(schedule.get("payload_json") or "{}")) if "payload_json" in schedule else dict(schedule.get("payload") or {})
        job_id = str(schedule.get("job_id") or "").strip()
        started = _utc_now()
        success = False
        error_msg = ""
        try:
            if self._sop_executor is None:
                raise RuntimeError("sop_executor_not_configured")
            result = self._sop_executor(payload, job_id)
            if inspect.isawaitable(result):
                await result
            success = True
        except Exception as exc:  # noqa: BLE001
            error_msg = str(exc)[:1000]
            logger.error("[Scheduler] SOP %s failed: %s", job_id, exc)
        finished = _utc_now()
        await self._store_execution_log(
            {
                "edge_node_id": self.edge_node_id,
                "job_id": job_id,
                "started_at": started.isoformat(),
                "finished_at": finished.isoformat(),
                "success": success,
                "error": error_msg or None,
                "offline_executed": True,
            }
        )
        next_fire = self._compute_next_fire(
            cron_expr=str(schedule.get("cron_expr") or ""),
            run_at=str(schedule.get("run_at") or ""),
            timezone_name=str(schedule.get("timezone") or "Asia/Shanghai"),
            after_dt=finished,
        )
        next_fire_iso = next_fire.isoformat() if next_fire else ""
        next_status = "active" if next_fire else "completed"
        with self._connect() as conn:
            conn.execute(
                "UPDATE scheduled_sops SET last_fire_at = ?, next_fire_at = ?, status = ?, updated_at = ? WHERE job_id = ?",
                (finished.isoformat(), next_fire_iso, next_status, _utc_now_iso(), job_id),
            )
            conn.commit()
        await self.flush_pending_logs()

    async def _store_execution_log(self, payload: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO scheduler_execution_logs(log_id, job_id, payload_json, sent, created_at) VALUES (?, ?, ?, 0, ?)",
                (
                    f"log_{int(time.time() * 1000)}_{payload.get('job_id')}",
                    str(payload.get("job_id") or ""),
                    json.dumps(payload, ensure_ascii=False),
                    _utc_now_iso(),
                ),
            )
            conn.commit()

    async def _upsert_aps_job(self, schedule: dict[str, Any]) -> None:  # pragma: no cover - optional dependency
        if not self._apscheduler_ready or self._apscheduler is None:
            return
        await self._remove_aps_job(str(schedule["job_id"]))
        trigger = None
        if str(schedule.get("cron_expr") or "").strip():
            trigger = CronTrigger.from_crontab(str(schedule["cron_expr"]), timezone=str(schedule.get("timezone") or "Asia/Shanghai"))
        elif str(schedule.get("run_at") or "").strip():
            run_at = self._parse_datetime(str(schedule["run_at"]))
            if run_at is not None:
                trigger = DateTrigger(run_at)
        if trigger is None:
            return
        handler = getattr(self._apscheduler, "add_schedule", None)
        if callable(handler):
            result = handler(self._aps_execute_sop, trigger=trigger, id=str(schedule["job_id"]), kwargs={"job_id": str(schedule["job_id"])})
            await self._maybe_await(result)
            return
        handler = getattr(self._apscheduler, "add_job", None)
        if callable(handler):
            result = handler(self._aps_execute_sop, trigger=trigger, id=str(schedule["job_id"]), kwargs={"job_id": str(schedule["job_id"])})
            await self._maybe_await(result)

    async def _remove_aps_job(self, job_id: str) -> None:  # pragma: no cover - optional dependency
        if not self._apscheduler_ready or self._apscheduler is None:
            return
        for method_name in ("remove_schedule", "remove_job"):
            method = getattr(self._apscheduler, method_name, None)
            if callable(method):
                try:
                    result = method(job_id)
                    await self._maybe_await(result)
                except Exception:
                    pass

    async def _aps_execute_sop(self, job_id: str) -> None:  # pragma: no cover - optional dependency
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT job_id, cron_expr, timezone, run_at, payload_json, expires_at, status, last_fire_at, next_fire_at
                FROM scheduled_sops WHERE job_id = ?
                """,
                (job_id,),
            ).fetchone()
        if row is None:
            return
        await self._execute_sop(dict(row))

    async def _maybe_await(self, value: Any) -> Any:  # pragma: no cover - helper
        if inspect.isawaitable(value):
            return await value
        return value

    def _compute_next_fire(
        self,
        *,
        cron_expr: str,
        run_at: str,
        timezone_name: str,
        after_dt: datetime,
    ) -> datetime | None:
        if run_at:
            run_time = self._parse_datetime(run_at)
            if run_time is None:
                return None
            return run_time if run_time > after_dt else None
        if not cron_expr:
            return None
        tz = self._resolve_timezone(timezone_name)
        cursor = _ensure_aware(after_dt).astimezone(tz).replace(second=0, microsecond=0) + timedelta(minutes=1)
        for _ in range(60 * 24 * 370):
            if self._cron_matches(cursor, cron_expr):
                return cursor.astimezone(timezone.utc)
            cursor += timedelta(minutes=1)
        return None

    @staticmethod
    def _resolve_timezone(name: str) -> timezone | ZoneInfo:
        try:
            return ZoneInfo(str(name or "UTC"))
        except Exception:
            return timezone.utc

    def _cron_matches(self, dt: datetime, expr: str) -> bool:
        parts = [part.strip() for part in str(expr or "").split()]
        if len(parts) != 5:
            return False
        minute, hour, day, month, weekday = parts
        return (
            self._field_matches(dt.minute, minute, 0, 59)
            and self._field_matches(dt.hour, hour, 0, 23)
            and self._field_matches(dt.day, day, 1, 31)
            and self._field_matches(dt.month, month, 1, 12)
            and self._field_matches(dt.weekday(), weekday, 0, 6, sunday_alias=True)
        )

    def _field_matches(self, value: int, expr: str, min_value: int, max_value: int, sunday_alias: bool = False) -> bool:
        if expr == "*":
            return True
        for part in expr.split(","):
            part = part.strip()
            if not part:
                continue
            if "/" in part:
                base, step_raw = part.split("/", 1)
                try:
                    step = max(1, int(step_raw))
                except ValueError:
                    continue
                if base == "*":
                    if (value - min_value) % step == 0:
                        return True
                    continue
                if "-" in base:
                    start_raw, end_raw = base.split("-", 1)
                    start = int(start_raw)
                    end = int(end_raw)
                    if sunday_alias and start == 7:
                        start = 0
                    if sunday_alias and end == 7:
                        end = 0
                    if start <= value <= end and (value - start) % step == 0:
                        return True
                    continue
            if "-" in part:
                start_raw, end_raw = part.split("-", 1)
                try:
                    start = int(start_raw)
                    end = int(end_raw)
                except ValueError:
                    continue
                if sunday_alias and start == 7:
                    start = 0
                if sunday_alias and end == 7:
                    end = 0
                if start <= value <= end:
                    return True
                continue
            try:
                target = int(part)
            except ValueError:
                continue
            if sunday_alias and target == 7:
                target = 0
            if value == target:
                return True
        return False

    @staticmethod
    def _parse_datetime(raw: str) -> datetime | None:
        text = str(raw or "").strip()
        if not text:
            return None
        try:
            return _ensure_aware(datetime.fromisoformat(text.replace("Z", "+00:00")))
        except ValueError:
            return None
