"""
Usecase template registry for curated lobster workflows.

Design-time templates live in packages/usecase-templates and are exposed
through lightweight API endpoints for the operations control plane.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger("usecase_registry")

REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = REPO_ROOT / "packages" / "usecase-templates"
SCHEMA_PATH = TEMPLATE_DIR / "schema.json"


class UsecaseValidationError(ValueError):
    """Raised when a usecase template fails local schema checks."""


class UsecaseRegistry:
    def __init__(self, template_dir: str | None = None):
        self._dir = Path(template_dir) if template_dir else TEMPLATE_DIR
        self._schema = self._load_schema()
        self._cache: dict[str, dict[str, Any]] = {}
        self._load_all()

    def _load_schema(self) -> dict[str, Any]:
        if not SCHEMA_PATH.exists():
            raise FileNotFoundError(f"Usecase schema not found at {SCHEMA_PATH}")
        return json.loads(SCHEMA_PATH.read_text(encoding="utf-8-sig"))

    def _load_all(self) -> None:
        self._cache.clear()
        if not self._dir.exists():
            logger.warning("Usecase template directory does not exist: %s", self._dir)
            return
        for path in sorted(self._dir.glob("uc-*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8-sig"))
                self._validate_usecase(data)
                self._cache[str(data["id"])] = data
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to load usecase %s: %s", path.name, exc)
        logger.info("Loaded %s usecase templates", len(self._cache))

    def _validate_usecase(self, data: dict[str, Any]) -> None:
        required = set(self._schema.get("required", []))
        missing = sorted(key for key in required if key not in data)
        if missing:
            raise UsecaseValidationError(f"missing required fields: {', '.join(missing)}")

        usecase_id = str(data.get("id") or "")
        if not re.fullmatch(r"uc-[a-z0-9-]+", usecase_id):
            raise UsecaseValidationError(f"invalid id: {usecase_id}")

        category = str(data.get("category") or "")
        allowed_categories = set(self._schema["properties"]["category"]["enum"])
        if category not in allowed_categories:
            raise UsecaseValidationError(f"invalid category: {category}")

        difficulty = str(data.get("difficulty") or "")
        allowed_difficulty = set(self._schema["properties"]["difficulty"]["enum"])
        if difficulty not in allowed_difficulty:
            raise UsecaseValidationError(f"invalid difficulty: {difficulty}")

        allowed_lobsters = set(self._schema["properties"]["lobsters"]["items"]["enum"])
        lobsters = data.get("lobsters", [])
        if not isinstance(lobsters, list) or not lobsters:
            raise UsecaseValidationError("lobsters must be a non-empty array")
        invalid_lobsters = [item for item in lobsters if str(item) not in allowed_lobsters]
        if invalid_lobsters:
            raise UsecaseValidationError(f"invalid lobsters: {', '.join(map(str, invalid_lobsters))}")

        setup_steps = data.get("setup_steps", [])
        if not isinstance(setup_steps, list) or not setup_steps:
            raise UsecaseValidationError("setup_steps must be a non-empty array")
        allowed_code_types = set(self._schema["properties"]["setup_steps"]["items"]["properties"]["code_type"]["enum"])
        for index, step in enumerate(setup_steps, start=1):
            if not isinstance(step, dict):
                raise UsecaseValidationError(f"setup_steps[{index}] must be an object")
            if "step" not in step or "action" not in step:
                raise UsecaseValidationError(f"setup_steps[{index}] missing step/action")
            code_type = str(step.get("code_type") or "none")
            if code_type not in allowed_code_types:
                raise UsecaseValidationError(f"setup_steps[{index}] invalid code_type: {code_type}")

        scheduler_config = data.get("scheduler_config")
        if scheduler_config is not None:
            if not isinstance(scheduler_config, dict):
                raise UsecaseValidationError("scheduler_config must be an object")
            kind = str(scheduler_config.get("kind") or "")
            session_mode = str(scheduler_config.get("session_mode") or "")
            allowed_kind = set(self._schema["properties"]["scheduler_config"]["properties"]["kind"]["enum"])
            allowed_session_mode = set(
                self._schema["properties"]["scheduler_config"]["properties"]["session_mode"]["enum"]
            )
            if kind and kind not in allowed_kind:
                raise UsecaseValidationError(f"invalid scheduler kind: {kind}")
            if session_mode and session_mode not in allowed_session_mode:
                raise UsecaseValidationError(f"invalid scheduler session_mode: {session_mode}")

    def list_usecases(self, category: str | None = None, difficulty: str | None = None) -> list[dict[str, Any]]:
        results = list(self._cache.values())
        if category:
            results = [item for item in results if item.get("category") == category]
        if difficulty:
            results = [item for item in results if item.get("difficulty") == difficulty]
        return sorted(results, key=lambda item: str(item.get("name") or item.get("id") or ""))

    def get_usecase(self, usecase_id: str) -> dict[str, Any] | None:
        return self._cache.get(usecase_id)

    def get_categories(self) -> list[dict[str, Any]]:
        counts: dict[str, int] = {}
        for item in self._cache.values():
            category = str(item.get("category") or "other")
            counts[category] = counts.get(category, 0) + 1
        return [{"category": key, "count": counts[key]} for key in sorted(counts)]

    def get_schema(self) -> dict[str, Any]:
        return dict(self._schema)


def register_usecase_routes(app: Any, registry: UsecaseRegistry) -> None:
    """Register read-only usecase market routes."""
    from fastapi import HTTPException

    @app.get("/api/usecases")
    async def list_usecases(category: str | None = None, difficulty: str | None = None) -> dict[str, Any]:
        return {
            "ok": True,
            "count": len(registry.list_usecases(category=category, difficulty=difficulty)),
            "usecases": registry.list_usecases(category=category, difficulty=difficulty),
        }

    @app.get("/api/usecases/categories")
    async def list_categories() -> dict[str, Any]:
        return {"ok": True, "categories": registry.get_categories()}

    @app.get("/api/usecases/{usecase_id}")
    async def get_usecase(usecase_id: str) -> dict[str, Any]:
        usecase = registry.get_usecase(usecase_id)
        if usecase is None:
            raise HTTPException(status_code=404, detail=f"Usecase {usecase_id} not found")
        return {"ok": True, "usecase": usecase}
