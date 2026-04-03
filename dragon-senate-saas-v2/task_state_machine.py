"""
Task state machine for Layer 2 scheduler orchestration.

This wraps the scheduler lifecycle with explicit states so the runtime can
reason about retries, transitions, and auditability in a structured way.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class TaskStateRecord:
    task_id: str
    state: str = "CREATED"
    retries: int = 0
    updated_at: str = field(default_factory=_utc_now)
    history: list[dict[str, Any]] = field(default_factory=list)


class TaskStateMachine:
    STATES = ["CREATED", "QUEUED", "DISPATCHED", "EXECUTING", "REPORTED", "VERIFIED", "DONE", "FAILED"]

    TRANSITIONS = {
        "CREATED": ["QUEUED"],
        "QUEUED": ["DISPATCHED", "FAILED"],
        "DISPATCHED": ["EXECUTING", "FAILED"],
        "EXECUTING": ["REPORTED", "FAILED"],
        "REPORTED": ["VERIFIED", "FAILED"],
        "VERIFIED": ["DONE"],
        "FAILED": ["QUEUED"],
        "DONE": [],
    }

    def __init__(self, state_path: str = "data/task_state_machine.json"):
        self._state_path = Path(state_path)
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._records: dict[str, TaskStateRecord] = {}
        self._load()

    def transition(self, task_id: str, new_state: str, *, note: str = "") -> TaskStateRecord:
        target = str(new_state or "").strip().upper()
        if target not in self.STATES:
            raise ValueError(f"Unknown state: {new_state}")
        record = self._records.get(task_id) or TaskStateRecord(task_id=task_id)
        allowed = self.TRANSITIONS.get(record.state, [])
        if target != record.state and target not in allowed:
            raise ValueError(f"Invalid transition: {record.state} -> {target}")
        record.state = target
        record.updated_at = _utc_now()
        record.history.append({"state": target, "updated_at": record.updated_at, "note": note})
        self._records[task_id] = record
        self._save()
        return record

    def auto_retry(self, task_id: str, max_retries: int = 3) -> bool:
        record = self._records.get(task_id)
        if record is None or record.state != "FAILED":
            return False
        if record.retries >= max(0, int(max_retries)):
            return False
        record.retries += 1
        self.transition(task_id, "QUEUED", note=f"auto_retry_{record.retries}")
        return True

    def get(self, task_id: str) -> TaskStateRecord | None:
        return self._records.get(task_id)

    def snapshot(self) -> dict[str, Any]:
        return {
            "count": len(self._records),
            "tasks": {
                task_id: {
                    "state": record.state,
                    "retries": record.retries,
                    "updated_at": record.updated_at,
                    "history": list(record.history),
                }
                for task_id, record in self._records.items()
            },
        }

    def _load(self) -> None:
        if not self._state_path.exists():
            return
        try:
            raw = json.loads(self._state_path.read_text(encoding="utf-8"))
        except Exception:
            return
        if not isinstance(raw, dict):
            return
        for task_id, payload in raw.get("tasks", {}).items():
            if not isinstance(payload, dict):
                continue
            self._records[task_id] = TaskStateRecord(
                task_id=task_id,
                state=str(payload.get("state") or "CREATED"),
                retries=int(payload.get("retries", 0) or 0),
                updated_at=str(payload.get("updated_at") or _utc_now()),
                history=list(payload.get("history") or []),
            )

    def _save(self) -> None:
        self._state_path.write_text(
            json.dumps(self.snapshot(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
