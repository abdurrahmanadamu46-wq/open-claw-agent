"""
Policy bundle manager inspired by OPA bundle distribution.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from policy_engine import GLOBAL_TENANT, get_policy_engine

REPO_ROOT = Path(__file__).resolve().parent
DB_PATH = REPO_ROOT / "data" / "policy_bundles.sqlite"
EXPORT_DIR = REPO_ROOT / "config" / "policy-bundles"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)


def _bundle_version() -> str:
    return datetime.now(timezone.utc).strftime("v%Y%m%d%H%M%S")


def _tenant_export_name(tenant_id: str) -> str:
    return "__global__" if tenant_id == GLOBAL_TENANT else tenant_id.replace("/", "_")


@dataclass(slots=True)
class PolicyBundle:
    bundle_id: str
    tenant_id: str
    version: str
    rules: list[dict[str, Any]]
    checksum: str
    rule_count: int
    published_by: str = "system"
    notes: str = ""
    created_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class PolicyBundleManager:
    def __init__(self, db_path: Path | None = None) -> None:
        self._db_path = db_path or DB_PATH
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS policy_bundles (
                    bundle_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    version TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    rule_count INTEGER NOT NULL DEFAULT 0,
                    rules_json TEXT NOT NULL DEFAULT '[]',
                    published_by TEXT NOT NULL DEFAULT 'system',
                    notes TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_policy_bundles_tenant_created
                    ON policy_bundles(tenant_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS policy_bundle_state (
                    tenant_id TEXT PRIMARY KEY,
                    bundle_id TEXT NOT NULL,
                    version TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            conn.commit()

    def publish(
        self,
        *,
        tenant_id: str = "tenant_main",
        version: str | None = None,
        published_by: str = "system",
        notes: str = "",
        policy_paths: list[str] | None = None,
        force: bool = False,
    ) -> dict[str, Any]:
        target_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        rules = self._effective_rules(target_tenant, policy_paths=policy_paths)
        checksum = hashlib.sha256(_json_dumps(rules).encode("utf-8")).hexdigest()[:16]
        current = self._current_state(target_tenant)
        if current and current.get("checksum") == checksum and not force:
            bundle = self.get_bundle(str(current["bundle_id"]))
            if bundle is not None:
                return bundle
        bundle = PolicyBundle(
            bundle_id=f"bundle_{uuid.uuid4().hex[:12]}",
            tenant_id=target_tenant,
            version=str(version or _bundle_version()),
            rules=rules,
            checksum=checksum,
            rule_count=len(rules),
            published_by=str(published_by or "system"),
            notes=str(notes or ""),
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO policy_bundles(
                    bundle_id, tenant_id, version, checksum, rule_count,
                    rules_json, published_by, notes, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    bundle.bundle_id,
                    bundle.tenant_id,
                    bundle.version,
                    bundle.checksum,
                    bundle.rule_count,
                    _json_dumps(bundle.rules),
                    bundle.published_by,
                    bundle.notes,
                    bundle.created_at,
                ),
            )
            conn.execute(
                """
                INSERT INTO policy_bundle_state(tenant_id, bundle_id, version, checksum, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id) DO UPDATE SET
                    bundle_id=excluded.bundle_id,
                    version=excluded.version,
                    checksum=excluded.checksum,
                    updated_at=excluded.updated_at
                """,
                (
                    bundle.tenant_id,
                    bundle.bundle_id,
                    bundle.version,
                    bundle.checksum,
                    bundle.created_at,
                ),
            )
            conn.commit()
        self._export_bundle(bundle)
        return bundle.to_dict()

    def current_bundle(self, tenant_id: str = "tenant_main") -> dict[str, Any]:
        target_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        expected_checksum = hashlib.sha256(
            _json_dumps(self._effective_rules(target_tenant)).encode("utf-8")
        ).hexdigest()[:16]
        current = self._current_state(target_tenant)
        if current is None or str(current.get("checksum") or "") != expected_checksum:
            return self.publish(
                tenant_id=target_tenant,
                published_by="system",
                notes="auto_refresh",
                force=True,
            )
        bundle = self.get_bundle(str(current["bundle_id"]))
        if bundle is None:
            return self.publish(
                tenant_id=target_tenant,
                published_by="system",
                notes="rebuild_missing_bundle",
                force=True,
            )
        return bundle

    def list_bundles(self, tenant_id: str = "tenant_main", *, limit: int = 20) -> list[dict[str, Any]]:
        target_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                  FROM policy_bundles
                 WHERE tenant_id = ?
              ORDER BY created_at DESC
                 LIMIT ?
                """,
                (target_tenant, limit),
            ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def get_bundle(self, bundle_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM policy_bundles WHERE bundle_id = ?", (bundle_id,)).fetchone()
        return self._row_to_dict(row) if row else None

    def _current_state(self, tenant_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM policy_bundle_state WHERE tenant_id = ?",
                (tenant_id,),
            ).fetchone()
        return dict(row) if row else None

    def _effective_rules(self, tenant_id: str, *, policy_paths: list[str] | None = None) -> list[dict[str, Any]]:
        items = get_policy_engine().list_rules(
            tenant_id=tenant_id,
            include_disabled=False,
            effective=True,
        )
        if policy_paths:
            selected = {str(item).strip() for item in policy_paths if str(item).strip()}
            items = [item for item in items if item.get("policy_path") in selected]
        return items

    def _export_bundle(self, bundle: PolicyBundle) -> None:
        export_path = EXPORT_DIR / f"{_tenant_export_name(bundle.tenant_id)}.json"
        export_path.write_text(_json_dumps(bundle.to_dict()), encoding="utf-8")

    def _row_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "bundle_id": str(row["bundle_id"]),
            "tenant_id": str(row["tenant_id"]),
            "version": str(row["version"]),
            "checksum": str(row["checksum"]),
            "rule_count": int(row["rule_count"] or 0),
            "rules": json.loads(str(row["rules_json"] or "[]")),
            "published_by": str(row["published_by"] or "system"),
            "notes": str(row["notes"] or ""),
            "created_at": str(row["created_at"]),
        }


_policy_bundle_manager: PolicyBundleManager | None = None


def get_policy_bundle_manager() -> PolicyBundleManager:
    global _policy_bundle_manager
    if _policy_bundle_manager is None:
        _policy_bundle_manager = PolicyBundleManager()
    return _policy_bundle_manager
