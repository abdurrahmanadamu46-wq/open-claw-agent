"""
Feature flag system for lobster runtime, prompt experiments, and edge sync.
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import sqlite3
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class StrategyType(str, Enum):
    ALL = "all"
    GRADUAL_ROLLOUT = "gradualRollout"
    TENANT_WHITELIST = "tenantWhitelist"
    LOBSTER_WHITELIST = "lobsterWhitelist"
    EDGE_NODE_TAG = "edgeNodeTag"


class StickinessType(str, Enum):
    TENANT_ID = "tenant_id"
    USER_ID = "user_id"
    RANDOM = "random"


class Environment(str, Enum):
    DEV = "dev"
    STAGING = "staging"
    PROD = "prod"


FeatureFlagEnvironment = Environment


@dataclass
class FlagStrategy:
    type: StrategyType
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass
class FlagVariant:
    name: str
    weight: int
    payload: Any = None
    enabled: bool = True


@dataclass
class FeatureFlag:
    name: str
    enabled: bool
    environment: Environment
    strategies: list[FlagStrategy] = field(default_factory=lambda: [FlagStrategy(type=StrategyType.ALL)])
    variants: list[FlagVariant] = field(default_factory=list)
    description: str = ""
    tags: list[str] = field(default_factory=list)
    tenant_id: str | None = None
    created_by: str = "system"
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)
    is_builtin: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "enabled": self.enabled,
            "environment": self.environment.value,
            "strategies": [asdict(item) | {"type": item.type.value} for item in self.strategies],
            "variants": [asdict(item) for item in self.variants],
            "description": self.description,
            "tags": list(self.tags),
            "tenant_id": self.tenant_id,
            "created_by": self.created_by,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "is_builtin": self.is_builtin,
        }


@dataclass
class FeatureFlagContext:
    tenant_id: str = ""
    user_id: str = ""
    lobster_id: str = ""
    edge_node_id: str = ""
    edge_node_tags: list[str] = field(default_factory=list)
    environment: Environment = Environment.PROD


@dataclass
class Variant:
    name: str
    enabled: bool
    payload: Any = None


DEFAULT_FLAGS: list[dict[str, Any]] = [
    {"name": "lobster.pool.all_enabled", "enabled": True, "description": "全局龙虾熔断开关"},
    {"name": "lobster.commander.enabled", "enabled": True},
    {"name": "lobster.radar.enabled", "enabled": True},
    {"name": "lobster.strategist.enabled", "enabled": True},
    {"name": "lobster.inkwriter.enabled", "enabled": True},
    {"name": "lobster.visualizer.enabled", "enabled": True},
    {"name": "lobster.dispatcher.enabled", "enabled": True},
    {"name": "lobster.echoer.enabled", "enabled": True},
    {"name": "lobster.catcher.enabled", "enabled": True},
    {"name": "lobster.abacus.enabled", "enabled": True},
    {"name": "lobster.followup.enabled", "enabled": True},
]


class StrategyEvaluator:
    def evaluate(self, strategy: FlagStrategy, ctx: FeatureFlagContext) -> bool:
        if strategy.type == StrategyType.ALL:
            return True
        if strategy.type == StrategyType.GRADUAL_ROLLOUT:
            return self._gradual_rollout(strategy.parameters, ctx)
        if strategy.type == StrategyType.TENANT_WHITELIST:
            return ctx.tenant_id in [str(item).strip() for item in strategy.parameters.get("tenant_ids", [])]
        if strategy.type == StrategyType.LOBSTER_WHITELIST:
            return ctx.lobster_id in [str(item).strip() for item in strategy.parameters.get("lobster_ids", [])]
        if strategy.type == StrategyType.EDGE_NODE_TAG:
            required = {str(item).strip() for item in strategy.parameters.get("tags", []) if str(item).strip()}
            return bool(required & set(ctx.edge_node_tags))
        return False

    def _gradual_rollout(self, params: dict[str, Any], ctx: FeatureFlagContext) -> bool:
        rollout = max(0, min(100, int(params.get("rollout", 100) or 100)))
        stickiness = str(params.get("stickiness", StickinessType.TENANT_ID.value)).strip()
        if stickiness == StickinessType.USER_ID.value:
            value = ctx.user_id or ctx.tenant_id or "anonymous"
        elif stickiness == StickinessType.RANDOM.value:
            return random.randint(0, 99) < rollout
        else:
            value = ctx.tenant_id or ctx.user_id or "tenant_main"
        bucket = int(hashlib.md5(value.encode("utf-8")).hexdigest()[:8], 16) % 100
        return bucket < rollout


class FeatureFlagCache:
    def __init__(self) -> None:
        self._flags: dict[str, FeatureFlag] = {}
        self._lock = threading.RLock()
        self._callbacks: list[Callable[[str, FeatureFlag | None], None]] = []
        self._evaluator = StrategyEvaluator()
        self._backup_file = self._resolve_backup_file()
        self._db_path = self._resolve_db_path()
        self._last_sync: str | None = None
        self._started = False
        self._ensure_schema()
        self._seed_defaults()
        self.sync_from_db()
        self._start_background_sync()

    def _resolve_db_path(self) -> Path:
        raw = os.getenv("FEATURE_FLAGS_DB", "data/feature_flags.sqlite")
        path = Path(raw)
        if not path.is_absolute():
            path = (Path(__file__).resolve().parent / path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def _resolve_backup_file(self) -> Path:
        raw = os.getenv("FEATURE_FLAGS_BACKUP", "config/feature_flags_backup.json")
        path = Path(raw)
        if not path.is_absolute():
            path = (Path(__file__).resolve().parent / path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS feature_flags (
                    name TEXT NOT NULL,
                    tenant_id TEXT NOT NULL DEFAULT '__global__',
                    environment TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 0,
                    description TEXT NOT NULL DEFAULT '',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    strategies_json TEXT NOT NULL DEFAULT '[]',
                    variants_json TEXT NOT NULL DEFAULT '[]',
                    created_by TEXT NOT NULL DEFAULT 'system',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    is_builtin INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (name, tenant_id, environment)
                );
                CREATE TABLE IF NOT EXISTS feature_flag_changelog (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    tenant_id TEXT NOT NULL DEFAULT '__global__',
                    environment TEXT NOT NULL,
                    change_type TEXT NOT NULL,
                    old_value_json TEXT,
                    new_value_json TEXT,
                    changed_by TEXT NOT NULL DEFAULT 'system',
                    changed_at TEXT NOT NULL
                );
                """
            )
            conn.commit()

    def _seed_defaults(self) -> None:
        now = _utc_now()
        with self._connect() as conn:
            for env in Environment:
                for seed in DEFAULT_FLAGS:
                    exists = conn.execute(
                        "SELECT 1 FROM feature_flags WHERE name = ? AND tenant_id='__global__' AND environment = ?",
                        (seed["name"], env.value),
                    ).fetchone()
                    if exists:
                        continue
                    flag = FeatureFlag(
                        name=seed["name"],
                        enabled=bool(seed.get("enabled", True)),
                        environment=env,
                        description=str(seed.get("description", "")),
                        tags=["builtin", "lobster"],
                        created_by="system",
                        created_at=now,
                        updated_at=now,
                        is_builtin=True,
                    )
                    conn.execute(
                        """
                        INSERT INTO feature_flags(
                            name, tenant_id, environment, enabled, description,
                            tags_json, strategies_json, variants_json, created_by,
                            created_at, updated_at, is_builtin
                        ) VALUES (?, '__global__', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            flag.name,
                            flag.environment.value,
                            1 if flag.enabled else 0,
                            flag.description,
                            json.dumps(flag.tags, ensure_ascii=False),
                            json.dumps([{"type": StrategyType.ALL.value, "parameters": {}}], ensure_ascii=False),
                            json.dumps([], ensure_ascii=False),
                            flag.created_by,
                            flag.created_at,
                            flag.updated_at,
                            1,
                        ),
                    )
            conn.commit()

    def _parse_flag_row(self, row: sqlite3.Row) -> FeatureFlag:
        strategies = [
            FlagStrategy(type=StrategyType(item.get("type", StrategyType.ALL.value)), parameters=dict(item.get("parameters") or {}))
            for item in json.loads(str(row["strategies_json"] or "[]"))
        ] or [FlagStrategy(type=StrategyType.ALL)]
        variants = [
            FlagVariant(
                name=str(item.get("name") or ""),
                weight=int(item.get("weight", 0) or 0),
                payload=item.get("payload"),
                enabled=bool(item.get("enabled", True)),
            )
            for item in json.loads(str(row["variants_json"] or "[]"))
            if str(item.get("name") or "").strip()
        ]
        tenant_id = str(row["tenant_id"] or "__global__")
        return FeatureFlag(
            name=str(row["name"]),
            enabled=bool(int(row["enabled"] or 0)),
            environment=Environment(str(row["environment"])),
            strategies=strategies,
            variants=variants,
            description=str(row["description"] or ""),
            tags=[str(item) for item in json.loads(str(row["tags_json"] or "[]")) if str(item).strip()],
            tenant_id=None if tenant_id == "__global__" else tenant_id,
            created_by=str(row["created_by"] or "system"),
            created_at=str(row["created_at"] or _utc_now()),
            updated_at=str(row["updated_at"] or _utc_now()),
            is_builtin=bool(int(row["is_builtin"] or 0)),
        )

    def _cache_key(self, name: str, tenant_id: str | None, environment: Environment | str) -> str:
        env_value = environment.value if isinstance(environment, Environment) else str(environment)
        return f"{str(tenant_id or '__global__').strip() or '__global__'}::{env_value}::{name}"

    def sync_from_db(self) -> None:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM feature_flags").fetchall()
        new_flags = {}
        for row in rows:
            flag = self._parse_flag_row(row)
            new_flags[self._cache_key(flag.name, flag.tenant_id, flag.environment.value)] = flag
        with self._lock:
            self._flags = new_flags
            self._last_sync = _utc_now()
        self._write_backup()

    def _start_background_sync(self) -> None:
        if self._started:
            return
        self._started = True
        interval = max(5, int(os.getenv("FEATURE_FLAGS_REFRESH_SEC", "30") or 30))

        def _loop() -> None:
            while True:
                time.sleep(interval)
                try:
                    self.sync_from_db()
                except Exception:
                    self._load_backup()

        threading.Thread(target=_loop, daemon=True, name="feature-flags-sync").start()

    def _write_backup(self) -> None:
        payload = {
            "saved_at": _utc_now(),
            "flags": [flag.to_dict() for flag in self._flags.values()],
        }
        self._backup_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _load_backup(self) -> None:
        if not self._backup_file.exists():
            return
        try:
            data = json.loads(self._backup_file.read_text(encoding="utf-8"))
            new_flags = {}
            for item in data.get("flags", []):
                flag = FeatureFlag(
                    name=str(item["name"]),
                    enabled=bool(item.get("enabled", False)),
                    environment=Environment(str(item.get("environment", Environment.PROD.value))),
                    strategies=[
                        FlagStrategy(
                            type=StrategyType(str(strategy.get("type", StrategyType.ALL.value))),
                            parameters=dict(strategy.get("parameters") or {}),
                        )
                        for strategy in item.get("strategies", [])
                    ] or [FlagStrategy(type=StrategyType.ALL)],
                    variants=[
                        FlagVariant(
                            name=str(variant.get("name") or ""),
                            weight=int(variant.get("weight", 0) or 0),
                            payload=variant.get("payload"),
                            enabled=bool(variant.get("enabled", True)),
                        )
                        for variant in item.get("variants", [])
                        if str(variant.get("name") or "").strip()
                    ],
                    description=str(item.get("description", "")),
                    tags=[str(tag) for tag in item.get("tags", []) if str(tag).strip()],
                    tenant_id=str(item.get("tenant_id") or "").strip() or None,
                    created_by=str(item.get("created_by", "system")),
                    created_at=str(item.get("created_at", _utc_now())),
                    updated_at=str(item.get("updated_at", _utc_now())),
                    is_builtin=bool(item.get("is_builtin", False)),
                )
                new_flags[self._cache_key(flag.name, flag.tenant_id, flag.environment.value)] = flag
            with self._lock:
                if new_flags:
                    self._flags = new_flags
        except Exception:
            return

    def register_callback(self, callback: Callable[[str, FeatureFlag | None], None]) -> None:
        self._callbacks.append(callback)

    def _notify_change(self, event_type: str, flag: FeatureFlag | None) -> None:
        for callback in list(self._callbacks):
            try:
                callback(event_type, flag)
            except Exception:
                continue

    def _log_change(self, *, name: str, tenant_id: str | None, environment: Environment, change_type: str, old_value: Any, new_value: Any, changed_by: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO feature_flag_changelog(
                    id, name, tenant_id, environment, change_type, old_value_json, new_value_json, changed_by, changed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"ffchg_{uuid.uuid4().hex[:12]}",
                    name,
                    str(tenant_id or "__global__"),
                    environment.value,
                    change_type,
                    json.dumps(old_value, ensure_ascii=False) if old_value is not None else None,
                    json.dumps(new_value, ensure_ascii=False) if new_value is not None else None,
                    changed_by,
                    _utc_now(),
                ),
            )
            conn.commit()

    def list_flags(self, *, environment: Environment | str | None = None, tenant_id: str | None = None) -> list[FeatureFlag]:
        env_filter = str(environment or "").strip()
        tenant_filter = str(tenant_id or "").strip()
        with self._lock:
            flags = list(self._flags.values())
        if env_filter:
            flags = [flag for flag in flags if flag.environment.value == env_filter]
        if tenant_filter:
            flags = [flag for flag in flags if (flag.tenant_id or "") in {"", tenant_filter}]
        return sorted(flags, key=lambda item: ((item.tenant_id or "__global__"), item.environment.value, item.name))

    def get_flag(self, name: str, *, environment: Environment | str = Environment.PROD, tenant_id: str | None = None) -> FeatureFlag | None:
        normalized_name = str(name or "").strip()
        if isinstance(environment, Environment):
            normalized_env = environment
        else:
            normalized_env = Environment(str(environment or Environment.PROD.value))
        with self._lock:
            tenant_match = self._flags.get(self._cache_key(normalized_name, tenant_id, normalized_env.value))
            if tenant_match is not None:
                return tenant_match
            return self._flags.get(self._cache_key(normalized_name, None, normalized_env.value))

    def upsert_flag(self, flag: FeatureFlag, *, changed_by: str = "system") -> FeatureFlag:
        tenant_key = str(flag.tenant_id or "__global__").strip() or "__global__"
        existing = self.get_flag(flag.name, environment=flag.environment, tenant_id=flag.tenant_id)
        now = _utc_now()
        payload = flag.to_dict()
        payload["created_at"] = existing.created_at if existing else flag.created_at or now
        payload["updated_at"] = now
        payload["created_by"] = changed_by or flag.created_by or "system"
        saved = FeatureFlag(
            name=payload["name"],
            enabled=bool(payload["enabled"]),
            environment=Environment(payload["environment"]),
            strategies=[
                FlagStrategy(type=StrategyType(item["type"]), parameters=dict(item.get("parameters") or {}))
                for item in payload["strategies"]
            ],
            variants=[
                FlagVariant(
                    name=str(item["name"]),
                    weight=int(item["weight"]),
                    payload=item.get("payload"),
                    enabled=bool(item.get("enabled", True)),
                )
                for item in payload["variants"]
            ],
            description=str(payload.get("description", "")),
            tags=[str(item) for item in payload.get("tags", []) if str(item).strip()],
            tenant_id=str(payload.get("tenant_id") or "").strip() or None,
            created_by=str(payload["created_by"]),
            created_at=str(payload["created_at"]),
            updated_at=str(payload["updated_at"]),
            is_builtin=bool(payload.get("is_builtin", False)),
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO feature_flags(
                    name, tenant_id, environment, enabled, description, tags_json,
                    strategies_json, variants_json, created_by, created_at, updated_at, is_builtin
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(name, tenant_id, environment) DO UPDATE SET
                    enabled=excluded.enabled,
                    description=excluded.description,
                    tags_json=excluded.tags_json,
                    strategies_json=excluded.strategies_json,
                    variants_json=excluded.variants_json,
                    created_by=excluded.created_by,
                    updated_at=excluded.updated_at,
                    is_builtin=excluded.is_builtin
                """,
                (
                    saved.name,
                    tenant_key,
                    saved.environment.value,
                    1 if saved.enabled else 0,
                    saved.description,
                    json.dumps(saved.tags, ensure_ascii=False),
                    json.dumps([{"type": item.type.value, "parameters": item.parameters} for item in saved.strategies], ensure_ascii=False),
                    json.dumps([asdict(item) for item in saved.variants], ensure_ascii=False),
                    saved.created_by,
                    saved.created_at,
                    saved.updated_at,
                    1 if saved.is_builtin else 0,
                ),
            )
            conn.commit()
        self.sync_from_db()
        self._log_change(
            name=saved.name,
            tenant_id=saved.tenant_id,
            environment=saved.environment,
            change_type="updated" if existing else "created",
            old_value=existing.to_dict() if existing else None,
            new_value=saved.to_dict(),
            changed_by=changed_by,
        )
        self._notify_change("FLAG_UPDATED" if existing else "FLAG_CREATED", saved)
        return saved

    def delete_flag(self, name: str, *, environment: Environment | str, tenant_id: str | None = None, changed_by: str = "system") -> bool:
        existing = self.get_flag(name, environment=environment, tenant_id=tenant_id)
        if existing is None:
            return False
        if existing.is_builtin:
            raise ValueError("builtin flag cannot be deleted")
        tenant_key = str(existing.tenant_id or "__global__")
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM feature_flags WHERE name = ? AND tenant_id = ? AND environment = ?",
                (existing.name, tenant_key, existing.environment.value),
            )
            conn.commit()
        if not cur.rowcount:
            return False
        self.sync_from_db()
        self._log_change(
            name=existing.name,
            tenant_id=existing.tenant_id,
            environment=existing.environment,
            change_type="deleted",
            old_value=existing.to_dict(),
            new_value=None,
            changed_by=changed_by,
        )
        self._notify_change("FLAG_DELETED", existing)
        return True

    def set_enabled(self, name: str, enabled: bool, *, environment: Environment | str, tenant_id: str | None = None, changed_by: str = "system") -> FeatureFlag | None:
        existing = self.get_flag(name, environment=environment, tenant_id=tenant_id)
        if existing is None:
            return None
        existing.enabled = bool(enabled)
        return self.upsert_flag(existing, changed_by=changed_by)

    def update_strategies(self, name: str, strategies: list[FlagStrategy], *, environment: Environment | str, tenant_id: str | None = None, changed_by: str = "system") -> FeatureFlag | None:
        existing = self.get_flag(name, environment=environment, tenant_id=tenant_id)
        if existing is None:
            return None
        existing.strategies = strategies or [FlagStrategy(type=StrategyType.ALL)]
        return self.upsert_flag(existing, changed_by=changed_by)

    def update_variants(self, name: str, variants: list[FlagVariant], *, environment: Environment | str, tenant_id: str | None = None, changed_by: str = "system") -> FeatureFlag | None:
        existing = self.get_flag(name, environment=environment, tenant_id=tenant_id)
        if existing is None:
            return None
        enabled_variants = [variant for variant in variants if variant.enabled]
        total_weight = sum(int(item.weight or 0) for item in enabled_variants)
        if enabled_variants and total_weight not in {100, 1000}:
            raise ValueError("variant weights must sum to 100 or 1000")
        existing.variants = variants
        return self.upsert_flag(existing, changed_by=changed_by)

    def evaluate(self, flag_name: str, ctx: FeatureFlagContext, *, tenant_id: str | None = None) -> tuple[bool, FlagStrategy | None]:
        flag = self.get_flag(flag_name, environment=ctx.environment, tenant_id=tenant_id or ctx.tenant_id)
        if flag is None or not flag.enabled:
            return False, None
        matched: FlagStrategy | None = None
        for strategy in flag.strategies:
            if self._evaluator.evaluate(strategy, ctx):
                matched = strategy
                break
        return matched is not None, matched

    def is_enabled(self, flag_name: str, ctx: FeatureFlagContext) -> bool:
        enabled, _ = self.evaluate(flag_name, ctx, tenant_id=ctx.tenant_id)
        return enabled

    def get_variant(self, flag_name: str, ctx: FeatureFlagContext) -> Variant:
        enabled, _ = self.evaluate(flag_name, ctx, tenant_id=ctx.tenant_id)
        if not enabled:
            return Variant(name="disabled", enabled=False)
        flag = self.get_flag(flag_name, environment=ctx.environment, tenant_id=ctx.tenant_id)
        if flag is None or not flag.variants:
            return Variant(name="control", enabled=True)
        enabled_variants = [item for item in flag.variants if item.enabled and int(item.weight or 0) > 0]
        if not enabled_variants:
            return Variant(name="control", enabled=True)
        total_weight = sum(int(item.weight or 0) for item in enabled_variants)
        if total_weight <= 0:
            return Variant(name="control", enabled=True)
        key = ctx.tenant_id or ctx.user_id or ctx.edge_node_id or "control"
        bucket = int(hashlib.md5(key.encode("utf-8")).hexdigest()[:8], 16) % total_weight
        cumulative = 0
        for variant in enabled_variants:
            cumulative += int(variant.weight or 0)
            if bucket < cumulative:
                return Variant(name=variant.name, enabled=True, payload=variant.payload)
        return Variant(name="control", enabled=True)

    def check(self, flag_name: str, ctx: FeatureFlagContext) -> dict[str, Any]:
        enabled, matched_strategy = self.evaluate(flag_name, ctx)
        variant = self.get_variant(flag_name, ctx)
        return {
            "flag_name": flag_name,
            "enabled": enabled,
            "variant": asdict(variant),
            "matched_strategy": (
                {"type": matched_strategy.type.value, "parameters": matched_strategy.parameters}
                if matched_strategy is not None else None
            ),
        }

    def list_changelog(self, *, limit: int = 100, name: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT * FROM feature_flag_changelog"
        params: list[Any] = []
        if name:
            sql += " WHERE name = ?"
            params.append(name)
        sql += " ORDER BY changed_at DESC LIMIT ?"
        params.append(max(1, min(int(limit), 500)))
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        items = []
        for row in rows:
            payload = dict(row)
            payload["old_value"] = json.loads(payload["old_value_json"]) if payload.get("old_value_json") else None
            payload["new_value"] = json.loads(payload["new_value_json"]) if payload.get("new_value_json") else None
            payload.pop("old_value_json", None)
            payload.pop("new_value_json", None)
            items.append(payload)
        return items

    def export_snapshot(self, *, environment: Environment | str | None = None) -> dict[str, Any]:
        flags = [flag.to_dict() for flag in self.list_flags(environment=environment)]
        return {"exported_at": _utc_now(), "flags": flags}

    def import_snapshot(self, payload: dict[str, Any], *, changed_by: str = "system") -> int:
        count = 0
        for item in payload.get("flags", []):
            flag = FeatureFlag(
                name=str(item["name"]),
                enabled=bool(item.get("enabled", False)),
                environment=Environment(str(item.get("environment", Environment.PROD.value))),
                strategies=[
                    FlagStrategy(type=StrategyType(str(strategy.get("type", StrategyType.ALL.value))), parameters=dict(strategy.get("parameters") or {}))
                    for strategy in item.get("strategies", [])
                ] or [FlagStrategy(type=StrategyType.ALL)],
                variants=[
                    FlagVariant(
                        name=str(variant.get("name") or ""),
                        weight=int(variant.get("weight", 0) or 0),
                        payload=variant.get("payload"),
                        enabled=bool(variant.get("enabled", True)),
                    )
                    for variant in item.get("variants", [])
                    if str(variant.get("name") or "").strip()
                ],
                description=str(item.get("description", "")),
                tags=[str(tag) for tag in item.get("tags", []) if str(tag).strip()],
                tenant_id=str(item.get("tenant_id") or "").strip() or None,
                created_by=str(item.get("created_by", changed_by)),
                created_at=str(item.get("created_at", _utc_now())),
                updated_at=str(item.get("updated_at", _utc_now())),
                is_builtin=bool(item.get("is_builtin", False)),
            )
            self.upsert_flag(flag, changed_by=changed_by)
            count += 1
        return count


_cache: FeatureFlagCache | None = None


def get_feature_flag_client() -> FeatureFlagCache:
    global _cache
    if _cache is None:
        _cache = FeatureFlagCache()
    return _cache


def ff_is_enabled(flag_name: str, ctx: FeatureFlagContext) -> bool:
    return get_feature_flag_client().is_enabled(flag_name, ctx)


def ff_get_variant(flag_name: str, ctx: FeatureFlagContext) -> Variant:
    return get_feature_flag_client().get_variant(flag_name, ctx)


def lobster_flag_ctx(tenant_id: str, lobster_id: str, env: str = "prod", user_id: str = "") -> FeatureFlagContext:
    return FeatureFlagContext(
        tenant_id=str(tenant_id or "").strip(),
        lobster_id=str(lobster_id or "").strip(),
        user_id=str(user_id or "").strip(),
        environment=Environment(str(env or "prod")),
    )


def is_lobster_globally_enabled(ctx: FeatureFlagContext) -> bool:
    return ff_is_enabled("lobster.pool.all_enabled", ctx)


def is_lobster_enabled(lobster_name: str, ctx: FeatureFlagContext) -> bool:
    return is_lobster_globally_enabled(ctx) and ff_is_enabled(f"lobster.{lobster_name}.enabled", ctx)
