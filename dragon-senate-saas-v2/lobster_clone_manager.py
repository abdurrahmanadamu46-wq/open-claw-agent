"""
LobsterCloneManager — 动态分身执行管理器
==========================================
实现《Dragon Senate 龙虾宪章》第四章：动态分身执行机制

核心设计：
  每只龙虾 = 元老灵魂（Mother）+ N个分身执行实例（Clone）

  元老（Mother Instance）：
    - 拥有完整身份档案、长期记忆、进化能力
    - 每次任务结束后，分身经验回写到元老（EMA进化）
    - 元老越来越聪明，分身自动继承最新版本

  分身（Clone Instance）：
    - 继承元老当前的身份/能力/知识快照
    - 独立执行任务，不互相干扰
    - 执行完成后销毁（临时性）
    - 最大并发数见各龙虾合同

分身上限（来自宪章合同）：
  commander:  1（唯一总指挥，不可分身）
  radar:      5
  strategist: 3
  inkwriter:  8
  visualizer: 4
  dispatcher: 10
  echoer:     20
  catcher:    5
  abacus:     3
  followup:   15

使用方式：
    manager = LobsterCloneManager()

    # 请求分身
    clone = manager.spawn_clone("inkwriter", task_id="lt_abc", customer_id="c_001")
    # → CloneInstance(clone_id="inkwriter_clone_3", lobster="inkwriter")

    # 分身执行完毕，回写经验
    manager.retire_clone(clone.clone_id, quality_score=4.2,
                          win_extract="加emoji标题CTR+22%")

    # 查看当前活跃分身
    active = manager.list_active_clones("inkwriter")
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from lobster_evolution_engine import (
    LOBSTER_IDENTITIES,
    LobsterEvolutionEngine,
    after_task,
    get_evolution_engine,
)

_DB_PATH = os.getenv("LOBSTER_CLONE_DB", "./data/lobster_clones.sqlite")

# 从宪章提取各龙虾分身上限
MAX_CLONES: dict[str, int] = {
    lid: info.get("max_clones", 1)
    for lid, info in LOBSTER_IDENTITIES.items()
}


# ─────────────────────────────────────────────────────────────────
# CloneInstance 数据模型
# ─────────────────────────────────────────────────────────────────

class CloneInstance:
    """分身实例（继承元老快照）"""

    def __init__(self, row: dict) -> None:
        self.clone_id      = row["clone_id"]
        self.lobster       = row["lobster"]
        self.clone_seq     = int(row.get("clone_seq", 1))
        self.task_id       = row.get("task_id", "")
        self.team_id       = row.get("team_id", "")
        self.customer_id   = row.get("customer_id", "")
        self.status        = row.get("status", "active")   # active/completed/failed/expired
        self.mother_score  = float(row.get("mother_score", 1.0))  # 继承元老当前质量分
        self.mother_level  = int(row.get("mother_level", 1))      # 继承元老当前等级
        self.identity_snap = json.loads(row.get("identity_snap", "{}"))  # 身份快照
        self.spawned_at    = row.get("spawned_at", "")
        self.retired_at    = row.get("retired_at", "")
        self.quality_score = float(row.get("quality_score", 0.0))  # 执行结果质量分
        self.win_extract   = row.get("win_extract", "")

    def to_dict(self) -> dict:
        return {
            "clone_id": self.clone_id,
            "lobster": self.lobster,
            "clone_seq": self.clone_seq,
            "task_id": self.task_id,
            "team_id": self.team_id,
            "customer_id": self.customer_id,
            "status": self.status,
            "mother_score": self.mother_score,
            "mother_level": self.mother_level,
            "identity_snap": self.identity_snap,
            "spawned_at": self.spawned_at,
            "retired_at": self.retired_at,
            "quality_score": self.quality_score,
            "win_extract": self.win_extract,
        }


# ─────────────────────────────────────────────────────────────────
# LobsterCloneManager — 核心
# ─────────────────────────────────────────────────────────────────

class LobsterCloneManager:
    """
    龙虾动态分身管理器（对应宪章第四章）。

    负责：
    - spawn_clone：按需创建分身（继承元老快照）
    - retire_clone：分身退役（经验回写元老）
    - list_active_clones：查询活跃分身
    - get_clone_capacity：查询当前容量（已用/上限）
    - emergency_expand：紧急模式扩容（commander专属）
    """

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._engine = get_evolution_engine()
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self._db, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=5000")
        return c

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS lobster_clones (
                    clone_id      TEXT PRIMARY KEY,
                    lobster       TEXT NOT NULL,
                    clone_seq     INTEGER NOT NULL,  -- 第几个分身（当前会话）
                    task_id       TEXT DEFAULT '',
                    team_id       TEXT DEFAULT '',
                    customer_id   TEXT DEFAULT '',
                    status        TEXT DEFAULT 'active',  -- active/completed/failed/expired
                    mother_score  REAL DEFAULT 1.0,       -- 继承元老质量分
                    mother_level  INTEGER DEFAULT 1,      -- 继承元老等级
                    identity_snap TEXT DEFAULT '{}',      -- 元老身份快照
                    quality_score REAL DEFAULT 0,         -- 执行结果质量分
                    win_extract   TEXT DEFAULT '',
                    error_type    TEXT DEFAULT '',
                    spawned_at    TEXT NOT NULL,
                    retired_at    TEXT DEFAULT '',
                    duration_s    REAL DEFAULT 0,
                    tokens_in     INTEGER DEFAULT 0,
                    tokens_out    INTEGER DEFAULT 0,
                    cost_cents    REAL DEFAULT 0,
                    notes         TEXT DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_lc_lobster ON lobster_clones(lobster, status);
                CREATE INDEX IF NOT EXISTS idx_lc_task ON lobster_clones(task_id);
                CREATE INDEX IF NOT EXISTS idx_lc_customer ON lobster_clones(customer_id, status);

                -- 分身容量扩展记录（emergency_expand）
                CREATE TABLE IF NOT EXISTS clone_capacity_overrides (
                    lobster        TEXT PRIMARY KEY,
                    override_limit INTEGER NOT NULL,
                    reason         TEXT DEFAULT '',
                    expires_at     TEXT DEFAULT '',
                    created_by     TEXT DEFAULT 'commander',
                    created_at     TEXT NOT NULL
                );
            """)
            conn.commit()
        finally:
            conn.close()

    # ── 获取当前分身上限 ──────────────────────────────────────────

    def get_max_clones(self, lobster: str) -> int:
        """获取龙虾当前分身上限（考虑紧急扩容）"""
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM clone_capacity_overrides WHERE lobster=?", (lobster,)
            ).fetchone()
            if row:
                expires = row["expires_at"]
                if not expires or expires > self._now():
                    return int(row["override_limit"])
            return MAX_CLONES.get(lobster, 1)
        finally:
            conn.close()

    def get_active_count(self, lobster: str) -> int:
        """当前活跃分身数量"""
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM lobster_clones WHERE lobster=? AND status='active'",
                (lobster,)
            ).fetchone()
            return row["cnt"] if row else 0
        finally:
            conn.close()

    def get_clone_capacity(self, lobster: str) -> dict:
        """查询分身容量状态"""
        active = self.get_active_count(lobster)
        max_c = self.get_max_clones(lobster)
        return {
            "lobster": lobster,
            "active_clones": active,
            "max_clones": max_c,
            "available_slots": max(0, max_c - active),
            "can_spawn": active < max_c,
            "utilization_pct": round(active / max_c * 100, 1) if max_c > 0 else 100,
        }

    # ── 创建分身 ──────────────────────────────────────────────────

    def spawn_clone(
        self,
        lobster: str,
        task_id: str = "",
        team_id: str = "",
        customer_id: str = "",
        notes: str = "",
        force: bool = False,   # True=忽略上限限制（仅测试用）
    ) -> Optional[CloneInstance]:
        """
        为龙虾创建分身（继承元老当前状态快照）。

        如果超出分身上限：返回 None（加入队列等待）
        commander 分身上限=1，调用此函数会得到 None。

        示例：
            clone = manager.spawn_clone("inkwriter", task_id="lt_abc",
                                        customer_id="c_001")
            # → 分身继承了元老当前 quality_score=3.8, level=4 的状态
        """
        cap = self.get_clone_capacity(lobster)
        if not cap["can_spawn"] and not force:
            return None  # 容量已满，加入等待队列

        # 从进化引擎获取元老当前状态
        state = self._engine.get_evolution_state(lobster)
        mother_score = float(state.get("quality_score", 1.0)) if state else 1.0
        mother_level = int(state.get("evolution_level", 1)) if state else 1

        # 身份快照（元老当前身份，含已沉淀的赢的经验）
        identity = LOBSTER_IDENTITIES.get(lobster, {}).copy()
        if state:
            identity["win_extracts"] = state.get("win_extracts", [])[:20]  # 最近20条经验注入

        # 分配分身序号
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT MAX(clone_seq) as max_seq FROM lobster_clones WHERE lobster=?",
                (lobster,)
            ).fetchone()
            seq = (row["max_seq"] or 0) + 1

            clone_id = f"{lobster}_clone_{seq}_{uuid.uuid4().hex[:6]}"
            now = self._now()

            conn.execute(
                """INSERT INTO lobster_clones
                   (clone_id, lobster, clone_seq, task_id, team_id, customer_id,
                    status, mother_score, mother_level, identity_snap, spawned_at, notes)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (clone_id, lobster, seq, task_id, team_id, customer_id,
                 "active", mother_score, mother_level,
                 json.dumps(identity, ensure_ascii=False), now, notes)
            )
            conn.commit()

            row = conn.execute(
                "SELECT * FROM lobster_clones WHERE clone_id=?", (clone_id,)
            ).fetchone()
            return CloneInstance(dict(row))
        finally:
            conn.close()

    # ── 分身退役（经验回写元老）──────────────────────────────────

    def retire_clone(
        self,
        clone_id: str,
        quality_score: float = 0.0,
        win_extract: str = "",
        error_type: str = "",
        loss_postmortem: str = "",
        writeback_targets: Optional[list[str]] = None,
        tokens_in: int = 0,
        tokens_out: int = 0,
        cost_cents: float = 0.0,
        input_summary: str = "",
        output_summary: str = "",
        model: str = "",
        duration_s: float = 0.0,
        status: str = "completed",
    ) -> Optional[CloneInstance]:
        """
        分身退役（任务完成/失败）。
        自动将经验回写到元老（EMA进化）。

        示例：
            manager.retire_clone(
                clone.clone_id,
                quality_score=4.2,
                win_extract="emoji标题点击率+22%",
                writeback_targets=["industry_kb"],
            )
        """
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM lobster_clones WHERE clone_id=?", (clone_id,)
            ).fetchone()
            if not row:
                return None

            now = self._now()
            conn.execute(
                """UPDATE lobster_clones SET
                   status=?, quality_score=?, win_extract=?, error_type=?,
                   tokens_in=?, tokens_out=?, cost_cents=?, duration_s=?,
                   retired_at=?
                   WHERE clone_id=?""",
                (status, quality_score, win_extract, error_type,
                 tokens_in, tokens_out, cost_cents, duration_s, now, clone_id)
            )
            conn.commit()

            # 经验回写元老（军规#1-3）
            if quality_score > 0:
                after_task(
                    lobster=row["lobster"],
                    task_id=row["task_id"],
                    quality_score=quality_score,
                    input_summary=input_summary,
                    output_summary=output_summary,
                    model=model,
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    cost_cents=cost_cents,
                    error_type=error_type,
                    win_extract=win_extract,
                    loss_postmortem=loss_postmortem,
                    writeback_targets=writeback_targets or [],
                    clone_id=clone_id,
                    team_id=row["team_id"],
                    customer_id=row["customer_id"],
                    duration_s=duration_s,
                )

            row2 = conn.execute(
                "SELECT * FROM lobster_clones WHERE clone_id=?", (clone_id,)
            ).fetchone()
            return CloneInstance(dict(row2))
        finally:
            conn.close()

    # ── 批量清理过期分身 ──────────────────────────────────────────

    def expire_stale_clones(
        self,
        lobster: str = "",
        stale_seconds: float = 3600,
    ) -> list[str]:
        """
        清理长时间未退役的分身（Dead Clone）。
        超过 stale_seconds 仍 active 的分身 → 标记为 expired。
        """
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_seconds)
        cutoff_str = cutoff.isoformat()

        conn = self._conn()
        try:
            q = "SELECT clone_id FROM lobster_clones WHERE status='active' AND spawned_at < ?"
            params: list[Any] = [cutoff_str]
            if lobster:
                q += " AND lobster=?"
                params.append(lobster)
            rows = conn.execute(q, params).fetchall()
            expired_ids = [r["clone_id"] for r in rows]

            if expired_ids:
                placeholders = ",".join("?" * len(expired_ids))
                conn.execute(
                    f"UPDATE lobster_clones SET status='expired', retired_at=? WHERE clone_id IN ({placeholders})",
                    [self._now()] + expired_ids
                )
                conn.commit()
            return expired_ids
        finally:
            conn.close()

    # ── 紧急扩容（commander 专属）────────────────────────────────

    def emergency_expand(
        self,
        lobster: str,
        new_limit: int,
        reason: str = "",
        expires_in_hours: float = 4.0,
        authorized_by: str = "commander",
    ) -> dict:
        """
        临时提升分身上限（紧急模式，commander 专属）。
        自动在 expires_in_hours 小时后失效。
        """
        from datetime import timedelta
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)).isoformat()

        original_max = MAX_CLONES.get(lobster, 1)
        if new_limit <= original_max:
            return {"ok": False, "reason": f"新上限({new_limit})不高于原上限({original_max})"}

        conn = self._conn()
        try:
            conn.execute(
                """INSERT OR REPLACE INTO clone_capacity_overrides
                   (lobster, override_limit, reason, expires_at, created_by, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (lobster, new_limit, reason, expires_at, authorized_by, self._now())
            )
            conn.commit()
            return {
                "ok": True,
                "lobster": lobster,
                "original_limit": original_max,
                "new_limit": new_limit,
                "expires_at": expires_at,
                "authorized_by": authorized_by,
            }
        finally:
            conn.close()

    # ── 查询 ──────────────────────────────────────────────────────

    def list_active_clones(self, lobster: str = "") -> list[CloneInstance]:
        """查询所有活跃分身"""
        conn = self._conn()
        try:
            q = "SELECT * FROM lobster_clones WHERE status='active'"
            params: list[Any] = []
            if lobster:
                q += " AND lobster=?"
                params.append(lobster)
            q += " ORDER BY spawned_at DESC"
            rows = conn.execute(q, params).fetchall()
            return [CloneInstance(dict(r)) for r in rows]
        finally:
            conn.close()

    def get_clone(self, clone_id: str) -> Optional[CloneInstance]:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM lobster_clones WHERE clone_id=?", (clone_id,)
            ).fetchone()
            return CloneInstance(dict(row)) if row else None
        finally:
            conn.close()

    def get_team_clones(self, team_id: str) -> list[CloneInstance]:
        """获取某个工作流的所有分身（含历史）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM lobster_clones WHERE team_id=? ORDER BY spawned_at",
                (team_id,)
            ).fetchall()
            return [CloneInstance(dict(r)) for r in rows]
        finally:
            conn.close()

    def get_all_capacity(self) -> list[dict]:
        """获取所有龙虾的分身容量状态（Dashboard用）"""
        return [self.get_clone_capacity(lid) for lid in LOBSTER_IDENTITIES]

    def get_customer_clones(self, customer_id: str, active_only: bool = True) -> list[CloneInstance]:
        """获取服务某个客户的所有分身"""
        conn = self._conn()
        try:
            q = "SELECT * FROM lobster_clones WHERE customer_id=?"
            params: list[Any] = [customer_id]
            if active_only:
                q += " AND status='active'"
            q += " ORDER BY spawned_at DESC"
            rows = conn.execute(q, params).fetchall()
            return [CloneInstance(dict(r)) for r in rows]
        finally:
            conn.close()


# ─────────────────────────────────────────────────────────────────
# CloneOrchestrator — 智能分配器
# ─────────────────────────────────────────────────────────────────

class CloneOrchestrator:
    """
    分身编排器（集成 DAG + CircuitBreaker + CloneManager）。

    核心职责：
    - 接收任务，选择最优龙虾，创建分身执行
    - 自动处理：容量限制/熔断过滤/优先级排序
    - 任务完成后自动退役分身+回写经验

    使用方式：
        orch = CloneOrchestrator()
        clone = orch.dispatch(
            lobster_candidates=["inkwriter", "inkwriter"],
            task_id="lt_abc",
            team_id="run-001",
            customer_id="c_001",
        )
    """

    def __init__(self) -> None:
        self._clone_mgr = LobsterCloneManager()

    def dispatch(
        self,
        lobster_candidates: list[str],
        task_id: str = "",
        team_id: str = "",
        customer_id: str = "",
        use_circuit_breaker: bool = True,
    ) -> Optional[CloneInstance]:
        """
        从候选龙虾中选择最优并创建分身。
        综合考虑：分身容量 + 熔断状态 + quality_score。
        """
        # 过滤熔断龙虾（可选）
        eligible = list(lobster_candidates)
        if use_circuit_breaker:
            try:
                from lobster_circuit_breaker import get_circuit_breaker
                cb = get_circuit_breaker()
                eligible = [
                    name for name in eligible
                    if cb.is_accepting(name)
                ]
                if not eligible:
                    eligible = list(lobster_candidates)  # fallback：所有候选
            except Exception:
                pass

        # 按可用容量+quality_score排序，选最优
        scored: list[tuple[float, str]] = []
        for name in eligible:
            cap = self._clone_mgr.get_clone_capacity(name)
            if not cap["can_spawn"]:
                continue
            state = get_evolution_engine().get_evolution_state(name)
            score = float(state.get("quality_score", 1.0)) if state else 1.0
            # 加权：score × 可用槽位比例
            slot_ratio = cap["available_slots"] / max(cap["max_clones"], 1)
            weighted = score * (0.7 + 0.3 * slot_ratio)
            scored.append((weighted, name))

        if not scored:
            # 所有候选都满了，取第一个强制创建（force=True）
            if lobster_candidates:
                return self._clone_mgr.spawn_clone(
                    lobster_candidates[0], task_id=task_id,
                    team_id=team_id, customer_id=customer_id, force=True
                )
            return None

        scored.sort(key=lambda x: x[0], reverse=True)
        best_lobster = scored[0][1]

        return self._clone_mgr.spawn_clone(
            best_lobster, task_id=task_id,
            team_id=team_id, customer_id=customer_id
        )

    def complete_task(
        self,
        clone_id: str,
        quality_score: float,
        **kwargs,
    ) -> Optional[CloneInstance]:
        """分身完成任务（自动退役+回写经验）"""
        return self._clone_mgr.retire_clone(
            clone_id, quality_score=quality_score,
            status="completed", **kwargs
        )

    def fail_task(
        self,
        clone_id: str,
        error_type: str = "",
        loss_postmortem: str = "",
        **kwargs,
    ) -> Optional[CloneInstance]:
        """分身任务失败（自动退役+错误追踪）"""
        return self._clone_mgr.retire_clone(
            clone_id, quality_score=1.0,
            error_type=error_type,
            loss_postmortem=loss_postmortem,
            status="failed", **kwargs
        )


# ─────────────────────────────────────────────────────────────────
# FastAPI Router
# ─────────────────────────────────────────────────────────────────

def make_clone_router():
    try:
        from fastapi import APIRouter, HTTPException
        from pydantic import BaseModel as PBM
    except ImportError:
        return None

    router = APIRouter(prefix="/api/clones", tags=["Clones"])
    mgr = LobsterCloneManager()

    @router.get("/capacity")
    def all_capacity():
        return mgr.get_all_capacity()

    @router.get("/capacity/{lobster}")
    def lobster_capacity(lobster: str):
        return mgr.get_clone_capacity(lobster)

    @router.get("/active")
    def active_clones(lobster: str = ""):
        return [c.to_dict() for c in mgr.list_active_clones(lobster)]

    @router.get("/{clone_id}")
    def get_clone(clone_id: str):
        c = mgr.get_clone(clone_id)
        if not c:
            raise HTTPException(404, "Clone not found")
        return c.to_dict()

    class SpawnBody(PBM):
        lobster: str
        task_id: str = ""
        team_id: str = ""
        customer_id: str = ""
        notes: str = ""

    @router.post("/spawn")
    def spawn(body: SpawnBody):
        clone = mgr.spawn_clone(body.lobster, task_id=body.task_id,
                                  team_id=body.team_id, customer_id=body.customer_id,
                                  notes=body.notes)
        if not clone:
            raise HTTPException(429, f"{body.lobster} 分身已达上限，请等待")
        return clone.to_dict()

    class RetireBody(PBM):
        quality_score: float = 0.0
        win_extract: str = ""
        error_type: str = ""
        loss_postmortem: str = ""
        tokens_in: int = 0
        tokens_out: int = 0
        cost_cents: float = 0.0
        model: str = ""
        duration_s: float = 0.0
        status: str = "completed"

    @router.post("/{clone_id}/retire")
    def retire(clone_id: str, body: RetireBody):
        c = mgr.retire_clone(clone_id, **body.model_dump())
        if not c:
            raise HTTPException(404, "Clone not found")
        return c.to_dict()

    class ExpandBody(PBM):
        new_limit: int
        reason: str = ""
        expires_in_hours: float = 4.0

    @router.post("/emergency-expand/{lobster}")
    def emergency_expand(lobster: str, body: ExpandBody):
        return mgr.emergency_expand(lobster, body.new_limit,
                                     body.reason, body.expires_in_hours)

    return router


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_mgr: Optional[LobsterCloneManager] = None
_default_orch: Optional[CloneOrchestrator] = None

def get_clone_manager() -> LobsterCloneManager:
    global _default_mgr
    if _default_mgr is None:
        _default_mgr = LobsterCloneManager()
    return _default_mgr

def get_clone_orchestrator() -> CloneOrchestrator:
    global _default_orch
    if _default_orch is None:
        _default_orch = CloneOrchestrator()
    return _default_orch
