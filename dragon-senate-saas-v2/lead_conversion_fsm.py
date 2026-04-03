"""
Lead conversion funnel state machine inspired by ZeroLeaks LeakStatus.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

DB_PATH = (Path(__file__).resolve().parent / "data" / "lead_conversion_fsm.sqlite").resolve()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ConversionStatus(str, Enum):
    UNKNOWN = "unknown"
    AWARE = "aware"
    INTERESTED = "interested"
    CONSIDERING = "considering"
    DECIDED = "decided"
    CONVERTED = "converted"
    LOST = "lost"


VALID_TRANSITIONS: dict[ConversionStatus, set[ConversionStatus]] = {
    ConversionStatus.UNKNOWN: {ConversionStatus.AWARE, ConversionStatus.LOST},
    ConversionStatus.AWARE: {ConversionStatus.INTERESTED, ConversionStatus.LOST},
    ConversionStatus.INTERESTED: {ConversionStatus.CONSIDERING, ConversionStatus.LOST},
    ConversionStatus.CONSIDERING: {ConversionStatus.DECIDED, ConversionStatus.INTERESTED, ConversionStatus.LOST},
    ConversionStatus.DECIDED: {ConversionStatus.CONVERTED, ConversionStatus.LOST},
    ConversionStatus.CONVERTED: set(),
    ConversionStatus.LOST: set(),
}


@dataclass(slots=True)
class StatusTransition:
    lead_id: str
    from_status: str
    to_status: str
    trigger: str
    confidence: float
    triggered_by: str
    evidence: str = ""
    transitioned_at: str = _utc_now()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class LeadConversionFSM:
    def __init__(self, db_path: Path | None = None) -> None:
        self._db_path = db_path or DB_PATH
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
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
                CREATE TABLE IF NOT EXISTS lead_conversion_state (
                    tenant_id TEXT NOT NULL,
                    lead_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    confidence REAL NOT NULL DEFAULT 0,
                    trigger TEXT NOT NULL DEFAULT '',
                    triggered_by TEXT NOT NULL DEFAULT '',
                    evidence TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, lead_id)
                );
                CREATE TABLE IF NOT EXISTS lead_conversion_history (
                    transition_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    lead_id TEXT NOT NULL,
                    from_status TEXT NOT NULL,
                    to_status TEXT NOT NULL,
                    trigger TEXT NOT NULL,
                    confidence REAL NOT NULL DEFAULT 0,
                    triggered_by TEXT NOT NULL DEFAULT '',
                    evidence TEXT NOT NULL DEFAULT '',
                    transitioned_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_lead_conversion_history_lookup
                    ON lead_conversion_history(tenant_id, lead_id, transitioned_at DESC);
                """
            )
            conn.commit()

    def get_status(self, tenant_id: str, lead_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM lead_conversion_state WHERE tenant_id = ? AND lead_id = ?",
                (tenant_id, lead_id),
            ).fetchone()
        if row is None:
            return {
                "tenant_id": tenant_id,
                "lead_id": lead_id,
                "status": ConversionStatus.UNKNOWN.value,
                "confidence": 0.0,
                "trigger": "",
                "triggered_by": "",
                "evidence": "",
                "updated_at": "",
            }
        return dict(row)

    def list_history(self, tenant_id: str, lead_id: str, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM lead_conversion_history
                WHERE tenant_id = ? AND lead_id = ?
                ORDER BY transitioned_at DESC
                LIMIT ?
                """,
                (tenant_id, lead_id, max(1, int(limit))),
            ).fetchall()
        return [dict(row) for row in rows]

    def can_transition(self, current: ConversionStatus, target: ConversionStatus) -> bool:
        return target in VALID_TRANSITIONS.get(current, set())

    def infer_target_status(
        self,
        *,
        lead: dict[str, Any],
        followup_spawn: dict[str, Any] | None = None,
    ) -> tuple[ConversionStatus, float, str]:
        score = float(lead.get("score", 0.0) or 0.0)
        intent = str(lead.get("intent") or "").strip().lower()
        grade = str(lead.get("grade") or "").strip().upper()
        text_blob = " ".join(
            str(lead.get(key) or "")
            for key in ("status", "text", "reply", "note", "summary", "evidence")
        ).lower()

        if any(token in text_blob for token in ("拒绝", "不需要", "别联系", "拉黑", "unsubscribe", "stop")):
            return ConversionStatus.LOST, 0.95, "explicit_rejection"
        if any(token in text_blob for token in ("成交", "付款", "签约", "已转化", "registered", "converted")):
            return ConversionStatus.CONVERTED, 0.97, "explicit_conversion"
        if grade == "A" or score >= 0.9:
            return ConversionStatus.DECIDED, 0.88, "high_score_or_grade_a"
        if followup_spawn:
            return ConversionStatus.CONSIDERING, 0.76, "followup_sequence_started"
        if intent in {"warm", "hot"} or score >= 0.7 or any(token in text_blob for token in ("报价", "demo", "试用", "资料")):
            return ConversionStatus.INTERESTED, 0.72, "engagement_detected"
        if any(token in text_blob for token in ("已读", "打开", "浏览", "看到", "aware")) or score > 0:
            return ConversionStatus.AWARE, 0.55, "awareness_detected"
        return ConversionStatus.UNKNOWN, 0.3, "no_signal"

    def transition(
        self,
        *,
        tenant_id: str,
        lead_id: str,
        target_status: ConversionStatus,
        trigger: str,
        confidence: float,
        triggered_by: str,
        evidence: str = "",
        allow_terminal_override: bool = False,
    ) -> StatusTransition | None:
        state = self.get_status(tenant_id, lead_id)
        current = ConversionStatus(str(state.get("status") or ConversionStatus.UNKNOWN.value))
        if current == target_status:
            return None
        if current in {ConversionStatus.CONVERTED, ConversionStatus.LOST} and not allow_terminal_override:
            return None
        if not self.can_transition(current, target_status) and not allow_terminal_override:
            return None
        if float(confidence) < 0.6:
            return None

        transition = StatusTransition(
            lead_id=lead_id,
            from_status=current.value,
            to_status=target_status.value,
            trigger=trigger,
            confidence=max(0.0, min(float(confidence), 1.0)),
            triggered_by=triggered_by,
            evidence=evidence[:300],
            transitioned_at=_utc_now(),
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO lead_conversion_state(tenant_id, lead_id, status, confidence, trigger, triggered_by, evidence, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, lead_id) DO UPDATE SET
                    status=excluded.status,
                    confidence=excluded.confidence,
                    trigger=excluded.trigger,
                    triggered_by=excluded.triggered_by,
                    evidence=excluded.evidence,
                    updated_at=excluded.updated_at
                """,
                (
                    tenant_id,
                    lead_id,
                    transition.to_status,
                    transition.confidence,
                    transition.trigger,
                    transition.triggered_by,
                    transition.evidence,
                    transition.transitioned_at,
                ),
            )
            conn.execute(
                """
                INSERT INTO lead_conversion_history(
                    transition_id, tenant_id, lead_id, from_status, to_status,
                    trigger, confidence, triggered_by, evidence, transitioned_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"tr_{uuid.uuid4().hex[:16]}",
                    tenant_id,
                    lead_id,
                    transition.from_status,
                    transition.to_status,
                    transition.trigger,
                    transition.confidence,
                    transition.triggered_by,
                    transition.evidence,
                    transition.transitioned_at,
                ),
            )
            conn.commit()
        return transition


_fsm: LeadConversionFSM | None = None


def get_lead_conversion_fsm() -> LeadConversionFSM:
    global _fsm
    if _fsm is None:
        _fsm = LeadConversionFSM()
    return _fsm
