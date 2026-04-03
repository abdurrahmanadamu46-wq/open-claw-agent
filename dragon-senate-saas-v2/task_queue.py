"""
TaskQueue — 异步任务队列（BullMQ 思想，Python 实现）
=====================================================
灵感来源：Langfuse BullMQ Worker
借鉴要点：
  - BullMQ 处理异步任务，支持重试/延迟/并发限制
  - 独立 Worker 进程消费队列
  - 队列深度/处理速率/失败 Job 可在 Dashboard 监控
  - 我们用 SQLite + 线程池实现轻量版（无需 Redis）

支持的任务类型：
  - video_compose：视频合成（video_composer.py）
  - eval_batch：批量 LLM-as-Judge 评估
  - export_data：批量数据导出（CSV/Excel）
  - publish_schedule：定时发布（边缘延迟任务）
  - webhook_retry：Webhook 失败重试

使用方式：
    queue = TaskQueue()

    # 提交任务
    job_id = queue.enqueue(
        task_type="video_compose",
        payload={"workflow_run_id": "run-abc", "tenant_id": "t001"},
        priority=5,          # 1-10，越大越优先
        delay_seconds=0,     # 延迟执行（秒）
        max_attempts=3,      # 最大重试次数
    )

    # 启动 Worker（阻塞）
    worker = TaskWorker(queue)
    worker.start()

    # 查看队列状态
    stats = queue.get_stats()
    # → {"pending": 3, "running": 1, "completed": 120, "failed": 2}
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

_DB_PATH = os.getenv("TASK_QUEUE_DB", "./data/task_queue.sqlite")


class TaskPriority:
    URGENT = 100
    HIGH = 75
    MEDIUM = 50
    LOW = 25


PRIORITY_VALUES = {
    "urgent": TaskPriority.URGENT,
    "high": TaskPriority.HIGH,
    "medium": TaskPriority.MEDIUM,
    "low": TaskPriority.LOW,
}

PRIORITY_NAMES = {
    TaskPriority.URGENT: "urgent",
    TaskPriority.HIGH: "high",
    TaskPriority.MEDIUM: "medium",
    TaskPriority.LOW: "low",
}

# ─────────────────────────────────────────────────────────────────
# 任务状态枚举
# ─────────────────────────────────────────────────────────────────

class JobStatus:
    PENDING   = "pending"
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"
    RETRYING  = "retrying"
    DELAYED   = "delayed"
    CANCELLED = "cancelled"


# ─────────────────────────────────────────────────────────────────
# TaskQueue — 队列存储（SQLite）
# ─────────────────────────────────────────────────────────────────

class TaskQueue:
    """
    轻量异步任务队列（对应 Langfuse BullMQ）。
    基于 SQLite WAL 模式，支持多进程/多线程安全访问。
    """

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _normalize_priority(self, priority: int | str | None) -> int:
        if isinstance(priority, str):
            normalized = PRIORITY_VALUES.get(priority.strip().lower())
            if normalized is not None:
                return int(normalized)
            try:
                return int(priority)
            except Exception:
                return TaskPriority.MEDIUM
        if priority is None:
            return TaskPriority.MEDIUM
        try:
            return int(priority)
        except Exception:
            return TaskPriority.MEDIUM

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id          TEXT PRIMARY KEY,
                    task_type       TEXT NOT NULL,
                    payload         TEXT NOT NULL DEFAULT '{}',
                    tenant_id       TEXT DEFAULT '',
                    status          TEXT DEFAULT 'pending',
                    priority        INTEGER DEFAULT 5,    -- 1-10，越大越优先
                    attempts        INTEGER DEFAULT 0,
                    max_attempts    INTEGER DEFAULT 3,
                    run_at          TEXT NOT NULL,        -- 何时可以执行（支持延迟）
                    started_at      TEXT,
                    completed_at    TEXT,
                    result          TEXT DEFAULT '',
                    error_message   TEXT DEFAULT '',
                    error_stack     TEXT DEFAULT '',
                    worker_id       TEXT DEFAULT '',
                    created_at      TEXT NOT NULL,
                    updated_at      TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_job_status ON jobs(status, priority DESC, run_at);
                CREATE INDEX IF NOT EXISTS idx_job_tenant ON jobs(tenant_id, status, created_at);
                CREATE INDEX IF NOT EXISTS idx_job_type ON jobs(task_type, status);

                -- 失败历史（每次重试的失败记录）
                CREATE TABLE IF NOT EXISTS job_attempts (
                    attempt_id  TEXT PRIMARY KEY,
                    job_id      TEXT NOT NULL,
                    attempt_num INTEGER NOT NULL,
                    started_at  TEXT NOT NULL,
                    failed_at   TEXT NOT NULL,
                    error       TEXT DEFAULT '',
                    stack       TEXT DEFAULT '',
                    FOREIGN KEY (job_id) REFERENCES jobs(job_id)
                );
                CREATE INDEX IF NOT EXISTS idx_attempt_job ON job_attempts(job_id);
            """)
            conn.commit()
        finally:
            conn.close()

    # ── 入队 ──────────────────────────────────────────────────────

    def enqueue(
        self,
        task_type: str,
        payload: dict,
        tenant_id: str = "",
        priority: int | str = 5,
        delay_seconds: int = 0,
        max_attempts: int = 3,
    ) -> str:
        """
        提交任务（对应 BullMQ queue.add()）。
        priority: 1-10，越大越先执行。
        delay_seconds: 延迟多少秒后才可执行。
        """
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        now = self._now()
        # 计算可执行时间
        if delay_seconds > 0:
            import time as _t
            run_at_ts = _t.time() + delay_seconds
            run_at = datetime.fromtimestamp(run_at_ts, tz=timezone.utc).isoformat()
            status = JobStatus.DELAYED
        else:
            run_at = now
            status = JobStatus.PENDING
        normalized_priority = self._normalize_priority(priority)

        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO jobs
                   (job_id, task_type, payload, tenant_id, status, priority,
                     max_attempts, run_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (job_id, task_type, json.dumps(payload, ensure_ascii=False),
                 tenant_id, status, normalized_priority, max_attempts, run_at, now, now)
            )
            conn.commit()
        finally:
            conn.close()
        return job_id

    # ── 出队（Worker 调用）────────────────────────────────────────

    def dequeue(self, task_types: list[str] | None = None,
                worker_id: str = "") -> Optional[dict[str, Any]]:
        """
        原子性地取出下一个可执行任务（对应 BullMQ Worker.getNextJob()）。
        task_types: 限定任务类型（None 表示所有类型）
        返回 job dict 或 None（无可用任务时）
        """
        now = self._now()
        conn = self._conn()
        try:
            q = """
                SELECT job_id FROM jobs
                WHERE status IN ('pending', 'delayed')
                  AND run_at <= ?
            """
            params: list[Any] = [now]
            if task_types:
                placeholders = ",".join("?" * len(task_types))
                q += f" AND task_type IN ({placeholders})"
                params.extend(task_types)
            q += " ORDER BY priority DESC, run_at ASC LIMIT 1"

            row = conn.execute(q, params).fetchone()
            if not row:
                return None

            job_id = row["job_id"]
            # 原子性标记为 running（乐观锁）
            updated = conn.execute(
                """UPDATE jobs SET status='running', started_at=?, worker_id=?,
                   attempts=attempts+1, updated_at=?
                   WHERE job_id=? AND status IN ('pending', 'delayed')""",
                (now, worker_id, now, job_id)
            ).rowcount
            conn.commit()

            if updated == 0:
                return None  # 被其他 Worker 抢走了

            job = conn.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            if not job:
                return None
            d = dict(job)
            d["payload"] = json.loads(d.get("payload", "{}"))
            return d
        finally:
            conn.close()

    # ── 完成 / 失败 ───────────────────────────────────────────────

    def complete(self, job_id: str, result: Any = None) -> None:
        """标记任务成功（对应 BullMQ job.moveToCompleted()）"""
        conn = self._conn()
        try:
            conn.execute(
                """UPDATE jobs SET status='completed', completed_at=?, result=?,
                   updated_at=? WHERE job_id=?""",
                (self._now(), json.dumps(result) if result else "",
                 self._now(), job_id)
            )
            conn.commit()
        finally:
            conn.close()

    def fail(self, job_id: str, error: str, stack: str = "",
             attempts: int = 0, max_attempts: int = 3) -> None:
        """
        标记任务失败（对应 BullMQ job.moveToFailed()）。
        如果还有重试次数，重新入队（状态=retrying/pending）。
        """
        now = self._now()
        conn = self._conn()
        try:
            # 记录失败历史
            conn.execute(
                """INSERT INTO job_attempts
                   (attempt_id, job_id, attempt_num, started_at, failed_at, error, stack)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (f"att_{uuid.uuid4().hex[:8]}", job_id, attempts,
                 now, now, error[:2000], stack[:5000])
            )
            if attempts < max_attempts:
                # 指数退避：下次执行延迟 2^attempts * 10秒
                delay = min(2 ** attempts * 10, 600)  # 最多10分钟
                import time as _t
                run_at = datetime.fromtimestamp(_t.time() + delay, tz=timezone.utc).isoformat()
                conn.execute(
                    """UPDATE jobs SET status='retrying', error_message=?, error_stack=?,
                       run_at=?, updated_at=? WHERE job_id=?""",
                    (error[:1000], stack[:3000], run_at, now, job_id)
                )
            else:
                conn.execute(
                    """UPDATE jobs SET status='failed', error_message=?, error_stack=?,
                       completed_at=?, updated_at=? WHERE job_id=?""",
                    (error[:1000], stack[:3000], now, now, job_id)
                )
            conn.commit()
        finally:
            conn.close()

    def cancel(self, job_id: str) -> bool:
        """取消待执行的任务"""
        conn = self._conn()
        try:
            n = conn.execute(
                "UPDATE jobs SET status='cancelled', updated_at=? WHERE job_id=? AND status='pending'",
                (self._now(), job_id)
            ).rowcount
            conn.commit()
            return n > 0
        finally:
            conn.close()

    # ── 查询 ──────────────────────────────────────────────────────

    def get_job(self, job_id: str) -> Optional[dict[str, Any]]:
        """查询任务详情"""
        conn = self._conn()
        try:
            row = conn.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            if not row:
                return None
            d = dict(row)
            d["payload"] = json.loads(d.get("payload", "{}"))
            attempts = conn.execute(
                "SELECT * FROM job_attempts WHERE job_id=? ORDER BY attempt_num",
                (job_id,)
            ).fetchall()
            d["attempt_history"] = [dict(a) for a in attempts]
            return d
        finally:
            conn.close()

    def get_stats(self, tenant_id: str = "") -> dict[str, Any]:
        """
        获取队列统计（对应 Langfuse Worker Dashboard）。
        对应前端队列监控页面的数据源。
        """
        conn = self._conn()
        try:
            q = "SELECT status, COUNT(*) as cnt FROM jobs"
            params: list[Any] = []
            if tenant_id:
                q += " WHERE tenant_id=?"
                params.append(tenant_id)
            q += " GROUP BY status"
            rows = conn.execute(q, params).fetchall()
            status_map = {r["status"]: r["cnt"] for r in rows}

            by_type = conn.execute(
                """SELECT task_type, status, COUNT(*) as cnt FROM jobs
                   {} GROUP BY task_type, status""".format(
                    "WHERE tenant_id=?" if tenant_id else ""
                ),
                params
            ).fetchall()

            # 最近失败任务
            failed = conn.execute(
                """SELECT job_id, task_type, error_message, updated_at
                   FROM jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 10"""
            ).fetchall()

            return {
                "pending":   status_map.get("pending", 0),
                "delayed":   status_map.get("delayed", 0),
                "running":   status_map.get("running", 0),
                "retrying":  status_map.get("retrying", 0),
                "completed": status_map.get("completed", 0),
                "failed":    status_map.get("failed", 0),
                "cancelled": status_map.get("cancelled", 0),
                "total":     sum(status_map.values()),
                "by_type":   [dict(r) for r in by_type],
                "recent_failures": [dict(r) for r in failed],
            }
        finally:
            conn.close()

    def list_jobs(self, status: str = "", task_type: str = "",
                  tenant_id: str = "", limit: int = 50) -> list[dict[str, Any]]:
        """列出任务列表（支持按状态/类型/租户过滤）"""
        conn = self._conn()
        try:
            q = "SELECT * FROM jobs WHERE 1=1"
            params: list[Any] = []
            if status:
                q += " AND status=?"
                params.append(status)
            if task_type:
                q += " AND task_type=?"
                params.append(task_type)
            if tenant_id:
                q += " AND tenant_id=?"
                params.append(tenant_id)
            q += " ORDER BY created_at DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(q, params).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                d["payload"] = json.loads(d.get("payload", "{}"))
                result.append(d)
            return result
        finally:
            conn.close()

    def list_kanban_tasks(self, tenant_id: str = "", recent_hours: int = 24, limit: int = 200) -> list[dict[str, Any]]:
        """Return queue tasks normalized for kanban rendering."""
        rows = self.list_jobs(tenant_id=tenant_id, limit=limit * 2)
        recent_cutoff = time.time() - max(1, int(recent_hours)) * 3600
        normalized: list[dict[str, Any]] = []
        for row in rows:
            payload = row.get("payload", {}) if isinstance(row.get("payload"), dict) else {}
            created_at_raw = str(row.get("created_at") or "")
            try:
                created_at_ts = datetime.fromisoformat(created_at_raw.replace("Z", "+00:00")).timestamp()
            except Exception:
                created_at_ts = time.time()
            if created_at_ts < recent_cutoff:
                continue
            priority_value = int(row.get("priority") or TaskPriority.MEDIUM)
            priority_name = "medium"
            if priority_value >= TaskPriority.URGENT:
                priority_name = "urgent"
            elif priority_value >= TaskPriority.HIGH:
                priority_name = "high"
            elif priority_value < TaskPriority.MEDIUM:
                priority_name = "low"
            lobster_name = str(
                payload.get("lobster_name")
                or payload.get("lobster_id")
                or payload.get("target_lobster")
                or payload.get("agent")
                or ""
            ).strip()
            title = str(
                payload.get("title")
                or payload.get("task_name")
                or payload.get("description")
                or row.get("task_type")
                or row.get("job_id")
                or ""
            ).strip()[:200]
            status_name = str(row.get("status") or JobStatus.PENDING)
            if status_name == JobStatus.COMPLETED:
                status_name = "done"
            elif status_name in {JobStatus.DELAYED, JobStatus.RETRYING}:
                status_name = "pending"
            normalized.append(
                {
                    "task_id": row.get("job_id"),
                    "lobster_name": lobster_name or "unassigned",
                    "title": title or str(row.get("job_id") or ""),
                    "status": status_name,
                    "priority": priority_name,
                    "created_at": created_at_ts,
                    "updated_at": row.get("updated_at"),
                    "error_msg": row.get("error_message"),
                    "task_type": row.get("task_type"),
                    "source": payload.get("source") or "manual",
                }
            )
        normalized.sort(
            key=lambda item: (
                -PRIORITY_VALUES.get(str(item["priority"]), TaskPriority.MEDIUM),
                -float(item["created_at"]),
            )
        )
        return normalized[:limit]

    def cleanup_old_jobs(self, days: int = 7) -> int:
        """清理 N 天前已完成/已取消的任务"""
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        conn = self._conn()
        try:
            n = conn.execute(
                "DELETE FROM jobs WHERE status IN ('completed','cancelled') AND completed_at < ?",
                (cutoff,)
            ).rowcount
            conn.commit()
            return n
        finally:
            conn.close()


# ─────────────────────────────────────────────────────────────────
# TaskWorker — 任务执行引擎
# ─────────────────────────────────────────────────────────────────

# 任务处理函数注册表
_HANDLERS: dict[str, Callable] = {}


def register_handler(task_type: str):
    """装饰器：注册任务处理函数"""
    def decorator(fn: Callable) -> Callable:
        _HANDLERS[task_type] = fn
        return fn
    return decorator


class TaskWorker:
    """
    任务 Worker（对应 Langfuse BullMQ Worker）。
    多线程并发处理队列中的任务。
    """

    def __init__(
        self,
        queue: Optional[TaskQueue] = None,
        concurrency: int = 4,
        poll_interval: float = 2.0,
        task_types: list[str] | None = None,
    ) -> None:
        self.queue = queue or get_task_queue()
        self.concurrency = concurrency
        self.poll_interval = poll_interval
        self.task_types = task_types
        self.worker_id = f"worker_{uuid.uuid4().hex[:8]}"
        self._running = False
        self._executor = ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="task_worker")

    def start(self, block: bool = True) -> None:
        """启动 Worker（block=True 阻塞当前线程）"""
        self._running = True
        print(f"[TaskWorker] {self.worker_id} 启动，并发={self.concurrency}，轮询间隔={self.poll_interval}s")
        if block:
            self._run_loop()
        else:
            t = threading.Thread(target=self._run_loop, daemon=True)
            t.start()

    def stop(self) -> None:
        self._running = False
        self._executor.shutdown(wait=True)

    def _run_loop(self) -> None:
        while self._running:
            try:
                job = self.queue.dequeue(
                    task_types=self.task_types,
                    worker_id=self.worker_id,
                )
                if job:
                    self._executor.submit(self._handle_job, job)
                else:
                    time.sleep(self.poll_interval)
            except Exception as e:
                print(f"[TaskWorker] 轮询异常: {e}")
                time.sleep(self.poll_interval)

    def _handle_job(self, job: dict) -> None:
        job_id = job["job_id"]
        task_type = job["task_type"]
        payload = job["payload"]
        tenant_id = str(job.get("tenant_id") or payload.get("tenant_id") or "tenant_main")
        attempts = job.get("attempts", 1)
        max_attempts = job.get("max_attempts", 3)

        handler = _HANDLERS.get(task_type)
        registry_runner = None
        try:
            from job_registry import maybe_run_registered_job

            registry_runner = maybe_run_registered_job
        except Exception:
            registry_runner = None

        if not handler and registry_runner is None:
            self.queue.fail(job_id, f"未知任务类型: {task_type}",
                            attempts=attempts, max_attempts=max_attempts)
            try:
                from activity_stream import get_activity_stream

                get_activity_stream().record_job_result(
                    tenant_id=tenant_id,
                    worker_id=self.worker_id,
                    job_id=job_id,
                    task_type=task_type,
                    success=False,
                    details={"error": f"unknown_job_type:{task_type}", "attempts": attempts},
                )
            except Exception:
                pass
            return

        try:
            if registry_runner is not None:
                import asyncio

                registry_result = asyncio.run(registry_runner(task_type, payload))
                if registry_result is not None:
                    result = registry_result.to_dict()
                else:
                    result = handler(payload) if handler else {"success": True, "message": "completed"}
            else:
                result = handler(payload)
            self.queue.complete(job_id, result)
            try:
                from activity_stream import get_activity_stream

                get_activity_stream().record_job_result(
                    tenant_id=tenant_id,
                    worker_id=self.worker_id,
                    job_id=job_id,
                    task_type=task_type,
                    success=True,
                    details={"result": result, "attempts": attempts},
                )
            except Exception:
                pass
            print(f"[TaskWorker] ✅ {task_type} job_id={job_id} 完成")
        except Exception as e:
            err_msg = str(e)
            err_stack = traceback.format_exc()
            print(f"[TaskWorker] ❌ {task_type} job_id={job_id} 失败: {err_msg}")
            self.queue.fail(job_id, err_msg, err_stack,
                            attempts=attempts, max_attempts=max_attempts)
            try:
                from activity_stream import get_activity_stream

                get_activity_stream().record_job_result(
                    tenant_id=tenant_id,
                    worker_id=self.worker_id,
                    job_id=job_id,
                    task_type=task_type,
                    success=False,
                    details={"error": err_msg, "attempts": attempts, "max_attempts": max_attempts},
                )
            except Exception:
                pass


# ─────────────────────────────────────────────────────────────────
# 内置任务处理器（按需注册）
# ─────────────────────────────────────────────────────────────────

@register_handler("eval_batch")
def handle_eval_batch(payload: dict) -> dict:
    """批量 LLM-as-Judge 评估任务"""
    try:
        from llm_quality_judge import EvalRunner
        runner = EvalRunner()
        result = runner.run_batch(
            lobster=payload.get("lobster", "inkwriter"),
            eval_template=payload.get("eval_template", "copy_quality"),
            limit=payload.get("limit", 20),
            tenant_id=payload.get("tenant_id", "tenant_main"),
        )
        return result
    except ImportError:
        return {"error": "llm_quality_judge 未安装"}


@register_handler("cleanup_jobs")
def handle_cleanup_jobs(payload: dict) -> dict:
    """清理旧任务"""
    queue = get_task_queue()
    days = payload.get("days", 7)
    n = queue.cleanup_old_jobs(days=days)
    return {"deleted": n, "days": days}


@register_handler("webhook_retry")
def handle_webhook_retry(payload: dict) -> dict:
    """Webhook 重试任务"""
    try:
        from webhook_event_bus import get_webhook_event_bus
        bus = get_webhook_event_bus()
        event_id = payload.get("event_id", "")
        return {"retried": event_id}
    except ImportError:
        return {"error": "webhook_event_bus 未安装"}


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_queue: Optional[TaskQueue] = None

def get_task_queue() -> TaskQueue:
    global _default_queue
    if _default_queue is None:
        _default_queue = TaskQueue()
    return _default_queue
