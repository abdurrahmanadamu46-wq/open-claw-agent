from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any


DEFAULT_LOBSTER_NAMES = {
    "commander": "陈指挥",
    "strategist": "苏思",
    "radar": "林涛",
    "inkwriter": "墨小雅",
    "visualizer": "影子",
    "dispatcher": "老坚",
    "echoer": "阿声",
    "catcher": "铁钩",
    "followup": "小锤",
    "abacus": "算无遗策",
}


class AgentWhiteLabelService:
    def __init__(self, db_path: str = "./data/agent_white_label.sqlite") -> None:
        self._db_path = Path(db_path)
        if not self._db_path.is_absolute():
            self._db_path = (Path(__file__).resolve().parent / self._db_path).resolve()
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
                CREATE TABLE IF NOT EXISTS agent_white_label_configs (
                    agent_id TEXT PRIMARY KEY,
                    seat_count INTEGER NOT NULL DEFAULT 0,
                    brand_name TEXT NOT NULL DEFAULT '',
                    logo_url TEXT NOT NULL DEFAULT '',
                    primary_color TEXT NOT NULL DEFAULT '#0ea5e9',
                    lobster_names_json TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL
                );
                """
            )
            conn.commit()

    @staticmethod
    def _now_iso() -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def get_brand_config(self, agent_id: str, *, seat_count: int = 0, fallback_brand: str = "Dragon Senate") -> dict[str, Any]:
        normalized = str(agent_id or "").strip()
        if not normalized:
            return {"white_label_enabled": False}
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM agent_white_label_configs WHERE agent_id = ?",
                (normalized,),
            ).fetchone()
        if row is None:
            enabled = int(seat_count or 0) >= 20
            return {
                "white_label_enabled": enabled,
                "brand_name": fallback_brand,
                "logo_url": "",
                "primary_color": "#0ea5e9",
                "lobster_names": dict(DEFAULT_LOBSTER_NAMES),
                "updated_at": None,
            }
        payload = dict(row)
        enabled = int(payload.get("seat_count") or seat_count or 0) >= 20
        names = json.loads(str(payload.get("lobster_names_json") or "{}"))
        merged_names = {**DEFAULT_LOBSTER_NAMES, **(names if isinstance(names, dict) else {})}
        return {
            "white_label_enabled": enabled,
            "brand_name": str(payload.get("brand_name") or fallback_brand),
            "logo_url": str(payload.get("logo_url") or ""),
            "primary_color": str(payload.get("primary_color") or "#0ea5e9"),
            "lobster_names": merged_names,
            "updated_at": str(payload.get("updated_at") or ""),
        }

    def save_brand_config(
        self,
        agent_id: str,
        *,
        seat_count: int,
        brand_name: str,
        logo_url: str = "",
        primary_color: str = "#0ea5e9",
        lobster_names: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        if int(seat_count or 0) < 20:
            raise ValueError("white_label_requires_20_seats")
        normalized = str(agent_id or "").strip()
        if not normalized:
            raise ValueError("agent_id is required")
        merged_names = {**DEFAULT_LOBSTER_NAMES, **dict(lobster_names or {})}
        updated_at = self._now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO agent_white_label_configs(agent_id, seat_count, brand_name, logo_url, primary_color, lobster_names_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(agent_id) DO UPDATE SET
                    seat_count = excluded.seat_count,
                    brand_name = excluded.brand_name,
                    logo_url = excluded.logo_url,
                    primary_color = excluded.primary_color,
                    lobster_names_json = excluded.lobster_names_json,
                    updated_at = excluded.updated_at
                """,
                (
                    normalized,
                    int(seat_count or 0),
                    str(brand_name or "").strip() or "Dragon Senate",
                    str(logo_url or "").strip(),
                    str(primary_color or "#0ea5e9").strip() or "#0ea5e9",
                    json.dumps(merged_names, ensure_ascii=False),
                    updated_at,
                ),
            )
            conn.commit()
        return self.get_brand_config(normalized, seat_count=seat_count, fallback_brand=brand_name)


_service: AgentWhiteLabelService | None = None


def get_agent_white_label_service() -> AgentWhiteLabelService:
    global _service
    if _service is None:
        _service = AgentWhiteLabelService()
    return _service
