"""
LobsterSession — 龙虾会话持久化（断点续跑）
============================================
灵感来源：ClawTeam-OpenClaw (spawn/sessions.py SessionStore)
借鉴要点：
  - 每个龙虾的执行状态持久化（agent_name/team_id/task_id/context）
  - 龙虾重启后自动从上次任务继续（resume）
  - 支持保存任意 KV 上下文（浏览器状态/临时变量/中间结果）
  - SQLite 原子写入，安全并发

使用方式：
    session = LobsterSession()

    # 保存龙虾状态
    session.save("inkwriter", team_id="run-001",
                 task_id="lt_abc123",
                 context={"draft": "...", "retry_count": 2})

    # 龙虾重启后恢复
    state = session.load("inkwriter", team_id="run-001")
    if state and state.task_id:
        print(f"继续任务: {state.task_id}")
        ctx = state.context  # {"draft": "...", "retry_count": 2}
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_DB_PATH = os.getenv("LOBSTER_SESSION_DB", "./data/lobster_sessions.sqlite")


# ─────────────────────────────────────────────────────────────────
# SessionState 数据模型
# ─────────────────────────────────────────────────────────────────

class SessionState:
    """龙虾会话状态（对应 ClawTeam SessionState）"""

    def __init__(self, row: dict) -> None:
        self.session_id   = row["session_id"]
        self.lobster_name = row["lobster_name"]
        self.team_id      = row.get("team_id", "")
        self.task_id      = row.get("task_id", "")       # 上次执行的任务
        self.step_index   = int(row.get("step_index", 0)) # 工作流步骤索引
        self.status       = row.get("status", "active")   # active/paused/completed
        self.context      = json.loads(row.get("context", "{}"))   # 任意KV上下文
        self.checkpoint   = row.get("checkpoint", "")     # 检查点标记（恢复位置）
        self.saved_at     = row.get("saved_at", "")
        self.created_at   = row.get("created_at", "")

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "lobster_name": self.lobster_name,
            "team_id": self.team_id,
            "task_id": self.task_id,
            "step_index": self.step_index,
            "status": self.status,
            "context": self.context,
            "checkpoint": self.checkpoint,
            "saved_at": self.saved_at,
            "created_at": self.created_at,
        }

    def get(self, key: str, default: Any = None) -> Any:
        """从 context 获取值"""
        return self.context.get(key, default)


# ─────────────────────────────────────────────────────────────────
# LobsterSession — 核心
# ─────────────────────────────────────────────────────────────────

class LobsterSession:
    """
    龙虾会话存储（对应 ClawTeam SessionStore）。
    每个龙虾在每个 team_id 下有一个会话记录。
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
                CREATE TABLE IF NOT EXISTS lobster_sessions (
                    session_id    TEXT PRIMARY KEY,
                    lobster_name  TEXT NOT NULL,
                    team_id       TEXT DEFAULT '',
                    task_id       TEXT DEFAULT '',
                    step_index    INTEGER DEFAULT 0,
                    status        TEXT DEFAULT 'active',
                    context       TEXT DEFAULT '{}',
                    checkpoint    TEXT DEFAULT '',
                    saved_at      TEXT NOT NULL,
                    created_at    TEXT NOT NULL,
                    UNIQUE(lobster_name, team_id)
                );
                CREATE INDEX IF NOT EXISTS idx_ls_lobster ON lobster_sessions(lobster_name, team_id);
                CREATE INDEX IF NOT EXISTS idx_ls_team ON lobster_sessions(team_id, status);

                -- 会话历史快照（可选，用于 rollback）
                CREATE TABLE IF NOT EXISTS session_snapshots (
                    snap_id       TEXT PRIMARY KEY,
                    lobster_name  TEXT NOT NULL,
                    team_id       TEXT DEFAULT '',
                    task_id       TEXT DEFAULT '',
                    step_index    INTEGER DEFAULT 0,
                    context       TEXT DEFAULT '{}',
                    checkpoint    TEXT DEFAULT '',
                    reason        TEXT DEFAULT '',
                    saved_at      TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_ss_lobster ON session_snapshots(lobster_name, team_id, saved_at);
            """)
            conn.commit()
        finally:
            conn.close()

    # ── 保存会话 ───────────────────────────────────────────────────

    def save(
        self,
        lobster_name: str,
        team_id: str = "",
        task_id: str = "",
        step_index: int = 0,
        status: str = "active",
        context: Optional[dict[str, Any]] = None,
        checkpoint: str = "",
        snapshot_reason: str = "",
        take_snapshot: bool = False,
    ) -> SessionState:
        """
        保存龙虾会话状态（对应 ClawTeam SessionStore.save()）。
        若已存在则 UPSERT 更新。
        """
        conn = self._conn()
        try:
            now = self._now()
            # 检查是否已存在
            existing = conn.execute(
                "SELECT session_id FROM lobster_sessions WHERE lobster_name=? AND team_id=?",
                (lobster_name, team_id)
            ).fetchone()

            if existing:
                session_id = existing["session_id"]
                # 可选：先打快照
                if take_snapshot and snapshot_reason:
                    old = conn.execute(
                        "SELECT * FROM lobster_sessions WHERE session_id=?", (session_id,)
                    ).fetchone()
                    if old:
                        self._take_snapshot(conn, dict(old), snapshot_reason)

                conn.execute(
                    """UPDATE lobster_sessions SET
                       task_id=?, step_index=?, status=?, context=?,
                       checkpoint=?, saved_at=?
                       WHERE session_id=?""",
                    (task_id, step_index, status,
                     json.dumps(context or {}), checkpoint, now, session_id)
                )
            else:
                session_id = f"ls_{uuid.uuid4().hex[:12]}"
                conn.execute(
                    """INSERT INTO lobster_sessions
                       (session_id, lobster_name, team_id, task_id, step_index,
                        status, context, checkpoint, saved_at, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (session_id, lobster_name, team_id, task_id, step_index,
                     status, json.dumps(context or {}), checkpoint, now, now)
                )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM lobster_sessions WHERE session_id=?", (session_id,)
            ).fetchone()
            return SessionState(dict(row))
        finally:
            conn.close()

    # ── 加载会话（断点续跑）──────────────────────────────────────

    def load(self, lobster_name: str, team_id: str = "") -> Optional[SessionState]:
        """
        加载龙虾最新会话状态（对应 ClawTeam SessionStore.load()）。
        龙虾重启后调用，获取上次执行到的位置。
        返回 None 表示无历史会话（全新启动）。
        """
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM lobster_sessions WHERE lobster_name=? AND team_id=?",
                (lobster_name, team_id)
            ).fetchone()
            return SessionState(dict(row)) if row else None
        finally:
            conn.close()

    def load_or_create(
        self,
        lobster_name: str,
        team_id: str = "",
        initial_context: Optional[dict] = None,
    ) -> SessionState:
        """加载或新建会话"""
        state = self.load(lobster_name, team_id)
        if state:
            return state
        return self.save(lobster_name, team_id=team_id,
                          context=initial_context or {})

    # ── 更新上下文 KV ─────────────────────────────────────────────

    def update_context(
        self,
        lobster_name: str,
        team_id: str = "",
        updates: Optional[dict[str, Any]] = None,
        task_id: Optional[str] = None,
        step_index: Optional[int] = None,
        checkpoint: Optional[str] = None,
    ) -> Optional[SessionState]:
        """
        增量更新 context KV（merge，不覆盖整个 context）。
        """
        state = self.load(lobster_name, team_id)
        if not state:
            return None
        merged_ctx = {**state.context, **(updates or {})}
        return self.save(
            lobster_name=lobster_name,
            team_id=team_id,
            task_id=task_id if task_id is not None else state.task_id,
            step_index=step_index if step_index is not None else state.step_index,
            status=state.status,
            context=merged_ctx,
            checkpoint=checkpoint if checkpoint is not None else state.checkpoint,
        )

    def advance_step(
        self,
        lobster_name: str,
        team_id: str = "",
        result: Optional[Any] = None,
    ) -> Optional[SessionState]:
        """步骤完成，step_index +1，可选保存步骤结果到 context"""
        state = self.load(lobster_name, team_id)
        if not state:
            return None
        ctx = dict(state.context)
        if result is not None:
            ctx[f"step_{state.step_index}_result"] = result
        return self.save(
            lobster_name=lobster_name,
            team_id=team_id,
            task_id=state.task_id,
            step_index=state.step_index + 1,
            context=ctx,
            checkpoint=f"step_{state.step_index + 1}",
        )

    # ── 状态管理 ──────────────────────────────────────────────────

    def mark_completed(self, lobster_name: str, team_id: str = "") -> Optional[SessionState]:
        state = self.load(lobster_name, team_id)
        if not state:
            return None
        return self.save(lobster_name, team_id=team_id,
                          task_id=state.task_id, step_index=state.step_index,
                          status="completed", context=state.context)

    def mark_paused(self, lobster_name: str, team_id: str = "",
                     reason: str = "") -> Optional[SessionState]:
        state = self.load(lobster_name, team_id)
        if not state:
            return None
        ctx = {**state.context, "pause_reason": reason}
        return self.save(lobster_name, team_id=team_id,
                          task_id=state.task_id, step_index=state.step_index,
                          status="paused", context=ctx)

    def clear(self, lobster_name: str, team_id: str = "") -> bool:
        """清除会话（任务完成后清理）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "DELETE FROM lobster_sessions WHERE lobster_name=? AND team_id=?",
                (lobster_name, team_id)
            ).rowcount
            conn.commit()
            return rows > 0
        finally:
            conn.close()

    # ── 快照 ──────────────────────────────────────────────────────

    def _take_snapshot(self, conn: sqlite3.Connection, row: dict, reason: str) -> None:
        conn.execute(
            """INSERT INTO session_snapshots
               (snap_id, lobster_name, team_id, task_id, step_index,
                context, checkpoint, reason, saved_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (f"ss_{uuid.uuid4().hex[:8]}", row.get("lobster_name", ""),
             row.get("team_id", ""), row.get("task_id", ""),
             row.get("step_index", 0), row.get("context", "{}"),
             row.get("checkpoint", ""), reason, self._now())
        )

    def get_snapshots(self, lobster_name: str, team_id: str = "",
                       limit: int = 20) -> list[dict]:
        """获取会话历史快照（用于回滚）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM session_snapshots WHERE lobster_name=? AND team_id=?"
                " ORDER BY saved_at DESC LIMIT ?",
                (lobster_name, team_id, limit)
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # ── 查询 ──────────────────────────────────────────────────────

    def list_sessions(
        self,
        team_id: str = "",
        status: Optional[str] = None,
        limit: int = 100,
    ) -> list[SessionState]:
        """列出所有会话（Dashboard 用）"""
        conn = self._conn()
        try:
            q = "SELECT * FROM lobster_sessions WHERE 1=1"
            params: list[Any] = []
            if team_id:
                q += " AND team_id=?"
                params.append(team_id)
            if status:
                q += " AND status=?"
                params.append(status)
            q += " ORDER BY saved_at DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(q, params).fetchall()
            return [SessionState(dict(r)) for r in rows]
        finally:
            conn.close()

    def get_active_sessions(self, team_id: str = "") -> list[SessionState]:
        """获取所有 active 状态的龙虾会话"""
        return self.list_sessions(team_id=team_id, status="active")


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_session: Optional[LobsterSession] = None

def get_lobster_session() -> LobsterSession:
    global _default_session
    if _default_session is None:
        _default_session = LobsterSession()
    return _default_session
