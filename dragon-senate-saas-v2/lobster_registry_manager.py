"""
lobster_registry_manager.py — 龙虾注册表管理器

维护 lobsters-registry.json 作为 Commander 管理龙虾池的单一真相源。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REGISTRY_PATH = Path(__file__).resolve().parent / "lobsters-registry.json"


def load_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    """Load the lobsters registry from disk."""
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"$schema": "lobsters-registry-v1", "updated_at": None, "lobsters": {}}


def save_registry(registry: dict[str, Any], path: Path = REGISTRY_PATH) -> None:
    """Persist the registry to disk."""
    registry["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")


def update_lobster_status(role_id: str, status: str, path: Path = REGISTRY_PATH) -> bool:
    """Update a lobster's status field."""
    reg = load_registry(path)
    lobster = reg.get("lobsters", {}).get(role_id)
    if lobster is None:
        return False
    lobster["status"] = status
    save_registry(reg, path)
    return True


def record_heartbeat(role_id: str, path: Path = REGISTRY_PATH) -> bool:
    """Record a heartbeat timestamp for a lobster."""
    reg = load_registry(path)
    lobster = reg.get("lobsters", {}).get(role_id)
    if lobster is None:
        return False
    lobster["last_heartbeat"] = datetime.now(timezone.utc).isoformat()
    save_registry(reg, path)
    return True


def record_task_complete(role_id: str, task_id: str, path: Path = REGISTRY_PATH) -> bool:
    """Record that a lobster completed a task."""
    reg = load_registry(path)
    lobster = reg.get("lobsters", {}).get(role_id)
    if lobster is None:
        return False
    lobster["last_task_id"] = task_id
    lobster["run_count"] = lobster.get("run_count", 0) + 1
    lobster["status"] = "idle"
    save_registry(reg, path)
    return True


def record_error(role_id: str, path: Path = REGISTRY_PATH) -> bool:
    """Increment error count for a lobster."""
    reg = load_registry(path)
    lobster = reg.get("lobsters", {}).get(role_id)
    if lobster is None:
        return False
    lobster["error_count"] = lobster.get("error_count", 0) + 1
    lobster["status"] = "error"
    save_registry(reg, path)
    return True


def increment_token_usage(role_id: str, tokens: int, path: Path = REGISTRY_PATH) -> bool:
    """Add token usage for a lobster."""
    reg = load_registry(path)
    lobster = reg.get("lobsters", {}).get(role_id)
    if lobster is None:
        return False
    lobster["token_usage_today"] = lobster.get("token_usage_today", 0) + tokens
    save_registry(reg, path)
    return True


def reset_daily_token_usage(path: Path = REGISTRY_PATH) -> None:
    """Reset all lobsters' daily token usage."""
    reg = load_registry(path)
    for lobster in reg.get("lobsters", {}).values():
        lobster["token_usage_today"] = 0
    save_registry(reg, path)


def get_lobster_summary(path: Path = REGISTRY_PATH) -> list[dict[str, Any]]:
    """Return a summary list for dashboard display."""
    try:
        from lifecycle_manager import get_lifecycle_manager

        reg = get_lifecycle_manager().ensure_registry_shape()
    except Exception:
        reg = load_registry(path)
    return [
        {
            "role_id": role_id,
            "zh_name": data.get("zh_name"),
            "display_name": data.get("display_name"),
            "status": data.get("status"),
            "phase": data.get("phase"),
            "lifecycle": data.get("lifecycle", "production"),
            "system": data.get("system", ""),
            "annotations": data.get("annotations", {}),
            "last_heartbeat": data.get("last_heartbeat"),
            "error_count": data.get("error_count", 0),
            "run_count": data.get("run_count", 0),
            "token_usage_today": data.get("token_usage_today", 0),
        }
        for role_id, data in reg.get("lobsters", {}).items()
    ]
