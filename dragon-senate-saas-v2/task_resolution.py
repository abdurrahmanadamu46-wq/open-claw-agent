from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger("task_resolution")

_DB_PATH = os.getenv("TASK_RESOLUTION_DB", "./data/task_resolution.sqlite")


class SkillStatus(str, Enum):
    REQUIRED = "required"
    SATISFIED = "satisfied"
    PENDING = "pending"
    RUNNING = "running"
    FAILED = "failed"


@dataclass(slots=True)
class SkillRef:
    skill_id: str
    lobster_id: str
    version_constraint: str = "*"
    params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class SatisfiedSkill:
    skill_id: str
    lobster_id: str
    version: str
    cached_result: Any = None
    completed_at: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "skill_id": self.skill_id,
            "lobster_id": self.lobster_id,
            "version": self.version,
            "cached_result": self.cached_result,
            "completed_at": self.completed_at,
            "metadata": dict(self.metadata or {}),
        }


@dataclass(slots=True)
class TaskResolution:
    task_id: str
    lobster_id: str
    tenant_id: str
    required: list[SkillRef] = field(default_factory=list)
    satisfied: list[SatisfiedSkill] = field(default_factory=list)
    pending: list[SkillRef] = field(default_factory=list)
    resolved_at: float = field(default_factory=time.time)

    @property
    def is_fully_satisfied(self) -> bool:
        return len(self.pending) == 0

    @property
    def satisfaction_rate(self) -> float:
        if not self.required:
            return 1.0
        return len(self.satisfied) / len(self.required)

    def first_cached_result(self) -> Any | None:
        for item in self.satisfied:
            if item.cached_result is not None:
                return item.cached_result
        return None

    def summary(self) -> str:
        return (
            f"[Resolution] task={self.task_id} lobster={self.lobster_id} "
            f"required={len(self.required)} satisfied={len(self.satisfied)} "
            f"pending={len(self.pending)} hit_rate={self.satisfaction_rate:.0%}"
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "lobster_id": self.lobster_id,
            "tenant_id": self.tenant_id,
            "required": [item.to_dict() for item in self.required],
            "satisfied": [item.to_dict() for item in self.satisfied],
            "pending": [item.to_dict() for item in self.pending],
            "resolved_at": self.resolved_at,
            "is_fully_satisfied": self.is_fully_satisfied,
            "satisfaction_rate": round(self.satisfaction_rate, 4),
        }


def _normalize_skill_id(value: str) -> str:
    return str(value or "").strip()


def _normalize_lobster_id(value: str, fallback: str = "commander") -> str:
    normalized = str(value or "").strip()
    return normalized or fallback


def skill_ref_from_any(item: Any, *, default_lobster_id: str) -> SkillRef | None:
    if isinstance(item, SkillRef):
        return item
    if isinstance(item, str):
        skill_id = _normalize_skill_id(item)
        if not skill_id:
            return None
        return SkillRef(skill_id=skill_id, lobster_id=default_lobster_id)
    if isinstance(item, dict):
        skill_id = _normalize_skill_id(
            item.get("skill_id")
            or item.get("id")
            or item.get("name")
            or item.get("skill")
        )
        if not skill_id:
            return None
        params = item.get("params") if isinstance(item.get("params"), dict) else {}
        if not params and isinstance(item.get("arguments"), dict):
            params = dict(item.get("arguments") or {})
        return SkillRef(
            skill_id=skill_id,
            lobster_id=_normalize_lobster_id(item.get("lobster_id") or item.get("role_id"), default_lobster_id),
            version_constraint=str(
                item.get("version_constraint")
                or item.get("constraint")
                or item.get("version")
                or "*"
            ).strip()
            or "*",
            params=dict(params or {}),
        )
    return None


def normalize_required_skills(
    *,
    role_id: str,
    explicit_required_skills: list[Any] | None = None,
    prompt_skill_id: str | None = None,
    tool_defs: list[dict[str, Any]] | None = None,
) -> list[SkillRef]:
    dedup: dict[tuple[str, str], SkillRef] = {}
    for item in explicit_required_skills or []:
        ref = skill_ref_from_any(item, default_lobster_id=role_id)
        if ref is None:
            continue
        dedup[(ref.lobster_id, ref.skill_id)] = ref

    normalized_prompt_skill = _normalize_skill_id(prompt_skill_id or "")
    if normalized_prompt_skill:
        dedup.setdefault(
            (role_id, normalized_prompt_skill),
            SkillRef(skill_id=normalized_prompt_skill, lobster_id=role_id),
        )

    for tool in tool_defs or []:
        if not isinstance(tool, dict):
            continue
        tool_skill_id = _normalize_skill_id(
            tool.get("skill_id")
            or tool.get("name")
            or tool.get("tool")
        )
        if not tool_skill_id:
            continue
        dedup.setdefault(
            (role_id, tool_skill_id),
            SkillRef(
                skill_id=tool_skill_id,
                lobster_id=_normalize_lobster_id(tool.get("lobster_id"), role_id),
                params=dict(tool.get("arguments") or {}) if isinstance(tool.get("arguments"), dict) else {},
            ),
        )
    return list(dedup.values())


def resolve_skill_version(skill_id: str, default: str = "v1") -> str:
    normalized_skill = _normalize_skill_id(skill_id)
    if not normalized_skill:
        return default
    try:
        from lobster_skill_registry import get_skill_registry

        skill = get_skill_registry().get(normalized_skill)
        version = str(getattr(skill, "version", "") or "").strip()
        return version or default
    except Exception:
        return default


class TaskResolutionStore:
    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db_path = Path(db_path)
        if not self._db_path.is_absolute():
            self._db_path = (Path(__file__).resolve().parent / self._db_path).resolve()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS skill_resolution_cache (
                    tenant_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    skill_id TEXT NOT NULL,
                    version TEXT NOT NULL DEFAULT 'v1',
                    cached_result_json TEXT NOT NULL DEFAULT 'null',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    completed_at REAL NOT NULL DEFAULT 0,
                    updated_at REAL NOT NULL DEFAULT 0,
                    PRIMARY KEY (tenant_id, lobster_id, skill_id)
                );
                CREATE INDEX IF NOT EXISTS idx_task_resolution_tenant
                    ON skill_resolution_cache(tenant_id, lobster_id, updated_at DESC);
                """
            )
            conn.commit()

    async def get(
        self,
        tenant_id: str,
        lobster_id: str,
        skill_id: str,
    ) -> SatisfiedSkill | None:
        normalized_tenant = _normalize_lobster_id(tenant_id, "tenant_main")
        normalized_lobster = _normalize_lobster_id(lobster_id)
        normalized_skill = _normalize_skill_id(skill_id)
        if not normalized_skill:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT tenant_id, lobster_id, skill_id, version, cached_result_json,
                       metadata_json, completed_at
                FROM skill_resolution_cache
                WHERE tenant_id = ? AND lobster_id = ? AND skill_id = ?
                """,
                (normalized_tenant, normalized_lobster, normalized_skill),
            ).fetchone()
        if row is None:
            return None
        return SatisfiedSkill(
            skill_id=str(row["skill_id"]),
            lobster_id=str(row["lobster_id"]),
            version=str(row["version"] or "v1"),
            cached_result=_safe_json_load(row["cached_result_json"], fallback=str(row["cached_result_json"] or "")),
            completed_at=float(row["completed_at"] or 0) or None,
            metadata=_safe_json_load(row["metadata_json"], fallback={}) if isinstance(row["metadata_json"], str) else {},
        )

    async def put(
        self,
        *,
        tenant_id: str,
        lobster_id: str,
        skill_id: str,
        version: str,
        cached_result: Any,
        completed_at: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        normalized_tenant = _normalize_lobster_id(tenant_id, "tenant_main")
        normalized_lobster = _normalize_lobster_id(lobster_id)
        normalized_skill = _normalize_skill_id(skill_id)
        if not normalized_skill:
            return
        now_ts = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO skill_resolution_cache(
                    tenant_id, lobster_id, skill_id, version,
                    cached_result_json, metadata_json, completed_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, lobster_id, skill_id) DO UPDATE SET
                    version = excluded.version,
                    cached_result_json = excluded.cached_result_json,
                    metadata_json = excluded.metadata_json,
                    completed_at = excluded.completed_at,
                    updated_at = excluded.updated_at
                """,
                (
                    normalized_tenant,
                    normalized_lobster,
                    normalized_skill,
                    str(version or "v1"),
                    _safe_json_dump(cached_result),
                    _safe_json_dump(metadata or {}),
                    float(completed_at or now_ts),
                    now_ts,
                ),
            )
            conn.commit()

    async def clear(self, tenant_id: str | None = None) -> int:
        with self._connect() as conn:
            if tenant_id:
                cur = conn.execute(
                    "DELETE FROM skill_resolution_cache WHERE tenant_id = ?",
                    (_normalize_lobster_id(tenant_id, "tenant_main"),),
                )
            else:
                cur = conn.execute("DELETE FROM skill_resolution_cache")
            conn.commit()
            return int(cur.rowcount or 0)


class TaskResolver:
    def __init__(self, skill_cache: Any | None = None) -> None:
        self._cache = skill_cache or get_task_resolution_store()

    async def resolve(
        self,
        *,
        task_id: str,
        lobster_id: str,
        tenant_id: str,
        required_skills: list[SkillRef],
    ) -> TaskResolution:
        resolution = TaskResolution(
            task_id=str(task_id or "").strip() or f"task_{int(time.time())}",
            lobster_id=_normalize_lobster_id(lobster_id),
            tenant_id=_normalize_lobster_id(tenant_id, "tenant_main"),
            required=list(required_skills),
        )
        for skill_ref in required_skills:
            cached = await self._check_cache(resolution.tenant_id, skill_ref)
            if cached is not None:
                resolution.satisfied.append(cached)
                continue
            resolution.pending.append(skill_ref)
        logger.info(resolution.summary())
        return resolution

    async def _check_cache(self, tenant_id: str, skill_ref: SkillRef) -> SatisfiedSkill | None:
        if hasattr(self._cache, "get") and callable(getattr(self._cache, "get")):
            cached = await self._cache.get(tenant_id, skill_ref.lobster_id, skill_ref.skill_id)
        elif isinstance(self._cache, dict):
            cache_key = f"{tenant_id}:{skill_ref.lobster_id}:{skill_ref.skill_id}"
            cached = self._cache.get(cache_key)
        else:
            cached = None
        if cached is None:
            return None
        if isinstance(cached, dict):
            cached = SatisfiedSkill(
                skill_id=str(cached.get("skill_id") or skill_ref.skill_id),
                lobster_id=str(cached.get("lobster_id") or skill_ref.lobster_id),
                version=str(cached.get("version") or "v1"),
                cached_result=cached.get("cached_result"),
                completed_at=float(cached.get("completed_at") or 0) or None,
                metadata=dict(cached.get("metadata") or {}),
            )
        if not isinstance(cached, SatisfiedSkill):
            return None
        if not self._version_satisfies(cached.version, skill_ref.version_constraint):
            return None
        return cached

    def _version_satisfies(self, version: str, constraint: str) -> bool:
        normalized_constraint = str(constraint or "*").strip() or "*"
        if normalized_constraint == "*":
            return True
        parts = [part.strip() for part in normalized_constraint.split(",") if part.strip()]
        version_tuple = self._parse_version(version)
        for part in parts:
            op, expected = self._split_constraint(part)
            expected_tuple = self._parse_version(expected)
            if op == "==" and version_tuple != expected_tuple:
                return False
            if op == "!=" and version_tuple == expected_tuple:
                return False
            if op == ">=" and version_tuple < expected_tuple:
                return False
            if op == "<=" and version_tuple > expected_tuple:
                return False
            if op == ">" and version_tuple <= expected_tuple:
                return False
            if op == "<" and version_tuple >= expected_tuple:
                return False
        return True

    @staticmethod
    def _split_constraint(part: str) -> tuple[str, str]:
        for token in (">=", "<=", "==", "!=", ">", "<"):
            if part.startswith(token):
                return token, part[len(token):].strip()
        return "==", part.strip()

    @staticmethod
    def _parse_version(version: str) -> tuple[int, ...]:
        numbers: list[int] = []
        for part in str(version or "").replace("-", ".").split("."):
            digits = "".join(ch for ch in part if ch.isdigit())
            if digits:
                numbers.append(int(digits))
        return tuple(numbers or [0])


def _safe_json_dump(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except TypeError:
        return json.dumps(str(value), ensure_ascii=False)


def _safe_json_load(raw: Any, fallback: Any = None) -> Any:
    if raw is None:
        return fallback
    try:
        return json.loads(str(raw))
    except Exception:
        return fallback


_store: TaskResolutionStore | None = None


def get_task_resolution_store() -> TaskResolutionStore:
    global _store
    if _store is None:
        _store = TaskResolutionStore()
    return _store
