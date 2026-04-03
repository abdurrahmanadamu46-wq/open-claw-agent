"""
LobsterMailbox — 龙虾间消息通信 + Dead Agent 自动恢复
====================================================
灵感来源：ClawTeam-OpenClaw (team/mailbox.py + team/models.py MessageType)
借鉴要点：
  - MailboxManager：龙虾间结构化消息收发
  - 12种 MessageType（普通/计划审批/关机/广播/空闲上报...）
  - Broadcast：Coordinator → 所有龙虾广播
  - Dead Lobster 检测 + 任务自动恢复
  - 事件历史持久化（不消费，仅审计）
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

_DB_PATH = os.getenv("LOBSTER_MAILBOX_DB", "./data/lobster_mailbox.sqlite")
_DEAD_THRESHOLD_S = float(os.getenv("LOBSTER_DEAD_THRESHOLD_S", "60"))  # 60秒无心跳视为死亡


# ─────────────────────────────────────────────────────────────────
# 消息类型（对应 ClawTeam MessageType + 我们业务扩展）
# ─────────────────────────────────────────────────────────────────

class LobsterMessageType(str, Enum):
    # 基础通信
    message          = "message"           # 普通消息
    broadcast        = "broadcast"         # 广播（Coordinator→全部龙虾）

    # 任务协作
    task_assigned    = "task_assigned"     # 分配任务给龙虾
    task_result      = "task_result"       # 龙虾返回任务结果
    task_help        = "task_help"         # 龙虾请求协助
    task_blocked     = "task_blocked"      # 龙虾报告被阻塞

    # 计划审批（Plan Approval Workflow）
    plan_submit      = "plan_submit"       # 龙虾提交执行计划
    plan_approved    = "plan_approved"     # 计划批准
    plan_rejected    = "plan_rejected"     # 计划拒绝

    # 生命周期
    join_request     = "join_request"      # 龙虾申请加入团队
    join_approved    = "join_approved"     # 批准加入
    idle             = "idle"              # 龙虾空闲上报（心跳）
    shutdown_request = "shutdown_request"  # 请求关闭龙虾
    shutdown_ack     = "shutdown_ack"      # 确认关闭


# ─────────────────────────────────────────────────────────────────
# 消息体
# ─────────────────────────────────────────────────────────────────

class LobsterMessage:
    def __init__(self, row: dict) -> None:
        self.msg_id     = row["msg_id"]
        self.from_agent = row["from_agent"]
        self.to_agent   = row["to_agent"]   # "" = broadcast
        self.team_id    = row.get("team_id", "")
        self.msg_type   = LobsterMessageType(row.get("msg_type", "message"))
        self.content    = row.get("content", "")
        self.payload    = json.loads(row.get("payload", "{}"))
        self.request_id = row.get("request_id", "")
        self.read       = bool(row.get("read", 0))
        self.created_at = row.get("created_at", "")

    def to_dict(self) -> dict:
        return {
            "msg_id": self.msg_id,
            "from_agent": self.from_agent,
            "to_agent": self.to_agent,
            "team_id": self.team_id,
            "msg_type": self.msg_type.value,
            "content": self.content,
            "payload": self.payload,
            "request_id": self.request_id,
            "read": self.read,
            "created_at": self.created_at,
        }


# ─────────────────────────────────────────────────────────────────
# LobsterMailbox — 核心
# ─────────────────────────────────────────────────────────────────

class LobsterMailbox:
    """
    龙虾间消息收发（对应 ClawTeam MailboxManager）。
    支持：
    - 单播（龙虾→龙虾）
    - 广播（Coordinator→全部）
    - 消息已读标记
    - 心跳注册 + Dead Lobster 检测
    - 事件历史（不消费，仅审计）
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

    def _now_ts(self) -> float:
        return time.time()

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS lobster_messages (
                    msg_id      TEXT PRIMARY KEY,
                    from_agent  TEXT NOT NULL,
                    to_agent    TEXT NOT NULL,  -- '' = broadcast
                    team_id     TEXT DEFAULT '',
                    msg_type    TEXT DEFAULT 'message',
                    content     TEXT DEFAULT '',
                    payload     TEXT DEFAULT '{}',
                    request_id  TEXT DEFAULT '',
                    read        INTEGER DEFAULT 0,
                    created_at  TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_lm_to ON lobster_messages(to_agent, read, created_at);
                CREATE INDEX IF NOT EXISTS idx_lm_team ON lobster_messages(team_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_lm_type ON lobster_messages(msg_type, created_at);

                -- 心跳表：记录每个龙虾最后活跃时间
                CREATE TABLE IF NOT EXISTS lobster_heartbeat (
                    lobster_name TEXT PRIMARY KEY,
                    team_id      TEXT DEFAULT '',
                    last_seen_ts REAL NOT NULL,
                    status       TEXT DEFAULT 'active',  -- active/idle/shutdown
                    metadata     TEXT DEFAULT '{}'
                );
            """)
            conn.commit()
        finally:
            conn.close()

    # ── 发送消息 ───────────────────────────────────────────────────

    def send(
        self,
        from_agent: str,
        to_agent: str,
        content: str,
        msg_type: LobsterMessageType = LobsterMessageType.message,
        team_id: str = "",
        payload: Optional[dict] = None,
        request_id: str = "",
    ) -> LobsterMessage:
        """
        发送消息（对应 ClawTeam MailboxManager.send()）。
        to_agent="" 表示广播。
        """
        msg_id = f"lm_{uuid.uuid4().hex[:12]}"
        now = self._now()
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO lobster_messages
                   (msg_id, from_agent, to_agent, team_id, msg_type, content, payload, request_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (msg_id, from_agent, to_agent, team_id, msg_type.value,
                 content[:10000], json.dumps(payload or {}), request_id, now)
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_message(msg_id)

    def broadcast(
        self,
        from_agent: str,
        content: str,
        team_id: str = "",
        msg_type: LobsterMessageType = LobsterMessageType.broadcast,
        payload: Optional[dict] = None,
    ) -> LobsterMessage:
        """
        广播消息（对应 ClawTeam MailboxManager broadcast）。
        Coordinator 向团队内所有龙虾发送。
        """
        return self.send(
            from_agent=from_agent,
            to_agent="",   # 空 = 广播
            content=content,
            msg_type=msg_type,
            team_id=team_id,
            payload=payload,
        )

    # ── 接收消息 ───────────────────────────────────────────────────

    def receive(
        self,
        agent_name: str,
        team_id: str = "",
        limit: int = 20,
        mark_read: bool = True,
    ) -> list[LobsterMessage]:
        """
        龙虾收取消息（单播+广播）。
        包含：to_agent=agent_name 的单播 + to_agent='' 的广播。
        """
        conn = self._conn()
        try:
            params: list[Any] = [agent_name, agent_name]
            q = """
                SELECT * FROM lobster_messages
                WHERE (to_agent = ? OR to_agent = '')
                  AND read = 0
            """
            if team_id:
                q += " AND team_id = ?"
                params.append(team_id)
            q += " ORDER BY created_at ASC LIMIT ?"
            params.append(limit)

            rows = conn.execute(q, params).fetchall()
            msgs = [LobsterMessage(dict(r)) for r in rows]

            if mark_read and msgs:
                ids = [m.msg_id for m in msgs]
                placeholders = ",".join("?" * len(ids))
                conn.execute(
                    f"UPDATE lobster_messages SET read=1 WHERE msg_id IN ({placeholders})",
                    ids
                )
                conn.commit()
            return msgs
        finally:
            conn.close()

    def peek(self, agent_name: str, team_id: str = "", limit: int = 5) -> list[LobsterMessage]:
        """查看未读消息（不标记已读）"""
        return self.receive(agent_name, team_id=team_id, limit=limit, mark_read=False)

    def peek_count(self, agent_name: str, team_id: str = "") -> int:
        """未读消息数"""
        conn = self._conn()
        try:
            params: list[Any] = [agent_name, agent_name]
            q = "SELECT COUNT(*) FROM lobster_messages WHERE (to_agent=? OR to_agent='') AND read=0"
            if team_id:
                q += " AND team_id=?"
                params.append(team_id)
            row = conn.execute(q, params).fetchone()
            return row[0] if row else 0
        finally:
            conn.close()

    def get_message(self, msg_id: str) -> Optional[LobsterMessage]:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM lobster_messages WHERE msg_id=?", (msg_id,)
            ).fetchone()
            return LobsterMessage(dict(row)) if row else None
        finally:
            conn.close()

    # ── 心跳 & Dead Lobster 检测 ──────────────────────────────────

    def heartbeat(
        self,
        lobster_name: str,
        team_id: str = "",
        status: str = "active",
        metadata: Optional[dict] = None,
    ) -> None:
        """
        龙虾心跳上报（对应 ClawTeam idle 消息）。
        每次执行后调用，用于 Dead Lobster 检测。
        """
        conn = self._conn()
        try:
            conn.execute(
                """INSERT OR REPLACE INTO lobster_heartbeat
                   (lobster_name, team_id, last_seen_ts, status, metadata)
                   VALUES (?, ?, ?, ?, ?)""",
                (lobster_name, team_id, self._now_ts(), status, json.dumps(metadata or {}))
            )
            conn.commit()
        finally:
            conn.close()

    def get_dead_lobsters(
        self,
        team_id: str = "",
        threshold_s: float = _DEAD_THRESHOLD_S,
    ) -> list[str]:
        """
        检测死亡龙虾（超过 threshold_s 无心跳）。
        对应 ClawTeam TaskWaiter._detect_dead_agents()。
        """
        cutoff = self._now_ts() - threshold_s
        conn = self._conn()
        try:
            q = """
                SELECT lobster_name FROM lobster_heartbeat
                WHERE last_seen_ts < ? AND status != 'shutdown'
            """
            params: list[Any] = [cutoff]
            if team_id:
                q += " AND team_id=?"
                params.append(team_id)
            rows = conn.execute(q, params).fetchall()
            return [r["lobster_name"] for r in rows]
        finally:
            conn.close()

    def mark_shutdown(self, lobster_name: str) -> None:
        """标记龙虾已正常关机（不算死亡）"""
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE lobster_heartbeat SET status='shutdown', last_seen_ts=? WHERE lobster_name=?",
                (self._now_ts(), lobster_name)
            )
            conn.commit()
        finally:
            conn.close()

    def get_active_lobsters(self, team_id: str = "") -> list[dict]:
        """获取所有活跃龙虾列表"""
        cutoff = self._now_ts() - _DEAD_THRESHOLD_S
        conn = self._conn()
        try:
            q = "SELECT * FROM lobster_heartbeat WHERE last_seen_ts >= ? AND status != 'shutdown'"
            params: list[Any] = [cutoff]
            if team_id:
                q += " AND team_id=?"
                params.append(team_id)
            rows = conn.execute(q, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # ── 历史查询 ──────────────────────────────────────────────────

    def get_history(
        self,
        team_id: str = "",
        msg_type: Optional[str] = None,
        from_agent: Optional[str] = None,
        limit: int = 100,
    ) -> list[LobsterMessage]:
        """查询消息历史（审计用，不影响已读状态）"""
        conn = self._conn()
        try:
            q = "SELECT * FROM lobster_messages WHERE 1=1"
            params: list[Any] = []
            if team_id:
                q += " AND team_id=?"
                params.append(team_id)
            if msg_type:
                q += " AND msg_type=?"
                params.append(msg_type)
            if from_agent:
                q += " AND from_agent=?"
                params.append(from_agent)
            q += " ORDER BY created_at DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(q, params).fetchall()
            return [LobsterMessage(dict(r)) for r in rows]
        finally:
            conn.close()

    # ── 快捷工厂方法 ──────────────────────────────────────────────

    def send_task_result(
        self,
        from_lobster: str,
        to_coordinator: str,
        task_id: str,
        result: str,
        team_id: str = "",
    ) -> LobsterMessage:
        """龙虾返回任务结果给 Coordinator"""
        return self.send(
            from_agent=from_lobster,
            to_agent=to_coordinator,
            content=result[:2000],
            msg_type=LobsterMessageType.task_result,
            team_id=team_id,
            payload={"task_id": task_id, "result": result},
            request_id=task_id,
        )

    def send_idle(
        self,
        lobster_name: str,
        coordinator: str,
        team_id: str = "",
        last_task_id: str = "",
    ) -> LobsterMessage:
        """龙虾空闲上报（心跳）"""
        self.heartbeat(lobster_name, team_id=team_id, status="idle")
        return self.send(
            from_agent=lobster_name,
            to_agent=coordinator,
            content=f"{lobster_name} 空闲，等待新任务",
            msg_type=LobsterMessageType.idle,
            team_id=team_id,
            payload={"last_task_id": last_task_id},
        )

    def send_plan_submit(
        self,
        lobster_name: str,
        coordinator: str,
        plan_content: str,
        task_id: str = "",
        team_id: str = "",
    ) -> LobsterMessage:
        """龙虾提交执行计划给 Coordinator 审批"""
        request_id = f"plan_{uuid.uuid4().hex[:8]}"
        return self.send(
            from_agent=lobster_name,
            to_agent=coordinator,
            content=plan_content[:5000],
            msg_type=LobsterMessageType.plan_submit,
            team_id=team_id,
            payload={"task_id": task_id, "plan": plan_content},
            request_id=request_id,
        )


# ─────────────────────────────────────────────────────────────────
# LobsterCoordinator — 协调器（Coordinator 端使用）
# ─────────────────────────────────────────────────────────────────

class LobsterCoordinator:
    """
    团队协调器（对应 ClawTeam TeamManager + TaskWaiter）。
    负责：分发任务、处理心跳、检测死亡龙虾、广播消息。
    """

    def __init__(
        self,
        coordinator_name: str,
        team_id: str,
        mailbox: LobsterMailbox,
        on_dead_lobster: Optional[Callable[[str, list[str]], None]] = None,
    ) -> None:
        self.name = coordinator_name
        self.team_id = team_id
        self.mailbox = mailbox
        self.on_dead_lobster = on_dead_lobster  # callback(lobster_name, recovered_task_ids)

    def broadcast(self, content: str, payload: Optional[dict] = None) -> LobsterMessage:
        """向所有龙虾广播消息"""
        return self.mailbox.broadcast(
            from_agent=self.name,
            content=content,
            team_id=self.team_id,
            payload=payload,
        )

    def assign_task(
        self,
        to_lobster: str,
        task_id: str,
        subject: str,
        description: str = "",
    ) -> LobsterMessage:
        """分配任务给指定龙虾"""
        return self.mailbox.send(
            from_agent=self.name,
            to_agent=to_lobster,
            content=f"任务：{subject}",
            msg_type=LobsterMessageType.task_assigned,
            team_id=self.team_id,
            payload={"task_id": task_id, "subject": subject, "description": description},
            request_id=task_id,
        )

    def check_dead_lobsters(self, dag=None) -> list[str]:
        """
        检测死亡龙虾并恢复任务（对应 ClawTeam TaskWaiter dead agent detection）。
        如果传入 dag（LobsterTaskDAG），自动恢复其持有的任务。
        """
        dead = self.mailbox.get_dead_lobsters(team_id=self.team_id)
        for lobster_name in dead:
            recovered_ids = []
            if dag:
                recovered_ids = dag.recover_dead_lobster(lobster_name)
            if self.on_dead_lobster:
                self.on_dead_lobster(lobster_name, recovered_ids)
            # 广播死亡通知
            self.broadcast(
                f"⚠️ 龙虾 {lobster_name} 无响应，已恢复其任务 {recovered_ids}",
                payload={"event": "lobster_dead", "lobster": lobster_name, "recovered": recovered_ids}
            )
        return dead

    def approve_plan(self, request_id: str, to_lobster: str, comment: str = "") -> LobsterMessage:
        return self.mailbox.send(
            from_agent=self.name,
            to_agent=to_lobster,
            content=f"计划已批准。{comment}",
            msg_type=LobsterMessageType.plan_approved,
            team_id=self.team_id,
            request_id=request_id,
        )

    def reject_plan(self, request_id: str, to_lobster: str, reason: str = "") -> LobsterMessage:
        return self.mailbox.send(
            from_agent=self.name,
            to_agent=to_lobster,
            content=f"计划被拒绝：{reason}",
            msg_type=LobsterMessageType.plan_rejected,
            team_id=self.team_id,
            request_id=request_id,
        )

    def drain_inbox(self) -> list[LobsterMessage]:
        """收取 Coordinator 的所有未读消息"""
        return self.mailbox.receive(self.name, team_id=self.team_id, limit=50)


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_mailbox: Optional[LobsterMailbox] = None

def get_lobster_mailbox() -> LobsterMailbox:
    global _default_mailbox
    if _default_mailbox is None:
        _default_mailbox = LobsterMailbox()
    return _default_mailbox
