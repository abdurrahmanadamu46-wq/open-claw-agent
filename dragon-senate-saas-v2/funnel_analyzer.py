"""
Lobster workflow funnel analyzer inspired by PostHog funnels.
"""

from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from workflow_event_log import WorkflowEventType, get_workflow_event_log

DB_PATH = Path(os.getenv("FUNNEL_ANALYZER_DB", "./data/funnel_analyzer.sqlite"))
DEFAULT_STEPS = [
    ("signal_collected", "信号采集", "radar"),
    ("strategy_generated", "策略生成", "strategist"),
    ("content_generated", "内容生成", "inkwriter"),
    ("delivered", "投放触达", "dispatcher"),
    ("lead_captured", "线索识别", "catcher"),
    ("followup_triggered", "跟进触发", "followup"),
    ("converted", "转化完成", "abacus"),
]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_date(value: str | None) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text).astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


@dataclass(slots=True)
class FunnelStep:
    step_key: str
    step_name: str
    lobster_id: str
    count: int
    drop_off: int

    @property
    def conversion_rate(self) -> float:
        total = self.count + self.drop_off
        return self.count / total if total > 0 else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_key": self.step_key,
            "step_name": self.step_name,
            "lobster_id": self.lobster_id,
            "count": self.count,
            "drop_off": self.drop_off,
            "conversion_rate": round(self.conversion_rate, 4),
        }


class FunnelAnalyzer:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS funnel_runs (
                    run_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    industry_tag TEXT DEFAULT '',
                    channel_hint TEXT DEFAULT '',
                    stage_flags_json TEXT NOT NULL DEFAULT '{}',
                    lead_count INTEGER DEFAULT 0,
                    score REAL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_funnel_runs_tenant ON funnel_runs(tenant_id, created_at DESC);
                """
            )
            conn.commit()

    def record_run(
        self,
        *,
        run_id: str,
        tenant_id: str,
        stage_flags: dict[str, bool],
        industry_tag: str = "",
        channel_hint: str = "",
        lead_count: int = 0,
        score: float = 0.0,
    ) -> dict[str, Any]:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO funnel_runs(run_id, tenant_id, industry_tag, channel_hint, stage_flags_json, lead_count, score, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    industry_tag=excluded.industry_tag,
                    channel_hint=excluded.channel_hint,
                    stage_flags_json=excluded.stage_flags_json,
                    lead_count=excluded.lead_count,
                    score=excluded.score
                """,
                (
                    run_id,
                    tenant_id,
                    industry_tag,
                    channel_hint,
                    json.dumps(stage_flags, ensure_ascii=False),
                    int(lead_count or 0),
                    float(score or 0.0),
                    _utc_now(),
                ),
            )
            conn.commit()
        return {"run_id": run_id, "stages": stage_flags}

    def build_funnel(
        self,
        *,
        tenant_id: str,
        start: str | None = None,
        end: str | None = None,
    ) -> dict[str, Any]:
        stage_counts = {key: 0 for key, _, _ in DEFAULT_STEPS}
        runs = self._load_runs(tenant_id=tenant_id, start=start, end=end)
        for run in runs:
            flags = run["stage_flags"]
            for key in stage_counts:
                if bool(flags.get(key)):
                    stage_counts[key] += 1
        prev = None
        steps = []
        for key, name, lobster_id in DEFAULT_STEPS:
            count = stage_counts[key]
            drop = max((prev or 0) - count, 0) if prev is not None else 0
            steps.append(FunnelStep(key, name, lobster_id, count=count, drop_off=drop).to_dict())
            prev = count
        return {
            "tenant_id": tenant_id,
            "run_count": len(runs),
            "steps": steps,
            "runs": runs[:50],
        }

    def build_from_workflow_events(self, *, tenant_id: str, limit: int = 100) -> dict[str, Any]:
        runs = get_workflow_event_log().list_runs(tenant_id=tenant_id, limit=limit)
        mapped_runs = []
        for run in runs:
            run_id = str(run.get("run_id") or "")
            timeline = get_workflow_event_log().get_timeline(run_id)
            stage_flags = {
                "signal_collected": any(str(item.get("step_name") or "") == "radar" and str(item.get("event_type") or "") == WorkflowEventType.step_completed.value for item in timeline),
                "strategy_generated": any(str(item.get("step_name") or "") == "strategist" and str(item.get("event_type") or "") == WorkflowEventType.step_completed.value for item in timeline),
                "content_generated": any(str(item.get("step_name") or "") == "inkwriter" and str(item.get("event_type") or "") == WorkflowEventType.step_completed.value for item in timeline),
                "delivered": any(str(item.get("step_name") or "") == "dispatcher" and str(item.get("event_type") or "") == WorkflowEventType.step_completed.value for item in timeline),
                "lead_captured": any(str(item.get("step_name") or "") == "catcher" and str(item.get("event_type") or "") == WorkflowEventType.step_completed.value for item in timeline),
                "followup_triggered": any(str(item.get("step_name") or "") == "followup" and str(item.get("event_type") or "") == WorkflowEventType.step_completed.value for item in timeline),
                "converted": bool(any(str(item.get("status") or "") == "completed" for item in timeline)),
            }
            mapped_runs.append({"run_id": run_id, "stage_flags": stage_flags})
        return mapped_runs

    def _load_runs(self, *, tenant_id: str, start: str | None, end: str | None) -> list[dict[str, Any]]:
        start_dt = _normalize_date(start)
        end_dt = _normalize_date(end)
        query = "SELECT * FROM funnel_runs WHERE tenant_id=?"
        params: list[Any] = [tenant_id]
        if start_dt:
            query += " AND created_at >= ?"
            params.append(start_dt)
        if end_dt:
            query += " AND created_at <= ?"
            params.append(end_dt)
        query += " ORDER BY created_at DESC LIMIT 500"
        with self._conn() as conn:
            rows = conn.execute(query, params).fetchall()
        result = []
        for row in rows:
            result.append(
                {
                    "run_id": str(row["run_id"]),
                    "industry_tag": str(row["industry_tag"] or ""),
                    "channel_hint": str(row["channel_hint"] or ""),
                    "lead_count": int(row["lead_count"] or 0),
                    "score": float(row["score"] or 0.0),
                    "created_at": str(row["created_at"] or ""),
                    "stage_flags": json.loads(str(row["stage_flags_json"] or "{}")),
                }
            )
        return result


_funnel_analyzer: FunnelAnalyzer | None = None


def get_funnel_analyzer() -> FunnelAnalyzer:
    global _funnel_analyzer
    if _funnel_analyzer is None:
        _funnel_analyzer = FunnelAnalyzer()
    return _funnel_analyzer
