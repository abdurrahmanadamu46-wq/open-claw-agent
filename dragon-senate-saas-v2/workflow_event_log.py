"""
WorkflowEventLog — 工作流执行事件日志持久化
=============================================
灵感来源：Temporal History Service / Event Sourcing
借鉴要点：
  - 每步龙虾技能执行写入事件记录（step_started / step_completed / step_failed / step_retrying）
  - 支持按 workflow_run_id 查询完整事件时间线（UI 回放用）
  - 支持断点续跑：重启后可查询最后完成的步骤，从中间步骤继续
  - Signal 机制：外部写入 signal 事件让暂停的工作流恢复

⚠️ 架构说明：
  本模块替代内存状态，将工作流执行状态持久化到 SQLite。
  commander_graph_builder.py 在每步执行前后调用本模块写事件。
  机器重启后，通过 get_resume_point() 获取断点位置继续执行。

Temporal 概念映射：
  WorkflowExecutionStarted    → workflow_event_type = "workflow_started"
  ActivityTaskScheduled       → "step_scheduled"
  ActivityTaskStarted         → "step_started"
  ActivityTaskCompleted       → "step_completed"
  ActivityTaskFailed          → "step_failed"
  ActivityTaskTimedOut        → "step_timeout"
  WorkflowExecutionSignaled   → "signal"
  WorkflowExecutionCompleted  → "workflow_completed"
  WorkflowExecutionFailed     → "workflow_failed"
  WorkflowExecutionTimedOut   → "workflow_timeout"

使用示例：
    log = WorkflowEventLog()

    # 工作流启动
    log.workflow_started("run-abc123", "content-campaign-14step", tenant_id="t1",
                         version="1.2", meta={"platform": "douyin"})

    # 每步执行
    log.step_scheduled("run-abc123", step_index=3, step_name="inkwriter", skill="inkwriter_copy_generate")
    log.step_started("run-abc123", step_index=3)
    log.step_completed("run-abc123", step_index=3, output_summary="文案已生成", tokens=850)

    # 断点恢复
    resume = log.get_resume_point("run-abc123")
    # resume.next_step_index = 4（从第4步继续）

    # 查询时间线（UI 展示）
    timeline = log.get_timeline("run-abc123")
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

# ─────────────────────────────────────────────────────────────────
# 事件类型枚举（对应 Temporal 事件类型）
# ─────────────────────────────────────────────────────────────────

class WorkflowEventType(str, Enum):
    # 工作流级别（对应 Temporal WorkflowExecution* 事件）
    workflow_started   = "workflow_started"
    workflow_completed = "workflow_completed"
    workflow_failed    = "workflow_failed"
    workflow_timeout   = "workflow_timeout"
    workflow_cancelled = "workflow_cancelled"
    # 步骤级别（对应 Temporal ActivityTask* 事件）
    step_scheduled     = "step_scheduled"
    step_started       = "step_started"
    step_completed     = "step_completed"
    step_failed        = "step_failed"
    step_retrying      = "step_retrying"
    step_timeout       = "step_timeout"
    step_skipped       = "step_skipped"
    # 控制事件（对应 Temporal Signal / Timer）
    signal             = "signal"    # 外部信号（如人工审批通过 / resume）
    paused             = "paused"    # 工作流在审批点暂停
    resumed            = "resumed"   # 工作流从暂停点恢复
    timer_set          = "timer_set"         # 定时发布计时器已设置
    timer_fired        = "timer_fired"       # 定时器到期触发


class WorkflowRunStatus(str, Enum):
    running    = "running"
    paused     = "paused"
    completed  = "completed"
    failed     = "failed"
    timeout    = "timeout"
    cancelled  = "cancelled"


# ─────────────────────────────────────────────────────────────────
# 数据模型
# ─────────────────────────────────────────────────────────────────

@dataclass
class WorkflowEvent:
    """单条工作流事件记录（对应 Temporal HistoryEvent）"""
    event_id: str
    workflow_run_id: str
    tenant_id: str
    event_type: WorkflowEventType
    event_index: int                  # 事件序号（从1开始，单调递增）
    step_index: Optional[int]         # 步骤序号（仅步骤事件有值）
    step_name: Optional[str]          # 步骤名称（如 "inkwriter"）
    skill: Optional[str]              # 技能名称（如 "inkwriter_copy_generate"）
    status: Optional[str]
    tokens_used: int
    duration_ms: int
    output_summary: str
    error_message: str
    signal_name: str                  # signal 事件的名称
    signal_payload: str               # signal 事件的 payload（JSON）
    meta: str                         # 扩展字段（JSON）
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "workflow_run_id": self.workflow_run_id,
            "tenant_id": self.tenant_id,
            "event_type": self.event_type,
            "event_index": self.event_index,
            "step_index": self.step_index,
            "step_name": self.step_name,
            "skill": self.skill,
            "status": self.status,
            "tokens_used": self.tokens_used,
            "duration_ms": self.duration_ms,
            "output_summary": self.output_summary,
            "error_message": self.error_message,
            "signal_name": self.signal_name,
            "signal_payload": self.signal_payload,
            "meta": self.meta,
            "created_at": self.created_at,
        }


@dataclass
class WorkflowResume:
    """断点恢复信息（机器重启后从此位置继续）"""
    workflow_run_id: str
    workflow_name: str
    status: WorkflowRunStatus
    last_completed_step: int      # 最后成功完成的步骤序号
    next_step_index: int          # 下一个应该执行的步骤序号
    total_steps: int
    is_paused: bool               # 是否在人工审批点暂停
    pause_step: Optional[int]     # 暂停的步骤序号
    last_event_at: str
    elapsed_sec: float

    @property
    def can_resume(self) -> bool:
        return self.status in (WorkflowRunStatus.running, WorkflowRunStatus.paused)


# ─────────────────────────────────────────────────────────────────
# WorkflowEventLog — 主类
# ─────────────────────────────────────────────────────────────────

_DB_PATH = os.getenv("WORKFLOW_EVENT_LOG_DB", "./data/workflow_event_log.sqlite")


class WorkflowEventLog:
    """
    工作流执行事件日志持久化引擎。
    借鉴 Temporal History Service 的事件溯源设计，将工作流执行状态写入 SQLite。

    特性：
    - 每个工作流执行实例（workflow_run_id）有独立的事件序列
    - 机器重启后可通过 get_resume_point() 获取断点
    - 支持 Signal 注入（人工审批 / 外部触发恢复）
    - 支持持久化定时器（timer_set / timer_fired）
    - 完整事件时间线供前端 UI 展示
    """

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS workflow_runs (
                    run_id        TEXT PRIMARY KEY,
                    tenant_id     TEXT NOT NULL DEFAULT 'tenant_main',
                    workflow_name TEXT NOT NULL,
                    version       TEXT DEFAULT '1.0',
                    status        TEXT NOT NULL DEFAULT 'running',
                    total_steps   INTEGER DEFAULT 14,
                    last_completed_step INTEGER DEFAULT -1,
                    is_paused     INTEGER DEFAULT 0,
                    pause_step    INTEGER,
                    started_at    TEXT NOT NULL,
                    completed_at  TEXT,
                    meta          TEXT DEFAULT '{}'
                );

                CREATE INDEX IF NOT EXISTS idx_runs_tenant
                    ON workflow_runs(tenant_id, started_at);
                CREATE INDEX IF NOT EXISTS idx_runs_status
                    ON workflow_runs(status, started_at);

                CREATE TABLE IF NOT EXISTS workflow_events (
                    event_id         TEXT PRIMARY KEY,
                    workflow_run_id  TEXT NOT NULL,
                    tenant_id        TEXT NOT NULL DEFAULT 'tenant_main',
                    event_type       TEXT NOT NULL,
                    event_index      INTEGER NOT NULL,
                    step_index       INTEGER,
                    step_name        TEXT,
                    skill            TEXT,
                    status           TEXT,
                    tokens_used      INTEGER DEFAULT 0,
                    duration_ms      INTEGER DEFAULT 0,
                    output_summary   TEXT DEFAULT '',
                    error_message    TEXT DEFAULT '',
                    signal_name      TEXT DEFAULT '',
                    signal_payload   TEXT DEFAULT '{}',
                    meta             TEXT DEFAULT '{}',
                    created_at       TEXT NOT NULL,
                    FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(run_id)
                );

                CREATE INDEX IF NOT EXISTS idx_events_run
                    ON workflow_events(workflow_run_id, event_index);
                CREATE INDEX IF NOT EXISTS idx_events_type
                    ON workflow_events(event_type, created_at);
                CREATE INDEX IF NOT EXISTS idx_events_signal
                    ON workflow_events(signal_name, workflow_run_id);

                CREATE TABLE IF NOT EXISTS workflow_timers (
                    timer_id         TEXT PRIMARY KEY,
                    workflow_run_id  TEXT NOT NULL,
                    tenant_id        TEXT NOT NULL DEFAULT 'tenant_main',
                    fire_at          TEXT NOT NULL,
                    signal_name      TEXT NOT NULL DEFAULT 'timer_fired',
                    signal_payload   TEXT DEFAULT '{}',
                    fired            INTEGER DEFAULT 0,
                    fired_at         TEXT,
                    created_at       TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_timers_fire
                    ON workflow_timers(fire_at, fired);
            """)
            conn.commit()
        finally:
            conn.close()

    # ── 内部工具 ──────────────────────────────────────────────────

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _next_event_index(self, conn: sqlite3.Connection, run_id: str) -> int:
        row = conn.execute(
            "SELECT MAX(event_index) FROM workflow_events WHERE workflow_run_id = ?",
            (run_id,)
        ).fetchone()
        val = row[0]
        return (val + 1) if val is not None else 1

    def _write_event(
        self,
        run_id: str,
        tenant_id: str,
        event_type: WorkflowEventType,
        step_index: Optional[int] = None,
        step_name: Optional[str] = None,
        skill: Optional[str] = None,
        status: Optional[str] = None,
        tokens_used: int = 0,
        duration_ms: int = 0,
        output_summary: str = "",
        error_message: str = "",
        signal_name: str = "",
        signal_payload: dict | None = None,
        meta: dict | None = None,
    ) -> str:
        event_id = f"ev_{uuid.uuid4().hex[:12]}"
        now = self._now()
        conn = self._conn()
        try:
            idx = self._next_event_index(conn, run_id)
            conn.execute(
                """INSERT INTO workflow_events
                   (event_id, workflow_run_id, tenant_id, event_type, event_index,
                    step_index, step_name, skill, status, tokens_used, duration_ms,
                    output_summary, error_message, signal_name, signal_payload, meta, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    event_id, run_id, tenant_id, event_type.value, idx,
                    step_index, step_name, skill, status, tokens_used, duration_ms,
                    output_summary, error_message, signal_name,
                    json.dumps(signal_payload or {}, ensure_ascii=False),
                    json.dumps(meta or {}, ensure_ascii=False),
                    now,
                )
            )
            conn.commit()
        finally:
            conn.close()
        return event_id

    # ── 工作流级别事件 ────────────────────────────────────────────

    def workflow_started(
        self,
        run_id: str,
        workflow_name: str,
        tenant_id: str = "tenant_main",
        total_steps: int = 14,
        version: str = "1.0",
        meta: dict | None = None,
    ) -> str:
        """工作流启动（对应 Temporal WorkflowExecutionStarted）"""
        now = self._now()
        conn = self._conn()
        try:
            conn.execute(
                """INSERT OR REPLACE INTO workflow_runs
                   (run_id, tenant_id, workflow_name, version, status, total_steps,
                    last_completed_step, started_at, meta)
                   VALUES (?, ?, ?, ?, 'running', ?, -1, ?, ?)""",
                (run_id, tenant_id, workflow_name, version, total_steps, now,
                 json.dumps(meta or {}, ensure_ascii=False))
            )
            conn.commit()
        finally:
            conn.close()
        return self._write_event(run_id, tenant_id, WorkflowEventType.workflow_started,
                                  meta={"workflow_name": workflow_name, "version": version})

    def workflow_completed(self, run_id: str, tenant_id: str = "tenant_main",
                           output_summary: str = "") -> str:
        """工作流成功完成"""
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE workflow_runs SET status='completed', completed_at=? WHERE run_id=?",
                (self._now(), run_id)
            )
            conn.commit()
        finally:
            conn.close()
        return self._write_event(run_id, tenant_id, WorkflowEventType.workflow_completed,
                                  output_summary=output_summary)

    def workflow_failed(self, run_id: str, tenant_id: str = "tenant_main",
                        error_message: str = "") -> str:
        """工作流失败"""
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE workflow_runs SET status='failed', completed_at=? WHERE run_id=?",
                (self._now(), run_id)
            )
            conn.commit()
        finally:
            conn.close()
        return self._write_event(run_id, tenant_id, WorkflowEventType.workflow_failed,
                                  error_message=error_message)

    def workflow_timeout(self, run_id: str, tenant_id: str = "tenant_main",
                         timeout_min: int = 120) -> str:
        """工作流超时（对应 Temporal workflowExecutionTimeout）"""
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE workflow_runs SET status='timeout', completed_at=? WHERE run_id=?",
                (self._now(), run_id)
            )
            conn.commit()
        finally:
            conn.close()
        return self._write_event(run_id, tenant_id, WorkflowEventType.workflow_timeout,
                                  error_message=f"Workflow exceeded {timeout_min}min timeout")

    # ── 步骤级别事件 ──────────────────────────────────────────────

    def step_scheduled(self, run_id: str, step_index: int, step_name: str,
                       skill: str = "", tenant_id: str = "tenant_main") -> str:
        """步骤已调度（对应 Temporal ActivityTaskScheduled）"""
        return self._write_event(run_id, tenant_id, WorkflowEventType.step_scheduled,
                                  step_index=step_index, step_name=step_name, skill=skill)

    def step_started(self, run_id: str, step_index: int, step_name: str = "",
                     tenant_id: str = "tenant_main") -> str:
        """步骤开始执行（对应 Temporal ActivityTaskStarted）"""
        return self._write_event(run_id, tenant_id, WorkflowEventType.step_started,
                                  step_index=step_index, step_name=step_name)

    def step_completed(
        self,
        run_id: str,
        step_index: int,
        step_name: str = "",
        output_summary: str = "",
        tokens_used: int = 0,
        duration_ms: int = 0,
        tenant_id: str = "tenant_main",
    ) -> str:
        """步骤成功完成（对应 Temporal ActivityTaskCompleted）"""
        conn = self._conn()
        try:
            conn.execute(
                """UPDATE workflow_runs
                   SET last_completed_step = MAX(last_completed_step, ?)
                   WHERE run_id = ?""",
                (step_index, run_id)
            )
            conn.commit()
        finally:
            conn.close()
        return self._write_event(
            run_id, tenant_id, WorkflowEventType.step_completed,
            step_index=step_index, step_name=step_name,
            output_summary=output_summary, tokens_used=tokens_used, duration_ms=duration_ms,
        )

    def step_failed(
        self,
        run_id: str,
        step_index: int,
        step_name: str = "",
        error_message: str = "",
        tenant_id: str = "tenant_main",
    ) -> str:
        """步骤失败（对应 Temporal ActivityTaskFailed）"""
        return self._write_event(
            run_id, tenant_id, WorkflowEventType.step_failed,
            step_index=step_index, step_name=step_name, error_message=error_message,
        )

    def step_retrying(
        self,
        run_id: str,
        step_index: int,
        step_name: str = "",
        retry_count: int = 1,
        error_message: str = "",
        tenant_id: str = "tenant_main",
    ) -> str:
        """步骤正在重试（对应 Temporal Activity retry）"""
        return self._write_event(
            run_id, tenant_id, WorkflowEventType.step_retrying,
            step_index=step_index, step_name=step_name, error_message=error_message,
            meta={"retry_count": retry_count},
        )

    def step_timeout(
        self,
        run_id: str,
        step_index: int,
        step_name: str = "",
        timeout_sec: int = 300,
        tenant_id: str = "tenant_main",
    ) -> str:
        """步骤超时（对应 Temporal ActivityTaskTimedOut）"""
        return self._write_event(
            run_id, tenant_id, WorkflowEventType.step_timeout,
            step_index=step_index, step_name=step_name,
            error_message=f"Step timed out after {timeout_sec}s",
        )

    # ── Signal 机制（对应 Temporal WorkflowExecutionSignaled）─────

    def send_signal(
        self,
        run_id: str,
        signal_name: str,
        payload: dict | None = None,
        tenant_id: str = "tenant_main",
    ) -> str:
        """
        向工作流发送 Signal（对应 Temporal SignalWorkflowExecution）。
        常用场景：人工审批通过 → send_signal(run_id, "human_approved")
        """
        event_id = self._write_event(
            run_id, tenant_id, WorkflowEventType.signal,
            signal_name=signal_name,
            signal_payload=payload or {},
        )
        # 如果是 resume 信号，同时更新工作流状态
        if signal_name in ("resume", "human_approved", "approval_granted"):
            conn = self._conn()
            try:
                conn.execute(
                    "UPDATE workflow_runs SET status='running', is_paused=0 WHERE run_id=?",
                    (run_id,)
                )
                conn.commit()
            finally:
                conn.close()
            self._write_event(run_id, tenant_id, WorkflowEventType.resumed,
                               signal_name=signal_name)
        return event_id

    def pause_workflow(self, run_id: str, pause_step: int,
                       tenant_id: str = "tenant_main") -> str:
        """工作流暂停等待人工审批"""
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE workflow_runs SET status='paused', is_paused=1, pause_step=? WHERE run_id=?",
                (pause_step, run_id)
            )
            conn.commit()
        finally:
            conn.close()
        return self._write_event(run_id, tenant_id, WorkflowEventType.paused,
                                  step_index=pause_step)

    def wait_for_signal(self, run_id: str, signal_name: str,
                        timeout_sec: int = 86400) -> Optional[dict]:
        """
        轮询等待 Signal 到达（同步阻塞版，适合非 async 场景）。
        对应 Temporal `workflow.GetSignalChannel(ctx, signalName).Receive(ctx, &val)`。
        timeout_sec 最长等待时间（默认24小时），超时返回 None。
        """
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            conn = self._conn()
            try:
                row = conn.execute(
                    """SELECT signal_payload FROM workflow_events
                       WHERE workflow_run_id = ? AND signal_name = ?
                       ORDER BY event_index DESC LIMIT 1""",
                    (run_id, signal_name)
                ).fetchone()
            finally:
                conn.close()
            if row:
                try:
                    return json.loads(row[0])
                except Exception:
                    return {}
            time.sleep(5)  # 5秒轮询间隔
        return None

    # ── 持久化定时器（对应 Temporal Timer）──────────────────────

    def set_timer(
        self,
        run_id: str,
        fire_at_iso: str,
        signal_name: str = "timer_fired",
        payload: dict | None = None,
        tenant_id: str = "tenant_main",
    ) -> str:
        """
        设置持久化定时器（对应 Temporal workflow.Sleep / NewTimer）。
        火到 fire_at 时自动向工作流发送 signal。
        由 ScheduledTaskStore / cron 服务负责扫描并触发。
        """
        timer_id = f"tmr_{uuid.uuid4().hex[:12]}"
        now = self._now()
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO workflow_timers
                   (timer_id, workflow_run_id, tenant_id, fire_at, signal_name, signal_payload, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (timer_id, run_id, tenant_id, fire_at_iso, signal_name,
                 json.dumps(payload or {}), now)
            )
            conn.commit()
        finally:
            conn.close()
        self._write_event(run_id, tenant_id, WorkflowEventType.timer_set,
                           signal_name=signal_name,
                           signal_payload={"fire_at": fire_at_iso, "timer_id": timer_id})
        return timer_id

    def fire_due_timers(self) -> list[str]:
        """
        扫描并触发到期的定时器（由后台 cron 每分钟调用）。
        对应 Temporal 内部的 Timer Service。
        Returns: 已触发的 timer_id 列表
        """
        now = self._now()
        conn = self._conn()
        fired = []
        try:
            rows = conn.execute(
                "SELECT * FROM workflow_timers WHERE fire_at <= ? AND fired = 0",
                (now,)
            ).fetchall()
            for row in rows:
                d = dict(row)
                try:
                    payload = json.loads(d.get("signal_payload") or "{}")
                    self.send_signal(
                        run_id=d["workflow_run_id"],
                        signal_name=d["signal_name"],
                        payload=payload,
                        tenant_id=d["tenant_id"],
                    )
                    conn.execute(
                        "UPDATE workflow_timers SET fired=1, fired_at=? WHERE timer_id=?",
                        (now, d["timer_id"])
                    )
                    fired.append(d["timer_id"])
                except Exception:
                    pass
            conn.commit()
        finally:
            conn.close()
        return fired

    # ── 查询接口 ──────────────────────────────────────────────────

    def get_resume_point(self, run_id: str) -> Optional[WorkflowResume]:
        """
        断点恢复：获取工作流应该从哪步继续执行。
        机器重启后调用此方法，然后从 resume.next_step_index 继续。
        """
        conn = self._conn()
        try:
            run = conn.execute(
                "SELECT * FROM workflow_runs WHERE run_id = ?", (run_id,)
            ).fetchone()
        finally:
            conn.close()
        if not run:
            return None
        d = dict(run)
        last = int(d.get("last_completed_step") or -1)
        total = int(d.get("total_steps") or 14)
        elapsed = 0.0
        if d.get("started_at"):
            try:
                from datetime import datetime, timezone
                start = datetime.fromisoformat(d["started_at"].replace("Z", "+00:00"))
                elapsed = (datetime.now(timezone.utc) - start).total_seconds()
            except Exception:
                pass
        return WorkflowResume(
            workflow_run_id=run_id,
            workflow_name=d.get("workflow_name", ""),
            status=WorkflowRunStatus(d.get("status", "running")),
            last_completed_step=last,
            next_step_index=last + 1,
            total_steps=total,
            is_paused=bool(d.get("is_paused", 0)),
            pause_step=d.get("pause_step"),
            last_event_at=d.get("completed_at") or d.get("started_at") or "",
            elapsed_sec=round(elapsed, 1),
        )

    def get_timeline(self, run_id: str, limit: int = 200) -> list[dict[str, Any]]:
        """
        获取工作流完整事件时间线（前端 UI 展示用）。
        对应 Temporal Web UI 的 Event History 页面。
        """
        conn = self._conn()
        try:
            rows = conn.execute(
                """SELECT * FROM workflow_events
                   WHERE workflow_run_id = ?
                   ORDER BY event_index ASC LIMIT ?""",
                (run_id, limit)
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def list_runs(
        self,
        tenant_id: str = "tenant_main",
        status: Optional[str] = None,
        workflow_name: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """
        查询工作流执行列表（对应 Temporal ListWorkflowExecutions API）。
        支持按状态/工作流名过滤（借鉴 Temporal Search Attributes 思想）。
        """
        conn = self._conn()
        try:
            q = "SELECT * FROM workflow_runs WHERE tenant_id = ?"
            params: list[Any] = [tenant_id]
            if status:
                q += " AND status = ?"
                params.append(status)
            if workflow_name:
                q += " AND workflow_name = ?"
                params.append(workflow_name)
            q += " ORDER BY started_at DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(q, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_run_summary(self, run_id: str) -> Optional[dict[str, Any]]:
        """获取工作流执行摘要（含步骤完成进度）"""
        conn = self._conn()
        try:
            run = conn.execute(
                "SELECT * FROM workflow_runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if not run:
                return None
            d = dict(run)
            # 计算进度（借鉴 MPT progress 0-100 规范）
            total = int(d.get("total_steps") or 14)
            last = int(d.get("last_completed_step") or -1)
            progress = max(0, min(100, int((last + 1) / total * 100))) if total > 0 else 0
            d["progress"] = progress
            # 统计各类事件数量
            stats = conn.execute(
                """SELECT event_type, COUNT(*) as cnt
                   FROM workflow_events WHERE workflow_run_id = ?
                   GROUP BY event_type""",
                (run_id,)
            ).fetchall()
            d["event_stats"] = {r["event_type"]: r["cnt"] for r in stats}
            return d
        finally:
            conn.close()

    def list_recent_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        """
        列出最近的工作流运行记录（不限租户）。
        供 /api/v1/ai/execution-monitor/snapshot 接口使用。
        """
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT ?",
                (limit,)
            ).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                total = int(d.get("total_steps") or 14)
                last = int(d.get("last_completed_step") or -1)
                d["progress"] = max(0, min(100, int((last + 1) / total * 100))) if total > 0 else 0
                result.append(d)
            return result
        except Exception:
            return []
        finally:
            conn.close()

    def get_failed_step(self, run_id: str) -> Optional[dict[str, Any]]:
        """
        返回该 run 中第一个 step_failed 事件，方便快速定位卡点。
        断点恢复调试专用。
        """
        conn = self._conn()
        try:
            row = conn.execute(
                """SELECT * FROM workflow_events
                   WHERE workflow_run_id = ? AND event_type = 'step_failed'
                   ORDER BY event_index ASC LIMIT 1""",
                (run_id,)
            ).fetchone()
            if not row:
                return None
            d = dict(row)
            # 解析 payload JSON
            try:
                d["payload"] = json.loads(d.get("payload") or "{}")
            except Exception:
                pass
            return d
        finally:
            conn.close()

    def can_resume(self, run_id: str) -> bool:
        """
        判断该工作流是否可以从断点恢复。
        条件：存在 workflow_started 且状态不是 completed/cancelled。
        """
        conn = self._conn()
        try:
            run = conn.execute(
                "SELECT status FROM workflow_runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if not run:
                return False
            return str(run["status"]) not in {"completed", "cancelled"}
        finally:
            conn.close()


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_log: WorkflowEventLog | None = None


def get_workflow_event_log() -> WorkflowEventLog:
    """获取全局默认 WorkflowEventLog 单例"""
    global _default_log
    if _default_log is None:
        _default_log = WorkflowEventLog()
    return _default_log
