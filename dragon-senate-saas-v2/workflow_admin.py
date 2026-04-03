from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from workflow_engine import WORKFLOWS_DIR


def load_workflow_document(workflow_id: str) -> dict[str, Any]:
    path = WORKFLOWS_DIR / f"{workflow_id}.yaml"
    if not path.exists():
        raise FileNotFoundError(workflow_id)
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def save_workflow_document(workflow_id: str, payload: dict[str, Any]) -> str:
    path = WORKFLOWS_DIR / f"{workflow_id}.yaml"
    path.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return str(path)


def update_workflow_document(workflow_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    payload = load_workflow_document(workflow_id)
    for key, value in updates.items():
        if value is None:
            payload.pop(key, None)
        else:
            payload[key] = value
    save_workflow_document(workflow_id, payload)
    return payload
