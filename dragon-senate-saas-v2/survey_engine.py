"""
Survey engine inspired by PostHog surveys.
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

DB_PATH = Path(os.getenv("SURVEY_ENGINE_DB", "./data/survey_engine.sqlite"))


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SurveyType(str, Enum):
    NPS = "nps"
    CSAT = "csat"
    OPEN = "open"


@dataclass(slots=True)
class Survey:
    survey_id: str
    title: str
    survey_type: SurveyType
    trigger_event: str
    trigger_conditions: dict[str, Any] = field(default_factory=dict)
    questions: list[dict[str, Any]] = field(default_factory=list)
    enabled: bool = True

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["survey_type"] = self.survey_type.value
        return payload


@dataclass(slots=True)
class SurveyResponse:
    survey_id: str
    tenant_id: str
    respondent_id: str
    answers: dict[str, Any]
    lobster_task_id: str | None = None
    score: float | None = None
    response_id: str = field(default_factory=lambda: f"sr_{uuid.uuid4().hex[:12]}")
    created_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class SurveyEngine:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()
        self._seed_defaults()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS surveys (
                    survey_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    survey_type TEXT NOT NULL,
                    trigger_event TEXT NOT NULL,
                    trigger_conditions_json TEXT NOT NULL DEFAULT '{}',
                    questions_json TEXT NOT NULL DEFAULT '[]',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS survey_responses (
                    response_id TEXT PRIMARY KEY,
                    survey_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    respondent_id TEXT NOT NULL,
                    answers_json TEXT NOT NULL DEFAULT '{}',
                    lobster_task_id TEXT DEFAULT '',
                    score REAL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_survey_response_survey ON survey_responses(survey_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_survey_response_tenant ON survey_responses(tenant_id, created_at DESC);
                """
            )
            conn.commit()

    def _seed_defaults(self) -> None:
        defaults = [
            Survey(
                survey_id="survey_lobster_csat",
                title="这次龙虾产出有帮助吗？",
                survey_type=SurveyType.CSAT,
                trigger_event="lobster_task_completed",
                questions=[{"id": "csat", "type": "rating", "min": 1, "max": 5}],
            ),
            Survey(
                survey_id="survey_followup_csat",
                title="这次跟进消息是否合适？",
                survey_type=SurveyType.CSAT,
                trigger_event="followup_sent",
                questions=[{"id": "csat", "type": "rating", "min": 1, "max": 5}],
            ),
            Survey(
                survey_id="survey_platform_nps",
                title="你愿意把龙虾池推荐给同行吗？",
                survey_type=SurveyType.NPS,
                trigger_event="monthly_active",
                questions=[{"id": "nps", "type": "rating", "min": 0, "max": 10}],
            ),
        ]
        with self._conn() as conn:
            for survey in defaults:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO surveys(
                        survey_id, title, survey_type, trigger_event, trigger_conditions_json, questions_json, enabled, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        survey.survey_id,
                        survey.title,
                        survey.survey_type.value,
                        survey.trigger_event,
                        json.dumps(survey.trigger_conditions, ensure_ascii=False),
                        json.dumps(survey.questions, ensure_ascii=False),
                        1 if survey.enabled else 0,
                        _utc_now(),
                    ),
                )
            conn.commit()

    def list_surveys(self) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM surveys ORDER BY created_at DESC").fetchall()
        return [self._row_to_survey(row).to_dict() for row in rows]

    def create_survey(self, payload: dict[str, Any]) -> dict[str, Any]:
        survey = Survey(
            survey_id=str(payload.get("survey_id") or f"survey_{uuid.uuid4().hex[:12]}"),
            title=str(payload.get("title") or "").strip(),
            survey_type=SurveyType(str(payload.get("survey_type") or SurveyType.OPEN.value)),
            trigger_event=str(payload.get("trigger_event") or "").strip(),
            trigger_conditions=dict(payload.get("trigger_conditions") or {}),
            questions=list(payload.get("questions") or []),
            enabled=bool(payload.get("enabled", True)),
        )
        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO surveys(
                    survey_id, title, survey_type, trigger_event, trigger_conditions_json, questions_json, enabled, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    survey.survey_id,
                    survey.title,
                    survey.survey_type.value,
                    survey.trigger_event,
                    json.dumps(survey.trigger_conditions, ensure_ascii=False),
                    json.dumps(survey.questions, ensure_ascii=False),
                    1 if survey.enabled else 0,
                    _utc_now(),
                ),
            )
            conn.commit()
        return survey.to_dict()

    def should_trigger(self, event: dict[str, Any], survey: Survey) -> bool:
        if not survey.enabled:
            return False
        if str(event.get("event_type") or "") != survey.trigger_event:
            return False
        for key, expected in survey.trigger_conditions.items():
            if event.get(key) != expected:
                return False
        return True

    def get_triggered_surveys(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        return [survey for survey in self.list_surveys() if self.should_trigger(event, SurveyEngine._dict_to_survey(survey))]

    async def record_response(self, response: SurveyResponse) -> dict[str, Any]:
        score = response.score
        if score is None and response.answers:
            first_value = next(iter(response.answers.values()))
            if isinstance(first_value, (int, float)):
                score = float(first_value)
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO survey_responses(response_id, survey_id, tenant_id, respondent_id, answers_json, lobster_task_id, score, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    response.response_id,
                    response.survey_id,
                    response.tenant_id,
                    response.respondent_id,
                    json.dumps(response.answers, ensure_ascii=False),
                    str(response.lobster_task_id or ""),
                    score,
                    response.created_at,
                ),
            )
            conn.commit()
        response.score = score
        return {"survey_id": response.survey_id, "response_id": response.response_id, "score": response.score}

    def get_results(self, survey_id: str, tenant_id: str = "") -> dict[str, Any]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM survey_responses WHERE survey_id=? AND (?='' OR tenant_id=?) ORDER BY created_at DESC",
                (survey_id, tenant_id, tenant_id),
            ).fetchall()
        scores = [float(row["score"]) for row in rows if row["score"] is not None]
        avg_score = round(sum(scores) / len(scores), 2) if scores else None
        nps = None
        if scores:
            promoters = len([score for score in scores if score >= 9])
            detractors = len([score for score in scores if score <= 6])
            total = len(scores)
            nps = round(((promoters / total) - (detractors / total)) * 100, 1)
        return {
            "survey_id": survey_id,
            "tenant_id": tenant_id,
            "response_count": len(rows),
            "avg_score": avg_score,
            "nps": nps,
            "items": [self._response_row_to_dict(row) for row in rows[:100]],
        }

    @staticmethod
    def _dict_to_survey(payload: dict[str, Any]) -> Survey:
        return Survey(
            survey_id=str(payload.get("survey_id") or ""),
            title=str(payload.get("title") or ""),
            survey_type=SurveyType(str(payload.get("survey_type") or SurveyType.OPEN.value)),
            trigger_event=str(payload.get("trigger_event") or ""),
            trigger_conditions=dict(payload.get("trigger_conditions") or {}),
            questions=list(payload.get("questions") or []),
            enabled=bool(payload.get("enabled", True)),
        )

    @staticmethod
    def _row_to_survey(row: sqlite3.Row) -> Survey:
        return Survey(
            survey_id=str(row["survey_id"]),
            title=str(row["title"]),
            survey_type=SurveyType(str(row["survey_type"])),
            trigger_event=str(row["trigger_event"]),
            trigger_conditions=json.loads(str(row["trigger_conditions_json"] or "{}")),
            questions=json.loads(str(row["questions_json"] or "[]")),
            enabled=bool(row["enabled"]),
        )

    @staticmethod
    def _response_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "response_id": str(row["response_id"]),
            "survey_id": str(row["survey_id"]),
            "tenant_id": str(row["tenant_id"]),
            "respondent_id": str(row["respondent_id"]),
            "answers": json.loads(str(row["answers_json"] or "{}")),
            "lobster_task_id": str(row["lobster_task_id"] or ""),
            "score": float(row["score"]) if row["score"] is not None else None,
            "created_at": str(row["created_at"] or ""),
        }


_survey_engine: SurveyEngine | None = None


def get_survey_engine() -> SurveyEngine:
    global _survey_engine
    if _survey_engine is None:
        _survey_engine = SurveyEngine()
    return _survey_engine
