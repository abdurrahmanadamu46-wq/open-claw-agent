from __future__ import annotations

import asyncio
import calendar
import json
import logging
import sqlite3
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from platform_adapters.base import PublishTask

logger = logging.getLogger(__name__)

OPTIMAL_PUBLISH_WINDOWS = {
    "xiaohongshu": ["07:30", "12:00", "18:30", "21:00"],
    "douyin": ["07:00", "12:30", "18:00", "21:30"],
    "weixin_video": ["08:00", "12:00", "20:00"],
    "weixin_gzh": ["07:30", "12:00", "17:30"],
}


class PublishScheduler:
    def __init__(
        self,
        *,
        db_path: str = "./data/edge_publish_scheduler.sqlite",
        publish_handler: Callable[[PublishTask], Awaitable[dict[str, Any]] | Awaitable[Any]],
        poll_interval_seconds: int = 15,
    ) -> None:
        self._db_path = Path(db_path)
        if not self._db_path.is_absolute():
            self._db_path = (Path(__file__).resolve().parent / self._db_path).resolve()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._publish_handler = publish_handler
        self._poll_interval_seconds = max(5, int(poll_interval_seconds or 15))
        self._loop_task: asyncio.Task[None] | None = None
        self._running = False
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS scheduled_publish_jobs (
                    job_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    run_at TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'scheduled',
                    task_json TEXT NOT NULL,
                    last_error TEXT DEFAULT '',
                    last_result_json TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_publish_jobs_status_runat
                    ON scheduled_publish_jobs(status, run_at);
                """
            )
            conn.commit()

    @staticmethod
    def _utc_now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._loop_task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        self._running = False
        if self._loop_task is not None:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass
            self._loop_task = None

    async def _run_loop(self) -> None:
        while self._running:
            try:
                await self.run_due_jobs()
            except Exception as exc:  # noqa: BLE001
                logger.warning("[PublishScheduler] run_due_jobs failed: %s", exc)
            await asyncio.sleep(self._poll_interval_seconds)

    async def schedule_publish(self, task: PublishTask) -> str:
        run_at = task.scheduled_at or self._find_next_optimal_slot(task.platform).isoformat()
        job_id = f"publish_{task.task_id}"
        now = self._utc_now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO scheduled_publish_jobs(job_id, task_id, run_at, status, task_json, created_at, updated_at)
                VALUES (?, ?, ?, 'scheduled', ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET run_at = excluded.run_at, task_json = excluded.task_json, updated_at = excluded.updated_at
                """,
                (
                    job_id,
                    task.task_id,
                    run_at,
                    json.dumps(asdict(task), ensure_ascii=False),
                    now,
                    now,
                ),
            )
            conn.commit()
        return job_id

    async def schedule_batch(self, tasks: list[PublishTask]) -> list[str]:
        job_ids: list[str] = []
        for index, task in enumerate(tasks):
            task.scheduled_at = self._distribute_across_month(task.platform, len(tasks), index).isoformat()
            job_ids.append(await self.schedule_publish(task))
        return job_ids

    async def run_due_jobs(self) -> list[str]:
        now = datetime.now(timezone.utc)
        due: list[sqlite3.Row] = []
        with self._connect() as conn:
            due = conn.execute(
                "SELECT * FROM scheduled_publish_jobs WHERE status = 'scheduled' ORDER BY run_at ASC"
            ).fetchall()
        executed: list[str] = []
        for row in due:
            run_at = datetime.fromisoformat(str(row["run_at"]).replace("Z", "+00:00"))
            if run_at > now:
                continue
            task_dict = json.loads(str(row["task_json"] or "{}"))
            task = PublishTask(**task_dict)
            executed.append(str(row["job_id"]))
            with self._connect() as conn:
                conn.execute(
                    "UPDATE scheduled_publish_jobs SET status = 'running', updated_at = ? WHERE job_id = ?",
                    (self._utc_now_iso(), row["job_id"]),
                )
                conn.commit()
            try:
                result = await self._publish_handler(task)
                with self._connect() as conn:
                    conn.execute(
                        "UPDATE scheduled_publish_jobs SET status = 'completed', last_result_json = ?, updated_at = ? WHERE job_id = ?",
                        (json.dumps(result or {}, ensure_ascii=False), self._utc_now_iso(), row["job_id"]),
                    )
                    conn.commit()
            except Exception as exc:  # noqa: BLE001
                with self._connect() as conn:
                    conn.execute(
                        "UPDATE scheduled_publish_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE job_id = ?",
                        (str(exc)[:2000], self._utc_now_iso(), row["job_id"]),
                    )
                    conn.commit()
        return executed

    def get_status(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT job_id, task_id, run_at, status, last_error, created_at, updated_at FROM scheduled_publish_jobs ORDER BY run_at ASC"
            ).fetchall()
        return [dict(row) for row in rows]

    def _find_next_optimal_slot(self, platform: str) -> datetime:
        now = datetime.now()
        windows = OPTIMAL_PUBLISH_WINDOWS.get(platform, ["12:00"])
        for window in windows:
            hour, minute = map(int, window.split(":"))
            slot = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if slot > now:
                return slot.astimezone()
        hour, minute = map(int, windows[0].split(":"))
        return (now + timedelta(days=1)).replace(hour=hour, minute=minute, second=0, microsecond=0).astimezone()

    def _distribute_across_month(self, platform: str, total: int, index: int) -> datetime:
        now = datetime.now()
        cal = calendar.monthcalendar(now.year, now.month)
        workdays: list[int] = []
        for week in cal:
            for day_idx in range(5):
                day = week[day_idx]
                if day > 0 and day >= now.day:
                    workdays.append(day)
        if not workdays:
            workdays = list(range(1, 29))
        publish_day = workdays[index % len(workdays)]
        windows = OPTIMAL_PUBLISH_WINDOWS.get(platform, ["12:00"])
        hour, minute = map(int, windows[index % len(windows)].split(":"))
        return datetime(now.year, now.month, publish_day, hour, minute, 0, tzinfo=now.astimezone().tzinfo)
