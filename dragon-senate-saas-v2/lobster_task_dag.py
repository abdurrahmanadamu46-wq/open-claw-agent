"""
LobsterTaskDAG — 龙虾任务 DAG 依赖图 + TaskLock
================================================
灵感来源：ClawTeam-OpenClaw (team/models.py + store/base.py)
借鉴要点：
  - TaskItem 有 blocks / blocked_by（DAG 依赖图）
  - 只有 blocked_by 全部 completed，本任务才能执行
  - TaskLock：防止多龙虾并发抢同一任务（乐观锁 + SQLite UNIQUE）
  - 4级优先级：low / medium / high / urgent
  - 任务状态机：pending → in_progress → completed / blocked / failed

使用方式：
    dag = LobsterTaskDAG()

    # 创建 14步工作流任务
    t1 = dag.create("调研行业信息", owner="researcher", priority="high")
    t2 = dag.create("生成文案", owner="inkwriter",
                     blocked_by=[t1.task_id])       # 依赖 t1
    t3 = dag.create("合规检查", owner="catcher",
                     blocked_by=[t2.task_id])       # 依赖 t2
    t4 = dag.create("投放计划", owner="strategist",
                     blocked_by=[t2.task_id, t3.task_id])  # 依赖 t2+t3

    # 龙虾领取任务（自动 Lock）
    task = dag.claim_next("inkwriter", team_id="14step-run-001")
    # → t1（blocked_by 为空，可立即执行）

    # 完成任务（自动解锁+解除下游 blocked 状态）
    dag.complete(task.task_id, result="调研完成：行业报告...")

    # 查询可执行任务
    ready = dag.list_ready(team_id="14step-run-001")
    # → [t2]（t1完成后，t2的blocked_by已满足）
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

_DB_PATH = os.getenv("LOBSTER_TASK_DAG_DB", "./data/lobster_task_dag.sqlite")


# ─────────────────────────────────────────────────────────────────
# 枚举定义
# ─────────────────────────────────────────────────────────────────

class TaskStatus(str, Enum):
    pending     = "pending"      # 等待执行（blocked_by 已满足）
    blocked     = "blocked"      # 依赖未满足（blocked_by 中有 pending/in_progress）
    in_progress = "in_progress"  # 龙虾已锁定，正在执行
    completed   = "completed"    # 执行完成
    failed      = "failed"       # 执行失败（可重试）
    cancelled   = "cancelled"    # 已取消


class TaskPriority(str, Enum):
    low    = "low"
    medium = "medium"
    high   = "high"
    urgent = "urgent"

_PRIORITY_ORDER = {"urgent": 4, "high": 3, "medium": 2, "low": 1}


class TaskLockError(Exception):
    """任务已被其他龙虾锁定"""


# ─────────────────────────────────────────────────────────────────
# TaskItem 数据模型
# ─────────────────────────────────────────────────────────────────

class TaskItem:
    """龙虾任务（含 DAG 依赖关系）"""

    def __init__(self, row: dict) -> None:
        self.task_id    = row["task_id"]
        self.team_id    = row["team_id"]
        self.subject    = row["subject"]
        self.description = row.get("description", "")
        self.owner      = row.get("owner", "")       # 指定给哪个龙虾
        self.locked_by  = row.get("locked_by", "")   # 当前持有锁的龙虾
        self.status     = TaskStatus(row.get("status", "pending"))
        self.priority   = TaskPriority(row.get("priority", "medium"))
        self.result     = row.get("result", "")
        self.error      = row.get("error", "")
        self.blocks     = json.loads(row.get("blocks", "[]"))
        self.blocked_by = json.loads(row.get("blocked_by", "[]"))
        self.metadata   = json.loads(row.get("metadata", "{}"))
        self.created_at = row.get("created_at", "")
        self.updated_at = row.get("updated_at", "")
        self.completed_at = row.get("completed_at", "")

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "team_id": self.team_id,
            "subject": self.subject,
            "description": self.description,
            "owner": self.owner,
            "locked_by": self.locked_by,
            "status": self.status.value,
            "priority": self.priority.value,
            "result": self.result,
            "error": self.error,
            "blocks": self.blocks,
            "blocked_by": self.blocked_by,
            "metadata": self.metadata,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "completed_at": self.completed_at,
        }


# ─────────────────────────────────────────────────────────────────
# LobsterTaskDAG — 核心引擎
# ─────────────────────────────────────────────────────────────────

class LobsterTaskDAG:
    """
    龙虾任务 DAG 依赖图（对应 ClawTeam BaseTaskStore + TaskItem 依赖）。
    支持：
    - DAG 依赖（blocks/blocked_by）
    - TaskLock 防并发抢任务
    - 4级优先级调度
    - Dead Lobster 任务自动恢复
    - 完成时自动解除下游 blocked 状态
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

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS lobster_tasks (
                    task_id      TEXT PRIMARY KEY,
                    team_id      TEXT NOT NULL,          -- 工作流 run_id
                    subject      TEXT NOT NULL,
                    description  TEXT DEFAULT '',
                    owner        TEXT DEFAULT '',        -- 指定龙虾（空=任意）
                    locked_by    TEXT DEFAULT '',        -- 当前锁持有者
                    status       TEXT DEFAULT 'pending',
                    priority     TEXT DEFAULT 'medium',
                    result       TEXT DEFAULT '',
                    error        TEXT DEFAULT '',
                    blocks       TEXT DEFAULT '[]',      -- JSON: 下游任务ID列表
                    blocked_by   TEXT DEFAULT '[]',      -- JSON: 上游任务ID列表
                    metadata     TEXT DEFAULT '{}',
                    created_at   TEXT NOT NULL,
                    updated_at   TEXT NOT NULL,
                    completed_at TEXT DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_lt_team ON lobster_tasks(team_id, status);
                CREATE INDEX IF NOT EXISTS idx_lt_owner ON lobster_tasks(owner, status);
                CREATE INDEX IF NOT EXISTS idx_lt_locked ON lobster_tasks(locked_by, status);

                -- 任务执行历史
                CREATE TABLE IF NOT EXISTS task_history (
                    history_id   TEXT PRIMARY KEY,
                    task_id      TEXT NOT NULL,
                    lobster      TEXT NOT NULL,
                    action       TEXT NOT NULL,  -- claimed/completed/failed/released/recovered
                    detail       TEXT DEFAULT '',
                    created_at   TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_th_task ON task_history(task_id);
            """)
            conn.commit()
        finally:
            conn.close()

    # ── 创建任务 ──────────────────────────────────────────────────

    def create(
        self,
        subject: str,
        team_id: str = "",
        description: str = "",
        owner: str = "",
        priority: str = "medium",
        blocked_by: Optional[list[str]] = None,
        blocks: Optional[list[str]] = None,
        metadata: Optional[dict] = None,
    ) -> TaskItem:
        """
        创建任务（对应 ClawTeam BaseTaskStore.create()）。
        如果有 blocked_by，自动设为 blocked 状态。
        """
        task_id = f"lt_{uuid.uuid4().hex[:12]}"
        now = self._now()
        blocked_by = blocked_by or []
        blocks = blocks or []

        # 有前置依赖 → blocked，否则 pending
        status = TaskStatus.blocked.value if blocked_by else TaskStatus.pending.value

        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO lobster_tasks
                   (task_id, team_id, subject, description, owner, status, priority,
                    blocks, blocked_by, metadata, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (task_id, team_id, subject, description, owner, status,
                 priority, json.dumps(blocks), json.dumps(blocked_by),
                 json.dumps(metadata or {}), now, now)
            )
            # 更新上游任务的 blocks 字段
            for upstream_id in blocked_by:
                upstream = self._get_raw(conn, upstream_id)
                if upstream:
                    existing_blocks = json.loads(upstream["blocks"] or "[]")
                    if task_id not in existing_blocks:
                        existing_blocks.append(task_id)
                        conn.execute(
                            "UPDATE lobster_tasks SET blocks=?, updated_at=? WHERE task_id=?",
                            (json.dumps(existing_blocks), now, upstream_id)
                        )
            conn.commit()
        finally:
            conn.close()

        return self.get(task_id)

    def _get_raw(self, conn: sqlite3.Connection, task_id: str) -> Optional[sqlite3.Row]:
        return conn.execute(
            "SELECT * FROM lobster_tasks WHERE task_id=?", (task_id,)
        ).fetchone()

    def get(self, task_id: str) -> Optional[TaskItem]:
        conn = self._conn()
        try:
            row = self._get_raw(conn, task_id)
            return TaskItem(dict(row)) if row else None
        finally:
            conn.close()

    # ── 龙虾领取任务（Lock）─────────────────────────────────────

    def claim_next(
        self,
        lobster_name: str,
        team_id: str = "",
        priority_order: bool = True,
    ) -> Optional[TaskItem]:
        """
        龙虾领取下一个可执行任务（对应 ClawTeam TaskLock）。
        - 只取 status=pending 且 blocked_by 全满足的任务
        - 原子性 UPDATE + 乐观锁防并发
        - 优先按 priority 排序（urgent > high > medium > low）
        """
        conn = self._conn()
        try:
            q = """
                SELECT task_id FROM lobster_tasks
                WHERE status = 'pending'
                  AND (owner = '' OR owner = ?)
            """
            params: list[Any] = [lobster_name]
            if team_id:
                q += " AND team_id = ?"
                params.append(team_id)
            q += " ORDER BY CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, created_at ASC"
            rows = conn.execute(q, params).fetchall()

            for row in rows:
                task_id = row["task_id"]
                # 原子性 Lock（乐观锁）
                updated = conn.execute(
                    """UPDATE lobster_tasks
                       SET status='in_progress', locked_by=?, updated_at=?
                       WHERE task_id=? AND status='pending' AND locked_by=''""",
                    (lobster_name, self._now(), task_id)
                ).rowcount
                if updated > 0:
                    conn.commit()
                    self._log_history(conn, task_id, lobster_name, "claimed")
                    conn.commit()
                    return self.get(task_id)
            return None
        finally:
            conn.close()

    def claim(self, task_id: str, lobster_name: str) -> TaskItem:
        """
        指定任务领取（对应 ClawTeam TaskStore.lock()）。
        如果任务已被锁定，抛出 TaskLockError。
        """
        conn = self._conn()
        try:
            now = self._now()
            updated = conn.execute(
                """UPDATE lobster_tasks
                   SET status='in_progress', locked_by=?, updated_at=?
                   WHERE task_id=? AND status='pending' AND locked_by=''""",
                (lobster_name, now, task_id)
            ).rowcount
            conn.commit()
            if updated == 0:
                task = self.get(task_id)
                if task and task.locked_by:
                    raise TaskLockError(f"任务 {task_id} 已被 {task.locked_by} 锁定")
                raise TaskLockError(f"任务 {task_id} 不可领取（状态={task.status if task else '未知'}）")
            self._log_history(conn, task_id, lobster_name, "claimed")
            conn.commit()
            return self.get(task_id)
        finally:
            conn.close()

    # ── 完成/失败 ─────────────────────────────────────────────────

    def complete(
        self,
        task_id: str,
        result: str = "",
        lobster_name: str = "",
    ) -> TaskItem:
        """
        完成任务（对应 ClawTeam TaskStore.update status=completed）。
        自动检查并解除下游任务的 blocked 状态。
        """
        conn = self._conn()
        try:
            now = self._now()
            conn.execute(
                """UPDATE lobster_tasks
                   SET status='completed', result=?, locked_by='', completed_at=?, updated_at=?
                   WHERE task_id=?""",
                (result[:5000], now, now, task_id)
            )
            conn.commit()
            self._log_history(conn, task_id, lobster_name, "completed", result[:200])
            conn.commit()
            # 检查下游任务是否可以解除 blocked
            self._resolve_downstream(conn, task_id)
            conn.commit()
            return self.get(task_id)
        finally:
            conn.close()

    def fail(
        self,
        task_id: str,
        error: str = "",
        lobster_name: str = "",
        retry: bool = True,
    ) -> TaskItem:
        """
        任务失败（可选择重试：status=pending，否则 status=failed）。
        """
        conn = self._conn()
        try:
            now = self._now()
            new_status = "pending" if retry else "failed"
            conn.execute(
                """UPDATE lobster_tasks
                   SET status=?, error=?, locked_by='', updated_at=?
                   WHERE task_id=?""",
                (new_status, error[:2000], now, task_id)
            )
            conn.commit()
            self._log_history(conn, task_id, lobster_name, "failed", error[:200])
            conn.commit()
            return self.get(task_id)
        finally:
            conn.close()

    def release(self, task_id: str, lobster_name: str = "") -> TaskItem:
        """释放任务锁（龙虾断开时）→ 任务回到 pending"""
        conn = self._conn()
        try:
            conn.execute(
                """UPDATE lobster_tasks
                   SET status='pending', locked_by='', updated_at=?
                   WHERE task_id=? AND status='in_progress'""",
                (self._now(), task_id)
            )
            conn.commit()
            self._log_history(conn, task_id, lobster_name, "released")
            conn.commit()
            return self.get(task_id)
        finally:
            conn.close()

    # ── Dead Lobster 自动恢复 ─────────────────────────────────────

    def recover_dead_lobster(self, lobster_name: str) -> list[str]:
        """
        恢复死亡龙虾持有的任务（对应 ClawTeam TaskWaiter dead agent recovery）。
        将其所有 in_progress 任务改回 pending 重新分配。
        返回恢复的 task_id 列表。
        """
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT task_id FROM lobster_tasks WHERE locked_by=? AND status='in_progress'",
                (lobster_name,)
            ).fetchall()
            recovered = []
            now = self._now()
            for row in rows:
                task_id = row["task_id"]
                conn.execute(
                    """UPDATE lobster_tasks
                       SET status='pending', locked_by='', updated_at=?
                       WHERE task_id=?""",
                    (now, task_id)
                )
                self._log_history(conn, task_id, lobster_name, "recovered",
                                   f"龙虾 {lobster_name} 死亡，任务自动恢复")
                recovered.append(task_id)
            conn.commit()
            return recovered
        finally:
            conn.close()

    # ── DAG 下游解除 blocked ───────────────────────────────────────

    def _resolve_downstream(self, conn: sqlite3.Connection, completed_task_id: str) -> None:
        """
        完成任务后，检查其下游任务是否可以解除 blocked 状态。
        只有 blocked_by 中的所有任务都 completed，下游才变为 pending。
        """
        # 获取下游任务列表
        row = conn.execute(
            "SELECT blocks FROM lobster_tasks WHERE task_id=?", (completed_task_id,)
        ).fetchone()
        if not row:
            return
        downstream_ids = json.loads(row["blocks"] or "[]")

        now = self._now()
        for downstream_id in downstream_ids:
            ds = conn.execute(
                "SELECT status, blocked_by FROM lobster_tasks WHERE task_id=?",
                (downstream_id,)
            ).fetchone()
            if not ds or ds["status"] != "blocked":
                continue
            upstream_ids = json.loads(ds["blocked_by"] or "[]")
            # 检查所有前置任务是否都已 completed
            all_done = True
            for uid in upstream_ids:
                urow = conn.execute(
                    "SELECT status FROM lobster_tasks WHERE task_id=?", (uid,)
                ).fetchone()
                if not urow or urow["status"] != "completed":
                    all_done = False
                    break
            if all_done:
                conn.execute(
                    "UPDATE lobster_tasks SET status='pending', updated_at=? WHERE task_id=?",
                    (now, downstream_id)
                )

    # ── 查询 ──────────────────────────────────────────────────────

    def list_tasks(
        self,
        team_id: str = "",
        status: Optional[str] = None,
        owner: Optional[str] = None,
        priority: Optional[str] = None,
        limit: int = 100,
    ) -> list[TaskItem]:
        """列出任务（支持多维过滤）"""
        conn = self._conn()
        try:
            q = "SELECT * FROM lobster_tasks WHERE 1=1"
            params: list[Any] = []
            if team_id:
                q += " AND team_id=?"
                params.append(team_id)
            if status:
                q += " AND status=?"
                params.append(status)
            if owner:
                q += " AND owner=?"
                params.append(owner)
            if priority:
                q += " AND priority=?"
                params.append(priority)
            q += (" ORDER BY CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3"
                  " WHEN 'medium' THEN 2 ELSE 1 END DESC, created_at ASC LIMIT ?")
            params.append(limit)
            rows = conn.execute(q, params).fetchall()
            return [TaskItem(dict(r)) for r in rows]
        finally:
            conn.close()

    def list_ready(self, team_id: str = "") -> list[TaskItem]:
        """列出可立即执行的任务（status=pending）"""
        return self.list_tasks(team_id=team_id, status="pending")

    def get_dag_summary(self, team_id: str) -> dict[str, Any]:
        """获取 DAG 状态摘要（供 Dashboard 显示）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT status, COUNT(*) as cnt FROM lobster_tasks WHERE team_id=? GROUP BY status",
                (team_id,)
            ).fetchall()
            status_map = {r["status"]: r["cnt"] for r in rows}
            total = sum(status_map.values())
            completed = status_map.get("completed", 0)
            return {
                "team_id": team_id,
                "total": total,
                "completed": completed,
                "in_progress": status_map.get("in_progress", 0),
                "pending": status_map.get("pending", 0),
                "blocked": status_map.get("blocked", 0),
                "failed": status_map.get("failed", 0),
                "progress_pct": round(completed / total * 100, 1) if total > 0 else 0,
            }
        finally:
            conn.close()

    def _log_history(self, conn: sqlite3.Connection, task_id: str,
                      lobster: str, action: str, detail: str = "") -> None:
        conn.execute(
            """INSERT INTO task_history (history_id, task_id, lobster, action, detail, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (f"th_{uuid.uuid4().hex[:8]}", task_id, lobster, action, detail, self._now())
        )

    def get_history(self, task_id: str) -> list[dict]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM task_history WHERE task_id=? ORDER BY created_at",
                (task_id,)
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_dag: Optional[LobsterTaskDAG] = None

def get_lobster_task_dag() -> LobsterTaskDAG:
    global _default_dag
    if _default_dag is None:
        _default_dag = LobsterTaskDAG()
    return _default_dag
