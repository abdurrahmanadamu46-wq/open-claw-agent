from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _registry_path() -> Path:
    return (
        Path(__file__).resolve().parent.parent
        / "subprojects"
        / "cloud-brain-senate-core"
        / "CANONICAL_REGISTRY.v1.json"
    ).resolve()


def load_cloud_brain_registry() -> dict[str, Any]:
    path = _registry_path()
    if not path.exists():
        raise FileNotFoundError(f"cloud brain registry not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_elder_ids() -> list[str]:
    registry = load_cloud_brain_registry()
    return [str(item.get("canonical_id")) for item in registry.get("elders", []) if str(item.get("canonical_id")).strip()]


def normalize_role_id(role_id: str | None) -> str:
    raw = str(role_id or "").strip().lower()
    if not raw:
      return raw
    registry = load_cloud_brain_registry()
    commander = registry.get("commander", {}) if isinstance(registry.get("commander"), dict) else {}
    commander_aliases = [str(x).strip().lower() for x in commander.get("aliases", []) if str(x).strip()]
    if raw in commander_aliases or raw == str(commander.get("canonical_id", "")).strip().lower():
        return "commander"
    for item in registry.get("elders", []):
        if not isinstance(item, dict):
            continue
        canonical = str(item.get("canonical_id") or "").strip().lower()
        aliases = [str(x).strip().lower() for x in item.get("aliases", []) if str(x).strip()]
        if raw == canonical or raw in aliases:
            return canonical
    support_roles = registry.get("non_seat_support_roles", [])
    for item in support_roles:
        if not isinstance(item, dict):
            continue
        canonical = str(item.get("canonical_id") or "").strip().lower()
        if raw == canonical:
            return canonical
    return raw


def cloud_brain_role_summary() -> dict[str, Any]:
    registry = load_cloud_brain_registry()
    return {
        "commander": registry.get("commander", {}),
        "elders": registry.get("elders", []),
        "support_roles": registry.get("non_seat_support_roles", []),
        "ui_roster_order": ((registry.get("frontend_alignment_rules") or {}).get("ui_roster_order") if isinstance(registry.get("frontend_alignment_rules"), dict) else []),
    }
