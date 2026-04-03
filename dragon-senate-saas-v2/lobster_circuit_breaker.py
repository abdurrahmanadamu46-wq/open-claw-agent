"""
LobsterCircuitBreaker — 龙虾健康三态熔断器 + quality_score 路由
=============================================================
灵感来源：ClawTeam-OpenClaw (spawn/registry.py AgentHealth + CircuitBreaker)
借鉴要点：
  - healthy / degraded / open 三态（对应 ClawTeam HealthState）
  - 连续失败 N 次 → open（熔断）→ 冷却后 half-open → 试探 → 恢复
  - quality_score：成功率加权分，指导任务路由（高分龙虾优先）
  - is_accepting_tasks：熔断期拒绝新任务
  - 集成到 lobster_pool_manager：选龙虾时过滤熔断龙虾

使用方式：
    cb = LobsterCircuitBreaker()

    # 龙虾执行成功
    cb.report_success("inkwriter")

    # 龙虾执行失败
    cb.report_failure("inkwriter", "LLM timeout")

    # 选择最优龙虾（过滤熔断，按 quality_score 排序）
    best = cb.get_best_lobster(["inkwriter", "strategist", "researcher"])

    # 检查是否可接单
    if cb.is_accepting(lobster_name):
        task = dag.claim_next(lobster_name)
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
from typing import Any, Optional

_DB_PATH = os.getenv("LOBSTER_CB_DB", "./data/lobster_circuit_breaker.sqlite")
_FAILURE_THRESHOLD  = int(os.getenv("LOBSTER_CB_FAILURE_THRESHOLD", "3"))
_COOLDOWN_SECONDS   = float(os.getenv("LOBSTER_CB_COOLDOWN_S", "60"))
_DEGRADED_THRESHOLD = int(os.getenv("LOBSTER_CB_DEGRADED_THRESHOLD", "2"))


# ─────────────────────────────────────────────────────────────────
# 枚举
# ─────────────────────────────────────────────────────────────────

class HealthState(str, Enum):
    healthy  = "healthy"   # 正常接单
    degraded = "degraded"  # 质量分下降，仍接单但优先级降低
    open     = "open"      # 熔断，拒绝新任务（冷却期）


# ─────────────────────────────────────────────────────────────────
# LobsterHealth 数据模型
# ─────────────────────────────────────────────────────────────────

class LobsterHealth:
    """龙虾健康状态（对应 ClawTeam AgentHealth）"""

    def __init__(self, row: dict) -> None:
        self.lobster_name        = row["lobster_name"]
        self.state               = HealthState(row.get("state", "healthy"))
        self.quality_score       = float(row.get("quality_score", 1.0))
        self.consecutive_failures= int(row.get("consecutive_failures", 0))
        self.total_successes     = int(row.get("total_successes", 0))
        self.total_failures      = int(row.get("total_failures", 0))
        self.last_failure_at     = float(row.get("last_failure_at", 0.0))
        self.last_success_at     = float(row.get("last_success_at", 0.0))
        self.cooldown_seconds    = float(row.get("cooldown_seconds", _COOLDOWN_SECONDS))
        self.failure_threshold   = int(row.get("failure_threshold", _FAILURE_THRESHOLD))
        self.updated_at          = row.get("updated_at", "")
        self.notes               = row.get("notes", "")

    @property
    def is_accepting_tasks(self) -> bool:
        """
        是否接受新任务（对应 ClawTeam AgentHealth.is_accepting_tasks）。
        - healthy/degraded：接受
        - open（熔断）：冷却期内拒绝；超过冷却期后 half-open 允许一次
        """
        if self.state != HealthState.open:
            return True
        if self.last_failure_at and (time.time() - self.last_failure_at) >= self.cooldown_seconds:
            return True   # half-open：允许试探性接单
        return False

    @property
    def success_rate(self) -> float:
        total = self.total_successes + self.total_failures
        if total == 0:
            return 1.0
        return self.total_successes / total

    def to_dict(self) -> dict:
        return {
            "lobster_name": self.lobster_name,
            "state": self.state.value,
            "quality_score": self.quality_score,
            "consecutive_failures": self.consecutive_failures,
            "total_successes": self.total_successes,
            "total_failures": self.total_failures,
            "success_rate": round(self.success_rate, 3),
            "is_accepting_tasks": self.is_accepting_tasks,
            "last_failure_at": self.last_failure_at,
            "last_success_at": self.last_success_at,
            "cooldown_seconds": self.cooldown_seconds,
            "failure_threshold": self.failure_threshold,
            "updated_at": self.updated_at,
            "notes": self.notes,
        }


# ─────────────────────────────────────────────────────────────────
# LobsterCircuitBreaker — 核心
# ─────────────────────────────────────────────────────────────────

class LobsterCircuitBreaker:
    """
    龙虾熔断器（对应 ClawTeam spawn/registry.py CircuitBreaker 思想）。

    三态转换：
      healthy ──（连续失败 ≥ degraded_threshold）──▶ degraded
      degraded ──（连续失败 ≥ failure_threshold）──▶ open（熔断）
      open ──（冷却后 half-open，下次成功）──▶ healthy
      open ──（冷却后 half-open，再失败）──▶ open（重新计冷却）

    quality_score 计算（类似 EMA）：
      success → score = min(1.0, score * 0.95 + 0.05)
      failure → score = score * 0.7  （快速降分）
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
                CREATE TABLE IF NOT EXISTS lobster_health (
                    lobster_name         TEXT PRIMARY KEY,
                    state                TEXT DEFAULT 'healthy',
                    quality_score        REAL DEFAULT 1.0,
                    consecutive_failures INTEGER DEFAULT 0,
                    total_successes      INTEGER DEFAULT 0,
                    total_failures       INTEGER DEFAULT 0,
                    last_failure_at      REAL DEFAULT 0,
                    last_success_at      REAL DEFAULT 0,
                    cooldown_seconds     REAL DEFAULT 60,
                    failure_threshold    INTEGER DEFAULT 3,
                    updated_at           TEXT NOT NULL,
                    notes                TEXT DEFAULT ''
                );

                -- 事件日志（每次成功/失败/状态变更）
                CREATE TABLE IF NOT EXISTS health_events (
                    event_id      TEXT PRIMARY KEY,
                    lobster_name  TEXT NOT NULL,
                    event_type    TEXT NOT NULL,  -- success/failure/state_change/reset
                    old_state     TEXT DEFAULT '',
                    new_state     TEXT DEFAULT '',
                    quality_score REAL DEFAULT 1.0,
                    detail        TEXT DEFAULT '',
                    created_at    TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_he_lobster ON health_events(lobster_name, created_at);
            """)
            conn.commit()
        finally:
            conn.close()

    # ── 获取健康状态 ───────────────────────────────────────────────

    def get_health(self, lobster_name: str) -> LobsterHealth:
        """获取龙虾健康状态（不存在则创建初始状态）"""
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM lobster_health WHERE lobster_name=?", (lobster_name,)
            ).fetchone()
            if row:
                return LobsterHealth(dict(row))
            # 初始化
            now = self._now()
            conn.execute(
                """INSERT OR IGNORE INTO lobster_health
                   (lobster_name, state, quality_score, cooldown_seconds, failure_threshold, updated_at)
                   VALUES (?, 'healthy', 1.0, ?, ?, ?)""",
                (lobster_name, _COOLDOWN_SECONDS, _FAILURE_THRESHOLD, now)
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM lobster_health WHERE lobster_name=?", (lobster_name,)
            ).fetchone()
            return LobsterHealth(dict(row))
        finally:
            conn.close()

    def is_accepting(self, lobster_name: str) -> bool:
        """检查龙虾是否可以接新任务"""
        return self.get_health(lobster_name).is_accepting_tasks

    # ── 上报成功 ───────────────────────────────────────────────────

    def report_success(
        self,
        lobster_name: str,
        detail: str = "",
    ) -> LobsterHealth:
        """
        上报成功（对应 ClawTeam register_success）。
        - 连续失败清零
        - quality_score 缓慢回升
        - open → healthy（half-open 成功）
        """
        conn = self._conn()
        try:
            h = self.get_health(lobster_name)
            old_state = h.state

            new_score = min(1.0, h.quality_score * 0.95 + 0.05)
            new_failures = 0
            new_total_succ = h.total_successes + 1
            now_ts = time.time()

            # 状态转换
            if h.state == HealthState.open:
                # half-open 成功 → 恢复 healthy
                new_state = HealthState.healthy
            elif h.state == HealthState.degraded and h.consecutive_failures == 0:
                new_state = HealthState.healthy
            else:
                new_state = HealthState.healthy if new_score >= 0.9 else HealthState.degraded

            now = self._now()
            conn.execute(
                """UPDATE lobster_health SET
                   state=?, quality_score=?, consecutive_failures=?,
                   total_successes=?, last_success_at=?, updated_at=?
                   WHERE lobster_name=?""",
                (new_state.value, round(new_score, 4), new_failures,
                 new_total_succ, now_ts, now, lobster_name)
            )
            conn.commit()
            self._log_event(conn, lobster_name, "success",
                             old_state.value, new_state.value, new_score, detail)
            conn.commit()
            return self.get_health(lobster_name)
        finally:
            conn.close()

    # ── 上报失败 ───────────────────────────────────────────────────

    def report_failure(
        self,
        lobster_name: str,
        error: str = "",
        failure_threshold: Optional[int] = None,
    ) -> LobsterHealth:
        """
        上报失败（对应 ClawTeam register_failure）。
        三态转换：
          - 连续失败 ≥ degraded_threshold → degraded
          - 连续失败 ≥ failure_threshold → open（熔断）
        quality_score 快速下降（×0.7）。
        """
        conn = self._conn()
        try:
            h = self.get_health(lobster_name)
            old_state = h.state
            threshold = failure_threshold or h.failure_threshold

            new_score = max(0.0, h.quality_score * 0.7)
            new_consec = h.consecutive_failures + 1
            new_total_fail = h.total_failures + 1
            now_ts = time.time()

            # 状态转换
            if new_consec >= threshold:
                new_state = HealthState.open   # 熔断
            elif new_consec >= _DEGRADED_THRESHOLD:
                new_state = HealthState.degraded
            else:
                new_state = h.state  # 保持当前状态

            now = self._now()
            conn.execute(
                """UPDATE lobster_health SET
                   state=?, quality_score=?, consecutive_failures=?,
                   total_failures=?, last_failure_at=?, updated_at=?, notes=?
                   WHERE lobster_name=?""",
                (new_state.value, round(new_score, 4), new_consec,
                 new_total_fail, now_ts, now, error[:500], lobster_name)
            )
            conn.commit()
            self._log_event(conn, lobster_name, "failure",
                             old_state.value, new_state.value, new_score,
                             f"连续失败#{new_consec}: {error[:200]}")
            conn.commit()
            return self.get_health(lobster_name)
        finally:
            conn.close()

    # ── 手动操作 ───────────────────────────────────────────────────

    def reset(self, lobster_name: str) -> LobsterHealth:
        """手动重置龙虾健康状态（运维用）"""
        conn = self._conn()
        try:
            h = self.get_health(lobster_name)
            old_state = h.state
            now = self._now()
            conn.execute(
                """UPDATE lobster_health SET
                   state='healthy', quality_score=1.0, consecutive_failures=0,
                   last_failure_at=0, notes='', updated_at=?
                   WHERE lobster_name=?""",
                (now, lobster_name)
            )
            conn.commit()
            self._log_event(conn, lobster_name, "reset",
                             old_state.value, "healthy", 1.0, "手动重置")
            conn.commit()
            return self.get_health(lobster_name)
        finally:
            conn.close()

    def force_open(self, lobster_name: str, reason: str = "") -> LobsterHealth:
        """强制熔断（运维用，如发现龙虾输出质量问题）"""
        conn = self._conn()
        try:
            h = self.get_health(lobster_name)
            now = self._now()
            conn.execute(
                """UPDATE lobster_health SET
                   state='open', consecutive_failures=999,
                   last_failure_at=?, notes=?, updated_at=?
                   WHERE lobster_name=?""",
                (time.time(), reason[:500], now, lobster_name)
            )
            conn.commit()
            self._log_event(conn, lobster_name, "force_open",
                             h.state.value, "open", h.quality_score, reason)
            conn.commit()
            return self.get_health(lobster_name)
        finally:
            conn.close()

    # ── 路由选择 ───────────────────────────────────────────────────

    def get_best_lobster(
        self,
        candidates: list[str],
        min_quality: float = 0.3,
    ) -> Optional[str]:
        """
        从候选龙虾中选择最优（对应 ClawTeam quality_score 路由）。
        过滤熔断龙虾 + 按 quality_score 降序。
        """
        scored: list[tuple[float, str]] = []
        for name in candidates:
            h = self.get_health(name)
            if not h.is_accepting_tasks:
                continue
            if h.quality_score < min_quality:
                continue
            scored.append((h.quality_score, name))
        if not scored:
            return None
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]

    def get_all_health(self) -> list[LobsterHealth]:
        """获取所有龙虾健康状态列表（Dashboard 用）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM lobster_health ORDER BY quality_score DESC"
            ).fetchall()
            return [LobsterHealth(dict(r)) for r in rows]
        finally:
            conn.close()

    def get_accepting_lobsters(
        self,
        lobster_names: Optional[list[str]] = None,
    ) -> list[LobsterHealth]:
        """获取所有可接单的龙虾（过滤 open 状态）"""
        if lobster_names:
            all_health = [self.get_health(n) for n in lobster_names]
        else:
            all_health = self.get_all_health()
        return [h for h in all_health if h.is_accepting_tasks]

    # ── 统计摘要 ───────────────────────────────────────────────────

    def get_summary(self) -> dict[str, Any]:
        """健康状态摘要（供 Dashboard）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT state, COUNT(*) as cnt, AVG(quality_score) as avg_score "
                "FROM lobster_health GROUP BY state"
            ).fetchall()
            by_state = {r["state"]: {"count": r["cnt"], "avg_score": round(r["avg_score"], 3)}
                        for r in rows}
            total = sum(v["count"] for v in by_state.values())
            open_count = by_state.get("open", {}).get("count", 0)
            return {
                "total_lobsters": total,
                "healthy": by_state.get("healthy", {}).get("count", 0),
                "degraded": by_state.get("degraded", {}).get("count", 0),
                "open": open_count,
                "circuit_breaker_triggered": open_count > 0,
                "by_state": by_state,
            }
        finally:
            conn.close()

    # ── 事件日志 ──────────────────────────────────────────────────

    def _log_event(
        self,
        conn: sqlite3.Connection,
        lobster_name: str,
        event_type: str,
        old_state: str,
        new_state: str,
        quality_score: float,
        detail: str = "",
    ) -> None:
        conn.execute(
            """INSERT INTO health_events
               (event_id, lobster_name, event_type, old_state, new_state,
                quality_score, detail, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (f"he_{uuid.uuid4().hex[:8]}", lobster_name, event_type,
             old_state, new_state, round(quality_score, 4), detail, self._now())
        )

    def get_events(self, lobster_name: str, limit: int = 50) -> list[dict]:
        """查询龙虾健康事件历史"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM health_events WHERE lobster_name=? ORDER BY created_at DESC LIMIT ?",
                (lobster_name, limit)
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


# ─────────────────────────────────────────────────────────────────
# FastAPI 路由（供 observability_api.py include）
# ─────────────────────────────────────────────────────────────────

def make_circuit_breaker_router():
    """创建 FastAPI Router，供 app.include_router() 使用"""
    try:
        from fastapi import APIRouter, HTTPException
        from pydantic import BaseModel
    except ImportError:
        return None

    router = APIRouter(prefix="/api/circuit-breaker", tags=["CircuitBreaker"])
    cb = LobsterCircuitBreaker()

    @router.get("/summary")
    def get_summary():
        return cb.get_summary()

    @router.get("/lobsters")
    def list_health():
        return [h.to_dict() for h in cb.get_all_health()]

    @router.get("/lobsters/{lobster_name}")
    def get_lobster_health(lobster_name: str):
        return cb.get_health(lobster_name).to_dict()

    @router.get("/lobsters/{lobster_name}/events")
    def get_events(lobster_name: str, limit: int = 50):
        return cb.get_events(lobster_name, limit=limit)

    class ReportBody(BaseModel):
        detail: str = ""

    @router.post("/lobsters/{lobster_name}/success")
    def report_success(lobster_name: str, body: ReportBody = ReportBody()):
        return cb.report_success(lobster_name, detail=body.detail).to_dict()

    @router.post("/lobsters/{lobster_name}/failure")
    def report_failure(lobster_name: str, body: ReportBody = ReportBody()):
        return cb.report_failure(lobster_name, error=body.detail).to_dict()

    @router.post("/lobsters/{lobster_name}/reset")
    def reset_lobster(lobster_name: str):
        return cb.reset(lobster_name).to_dict()

    @router.post("/lobsters/{lobster_name}/force-open")
    def force_open(lobster_name: str, body: ReportBody = ReportBody()):
        return cb.force_open(lobster_name, reason=body.detail).to_dict()

    @router.get("/best")
    def best_lobster(candidates: str = ""):
        names = [n.strip() for n in candidates.split(",") if n.strip()]
        if not names:
            raise HTTPException(400, "candidates 参数不能为空")
        best = cb.get_best_lobster(names)
        return {"best": best, "candidates": names}

    return router


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_cb: Optional[LobsterCircuitBreaker] = None

def get_circuit_breaker() -> LobsterCircuitBreaker:
    global _default_cb
    if _default_cb is None:
        _default_cb = LobsterCircuitBreaker()
    return _default_cb
