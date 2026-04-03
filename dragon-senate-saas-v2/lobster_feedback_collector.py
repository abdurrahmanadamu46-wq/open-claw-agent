"""
Human feedback collection for lobster outputs.
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from dataset_store import get_dataset_store

DB_PATH = Path(os.getenv("LOBSTER_FEEDBACK_DB", "./data/lobster_feedback.sqlite"))


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class LobsterFeedback:
    task_id: str
    lobster_id: str
    tenant_id: str
    user_id: str
    rating: str
    tags: list[str] = field(default_factory=list)
    comment: str = ""
    revised_output: str = ""
    input_prompt: str = ""
    original_output: str = ""
    feedback_id: str = field(default_factory=lambda: f"fb_{uuid.uuid4().hex[:12]}")
    created_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class LobsterFeedbackCollector:
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
                CREATE TABLE IF NOT EXISTS lobster_feedbacks (
                    feedback_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    rating TEXT NOT NULL,
                    tags_json TEXT DEFAULT '[]',
                    comment TEXT DEFAULT '',
                    revised_output TEXT DEFAULT '',
                    input_prompt TEXT DEFAULT '',
                    original_output TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_feedback_task ON lobster_feedbacks(task_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_feedback_lobster ON lobster_feedbacks(lobster_id, tenant_id, created_at DESC);
                """
            )
            conn.commit()

    async def submit(self, feedback: LobsterFeedback) -> dict[str, Any]:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO lobster_feedbacks(
                    feedback_id, task_id, lobster_id, tenant_id, user_id, rating,
                    tags_json, comment, revised_output, input_prompt, original_output, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    feedback.feedback_id,
                    feedback.task_id,
                    feedback.lobster_id,
                    feedback.tenant_id,
                    feedback.user_id,
                    feedback.rating,
                    json.dumps(feedback.tags, ensure_ascii=False),
                    feedback.comment,
                    feedback.revised_output,
                    feedback.input_prompt,
                    feedback.original_output,
                    feedback.created_at,
                ),
            )
            conn.commit()
        if str(feedback.revised_output or "").strip():
            self._push_to_dataset(feedback)
        return {"feedback_id": feedback.feedback_id, "status": "accepted"}

    def list_for_task(self, task_id: str, tenant_id: str) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT * FROM lobster_feedbacks
                WHERE task_id=? AND tenant_id=?
                ORDER BY created_at DESC
                """,
                (task_id, tenant_id),
            ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def quality_stats(self, lobster_id: str, tenant_id: str, days: int = 30) -> dict[str, Any]:
        safe_days = max(1, min(int(days), 365))
        threshold = (datetime.now(timezone.utc) - timedelta(days=safe_days)).isoformat()
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT rating, tags_json, created_at
                FROM lobster_feedbacks
                WHERE lobster_id=? AND tenant_id=? AND created_at >= ?
                ORDER BY created_at DESC
                """,
                (lobster_id, tenant_id, threshold),
            ).fetchall()
        thumbs_up = 0
        thumbs_down = 0
        stars: list[int] = []
        tag_counts: dict[str, int] = {}
        timeline: list[dict[str, Any]] = []
        for row in rows:
            rating = str(row["rating"] or "")
            if rating == "thumbs_up":
                thumbs_up += 1
            elif rating == "thumbs_down":
                thumbs_down += 1
            elif rating.startswith("star_"):
                try:
                    stars.append(int(rating.split("_", 1)[1]))
                except Exception:
                    pass
            try:
                tags = json.loads(str(row["tags_json"] or "[]"))
            except Exception:
                tags = []
            for tag in tags if isinstance(tags, list) else []:
                normalized = str(tag).strip()
                if normalized:
                    tag_counts[normalized] = tag_counts.get(normalized, 0) + 1
            timeline.append({"created_at": str(row["created_at"] or ""), "rating": rating})
        top_tags = sorted(tag_counts.items(), key=lambda item: (-item[1], item[0]))[:5]
        return {
            "lobster_id": lobster_id,
            "tenant_id": tenant_id,
            "days": safe_days,
            "total_feedbacks": len(rows),
            "thumbs_up": thumbs_up,
            "thumbs_down": thumbs_down,
            "satisfaction_rate": round((thumbs_up / max(1, thumbs_up + thumbs_down)) * 100, 1) if (thumbs_up + thumbs_down) else None,
            "avg_star": round(sum(stars) / len(stars), 2) if stars else None,
            "top_tags": [{"tag": tag, "count": count} for tag, count in top_tags],
            "timeline": timeline[:60],
        }

    def export_dataset(self, lobster_id: str, tenant_id: str, limit: int = 200) -> dict[str, Any]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT * FROM lobster_feedbacks
                WHERE lobster_id=? AND tenant_id=? AND revised_output != ''
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (lobster_id, tenant_id, max(1, min(int(limit), 1000))),
            ).fetchall()
        items = [self._row_to_dict(row) for row in rows]
        return {"lobster_id": lobster_id, "tenant_id": tenant_id, "count": len(items), "items": items}

    def _push_to_dataset(self, feedback: LobsterFeedback) -> None:
        dataset_name = f"lobster_{feedback.lobster_id}_golden"
        store = get_dataset_store()
        store.create_dataset(
            dataset_name,
            description=f"Human revised golden set for {feedback.lobster_id}",
            lobster=feedback.lobster_id,
            tenant_id=feedback.tenant_id,
        )
        store.add_item(
            dataset_name=dataset_name,
            input={"task_id": feedback.task_id, "prompt": feedback.input_prompt},
            expected_output=feedback.revised_output,
            tags=list(feedback.tags),
            metadata={
                "original_output": feedback.original_output,
                "rating": feedback.rating,
                "comment": feedback.comment,
                "feedback_id": feedback.feedback_id,
            },
            source_gen_id=feedback.task_id,
            quality_score=self._quality_score(feedback.rating),
        )

    @staticmethod
    def _quality_score(rating: str) -> float:
        if rating == "thumbs_up":
            return 0.9
        if rating == "thumbs_down":
            return 0.2
        if rating.startswith("star_"):
            try:
                return max(0.0, min(int(rating.split("_", 1)[1]), 5) / 5.0)
            except Exception:
                return 0.5
        return 0.5

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        try:
            item["tags"] = json.loads(str(item.pop("tags_json", "[]")))
        except Exception:
            item["tags"] = []
        return item


_feedback_collector: LobsterFeedbackCollector | None = None


def get_lobster_feedback_collector() -> LobsterFeedbackCollector:
    global _feedback_collector
    if _feedback_collector is None:
        _feedback_collector = LobsterFeedbackCollector()
    return _feedback_collector
