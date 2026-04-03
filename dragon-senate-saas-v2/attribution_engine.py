"""
Marketing attribution engine inspired by PostHog marketing analytics.
"""

from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

DB_PATH = Path(os.getenv("ATTRIBUTION_ENGINE_DB", "./data/attribution_engine.sqlite"))


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


class AttributionModel(str, Enum):
    FIRST_TOUCH = "first_touch"
    LAST_TOUCH = "last_touch"
    LINEAR = "linear"
    U_SHAPE = "u_shape"


@dataclass(slots=True)
class AttributionTouchpoint:
    channel: str
    lobster_id: str
    value: float = 0.0
    timestamp: str = ""
    meta: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "channel": self.channel,
            "lobster_id": self.lobster_id,
            "value": self.value,
            "timestamp": self.timestamp or _utc_now(),
            "meta": dict(self.meta or {}),
        }


class AttributionEngine:
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
                CREATE TABLE IF NOT EXISTS attribution_runs (
                    run_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    conversion_value REAL DEFAULT 0,
                    industry_tag TEXT DEFAULT '',
                    meta_json TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS attribution_touchpoints (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    position_index INTEGER NOT NULL,
                    channel TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    touch_value REAL DEFAULT 0,
                    timestamp TEXT NOT NULL,
                    meta_json TEXT DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS idx_attr_run_tenant ON attribution_runs(tenant_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_attr_tp_tenant ON attribution_touchpoints(tenant_id, timestamp DESC);
                """
            )
            conn.commit()

    def record_run(
        self,
        *,
        run_id: str,
        tenant_id: str,
        touchpoints: list[AttributionTouchpoint],
        conversion_value: float,
        industry_tag: str = "",
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO attribution_runs(run_id, tenant_id, conversion_value, industry_tag, meta_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    conversion_value=excluded.conversion_value,
                    industry_tag=excluded.industry_tag,
                    meta_json=excluded.meta_json
                """,
                (
                    run_id,
                    tenant_id,
                    float(conversion_value or 0.0),
                    str(industry_tag or ""),
                    json.dumps(meta or {}, ensure_ascii=False),
                    _utc_now(),
                ),
            )
            conn.execute("DELETE FROM attribution_touchpoints WHERE run_id=?", (run_id,))
            for index, touchpoint in enumerate(touchpoints):
                row = touchpoint.to_dict()
                conn.execute(
                    """
                    INSERT INTO attribution_touchpoints(
                        run_id, tenant_id, position_index, channel, lobster_id, touch_value, timestamp, meta_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        tenant_id,
                        index,
                        str(row["channel"] or "unknown"),
                        str(row["lobster_id"] or "unknown"),
                        float(row.get("value") or 0.0),
                        str(row["timestamp"] or _utc_now()),
                        json.dumps(row.get("meta") or {}, ensure_ascii=False),
                    ),
                )
            conn.commit()
        return {"run_id": run_id, "touchpoint_count": len(touchpoints), "conversion_value": float(conversion_value or 0.0)}

    def attribute(
        self,
        *,
        tenant_id: str,
        model: AttributionModel = AttributionModel.U_SHAPE,
        start: str | None = None,
        end: str | None = None,
    ) -> dict[str, Any]:
        runs = self._load_runs(tenant_id=tenant_id, start=start, end=end)
        channel_rollup: dict[str, float] = {}
        lobster_rollup: dict[str, float] = {}
        run_summaries: list[dict[str, Any]] = []
        for run in runs:
            touchpoints = run["touchpoints"]
            weights = self._get_weights(len(touchpoints), model)
            weighted_points = []
            for index, touchpoint in enumerate(touchpoints):
                credit = float(run["conversion_value"]) * weights[index]
                channel_key = str(touchpoint["channel"] or "unknown")
                lobster_key = str(touchpoint["lobster_id"] or "unknown")
                channel_rollup[channel_key] = channel_rollup.get(channel_key, 0.0) + credit
                lobster_rollup[lobster_key] = lobster_rollup.get(lobster_key, 0.0) + credit
                weighted_points.append({**touchpoint, "weight": weights[index], "credit": round(credit, 4)})
            run_summaries.append(
                {
                    "run_id": run["run_id"],
                    "conversion_value": run["conversion_value"],
                    "touchpoints": weighted_points,
                    "industry_tag": run["industry_tag"],
                }
            )
        return {
            "tenant_id": tenant_id,
            "model": model.value,
            "run_count": len(runs),
            "channel_rollup": self._sorted_rollup(channel_rollup),
            "lobster_rollup": self._sorted_rollup(lobster_rollup),
            "runs": run_summaries[:50],
        }

    def _load_runs(self, *, tenant_id: str, start: str | None, end: str | None) -> list[dict[str, Any]]:
        start_dt = _normalize_date(start)
        end_dt = _normalize_date(end)
        query = "SELECT * FROM attribution_runs WHERE tenant_id=?"
        params: list[Any] = [tenant_id]
        if start_dt:
            query += " AND created_at >= ?"
            params.append(start_dt)
        if end_dt:
            query += " AND created_at <= ?"
            params.append(end_dt)
        query += " ORDER BY created_at DESC LIMIT 500"
        with self._conn() as conn:
            runs = conn.execute(query, params).fetchall()
            result: list[dict[str, Any]] = []
            for run in runs:
                touchpoints = conn.execute(
                    """
                    SELECT channel, lobster_id, touch_value, timestamp, meta_json
                    FROM attribution_touchpoints
                    WHERE run_id=?
                    ORDER BY position_index ASC
                    """,
                    (str(run["run_id"]),),
                ).fetchall()
                result.append(
                    {
                        "run_id": str(run["run_id"]),
                        "conversion_value": float(run["conversion_value"] or 0.0),
                        "industry_tag": str(run["industry_tag"] or ""),
                        "touchpoints": [
                            {
                                "channel": str(tp["channel"] or "unknown"),
                                "lobster_id": str(tp["lobster_id"] or "unknown"),
                                "value": float(tp["touch_value"] or 0.0),
                                "timestamp": str(tp["timestamp"] or ""),
                                "meta": json.loads(str(tp["meta_json"] or "{}")),
                            }
                            for tp in touchpoints
                        ],
                    }
                )
        return result

    @staticmethod
    def _get_weights(count: int, model: AttributionModel) -> list[float]:
        if count <= 0:
            return []
        if count == 1:
            return [1.0]
        if model == AttributionModel.FIRST_TOUCH:
            return [1.0] + [0.0] * (count - 1)
        if model == AttributionModel.LAST_TOUCH:
            return [0.0] * (count - 1) + [1.0]
        if model == AttributionModel.LINEAR:
            return [1.0 / count] * count
        if count == 2:
            return [0.5, 0.5]
        middle = [0.2 / (count - 2)] * (count - 2)
        return [0.4] + middle + [0.4]

    @staticmethod
    def _sorted_rollup(rollup: dict[str, float]) -> list[dict[str, Any]]:
        return [
            {"key": key, "credit": round(value, 4)}
            for key, value in sorted(rollup.items(), key=lambda item: (-item[1], item[0]))
        ]


_attribution_engine: AttributionEngine | None = None


def get_attribution_engine() -> AttributionEngine:
    global _attribution_engine
    if _attribution_engine is None:
        _attribution_engine = AttributionEngine()
    return _attribution_engine
