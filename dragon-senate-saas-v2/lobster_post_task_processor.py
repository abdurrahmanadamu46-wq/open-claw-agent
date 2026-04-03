"""
Background post-task processing inspired by Open WebUI tasks.py.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from im_media_pipeline import extract_media_refs_from_output
from im_media_pipeline import send_media_to_channel
from lobsters.lobster_memory import LobsterMemory

DB_PATH = Path(os.getenv("LOBSTER_POST_TASK_DB", "./data/lobster_post_task.sqlite"))


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PostTaskAction(str, Enum):
    AUTO_TAG = "auto_tag"
    AUTO_ARCHIVE = "auto_archive"
    AUTO_SUMMARIZE = "auto_summarize"
    WRITE_MEMORY = "write_memory"


@dataclass(slots=True)
class PostTaskRecord:
    task_id: str
    tenant_id: str
    lobster_id: str
    summary: str = ""
    tags: list[str] = field(default_factory=list)
    archived: bool = False
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class LobsterPostTaskProcessor:
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
                CREATE TABLE IF NOT EXISTS lobster_post_tasks (
                    task_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    summary TEXT DEFAULT '',
                    tags_json TEXT DEFAULT '[]',
                    archived INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            conn.commit()

    async def process(
        self,
        *,
        task_id: str,
        tenant_id: str,
        lobster_id: str,
        prompt: str,
        output: str,
        actions: list[PostTaskAction] | None = None,
        industry_tag: str | None = None,
        enable_output_validation: bool = False,
        auto_retry_on_violation: bool = False,
        reply_channel_id: str | None = None,
        reply_chat_id: str | None = None,
    ) -> dict[str, Any]:
        active = actions or list(PostTaskAction)
        tags = self._auto_tag(prompt, output) if PostTaskAction.AUTO_TAG in active else []
        summary = self._auto_summarize(output) if PostTaskAction.AUTO_SUMMARIZE in active else ""
        archived = PostTaskAction.AUTO_ARCHIVE in active
        if PostTaskAction.WRITE_MEMORY in active and output.strip():
            await LobsterMemory(lobster_id, tenant_id).remember(
                "knowledge",
                f"post_task_{task_id}",
                summary or output[:800],
                metadata={"task_id": task_id, "tags": tags, "source": "post_task_processor"},
            )
        record = PostTaskRecord(
            task_id=task_id,
            tenant_id=tenant_id,
            lobster_id=lobster_id,
            summary=summary,
            tags=tags,
            archived=archived,
        )
        self._upsert(record)
        payload = record.to_dict()
        if enable_output_validation and str(industry_tag or "").strip():
            try:
                from lobster_output_validator import get_lobster_output_validator

                validation = await get_lobster_output_validator().validate(
                    lobster_id=lobster_id,
                    output=output,
                    industry_tag=str(industry_tag),
                )
                payload["validation"] = validation.to_dict()
                payload["auto_retry_on_violation"] = bool(auto_retry_on_violation)
                if not validation.passed and auto_retry_on_violation:
                    payload["retry_prompt_suffix"] = (
                        "\n\n[输出验证失败，请修正后重试]\n"
                        + "\n".join(f"- {item}" for item in validation.violations)
                    )
            except Exception as exc:  # noqa: BLE001
                payload["validation"] = {
                    "passed": True,
                    "violations": [],
                    "confidence": 0.0,
                    "validator": f"validation_skipped:{exc}",
                }
        if str(reply_channel_id or "").strip() and str(output or "").strip():
            refs = extract_media_refs_from_output(output)
            sent_media: list[dict[str, Any]] = []
            for ref in refs:
                ok = await send_media_to_channel(
                    str(reply_channel_id),
                    ref,
                    caption=summary,
                    chat_id=str(reply_chat_id or ""),
                )
                sent_media.append({"path": ref, "ok": ok})
            payload["outbound_media"] = sent_media
        return payload

    def get(self, task_id: str) -> dict[str, Any]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM lobster_post_tasks WHERE task_id=?", (task_id,)).fetchone()
        if row is None:
            return {}
        item = dict(row)
        item["tags"] = json.loads(str(item.pop("tags_json", "[]")))
        return item

    def list_recent(self, tenant_id: str, limit: int = 50) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM lobster_post_tasks WHERE tenant_id=? ORDER BY updated_at DESC LIMIT ?",
                (tenant_id, max(1, min(int(limit), 500))),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["tags"] = json.loads(str(item.pop("tags_json", "[]")))
            result.append(item)
        return result

    def _upsert(self, record: PostTaskRecord) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO lobster_post_tasks(task_id, tenant_id, lobster_id, summary, tags_json, archived, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    summary=excluded.summary,
                    tags_json=excluded.tags_json,
                    archived=excluded.archived,
                    updated_at=excluded.updated_at
                """,
                (
                    record.task_id,
                    record.tenant_id,
                    record.lobster_id,
                    record.summary,
                    json.dumps(record.tags, ensure_ascii=False),
                    1 if record.archived else 0,
                    record.created_at,
                    record.updated_at,
                ),
            )
            conn.commit()

    @staticmethod
    def _auto_tag(prompt: str, output: str) -> list[str]:
        source = f"{prompt}\n{output}".lower()
        rules = {
            "strategy": ("策略", "plan", "experiment", "campaign"),
            "competitor": ("竞品", "competitor", "benchmark"),
            "copywriting": ("文案", "标题", "hook", "script", "copy"),
            "lead": ("线索", "crm", "followup", "lead"),
            "report": ("roi", "分析", "report", "指标"),
        }
        hits = [tag for tag, keywords in rules.items() if any(keyword.lower() in source for keyword in keywords)]
        if not hits:
            digest = hashlib.sha1(source.encode("utf-8")).hexdigest()[:6]
            return [f"task-{digest}"]
        return hits[:5]

    @staticmethod
    def _auto_summarize(output: str) -> str:
        text = re.sub(r"\s+", " ", str(output or "").strip())
        return text[:30] if len(text) > 30 else text


_post_task_processor: LobsterPostTaskProcessor | None = None


def get_lobster_post_task_processor() -> LobsterPostTaskProcessor:
    global _post_task_processor
    if _post_task_processor is None:
        _post_task_processor = LobsterPostTaskProcessor()
    return _post_task_processor
