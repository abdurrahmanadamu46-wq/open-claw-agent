"""
Tenant white-label branding configuration.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


@dataclass
class WhiteLabelConfig:
    tenant_id: str
    brand_name: str = "龙虾池"
    brand_logo_url: str | None = None
    brand_favicon_url: str | None = None
    brand_primary_color: str = "#E5A93D"
    brand_secondary_color: str = "#38BDF8"
    brand_bg_color: str = "#0F172A"
    brand_text_color: str = "#F8FAFC"
    custom_domain: str | None = None
    login_slogan: str | None = None
    login_bg_image_url: str | None = None
    support_email: str | None = None
    support_phone: str | None = None
    hide_powered_by: bool = True
    email_from_name: str | None = None
    email_from_address: str | None = None
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)


class WhiteLabelManager:
    CACHE_TTL_SEC = 300

    def __init__(self, db_path: str | None = None, asset_dir: str | None = None) -> None:
        raw_db = db_path or os.getenv("WHITE_LABEL_DB_PATH", "data/white_label.sqlite")
        self._db_path = Path(raw_db)
        if not self._db_path.is_absolute():
            self._db_path = (Path(__file__).resolve().parent / self._db_path).resolve()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)

        raw_asset = asset_dir or os.getenv("WHITE_LABEL_ASSET_DIR", "data/white_label_assets")
        self._asset_dir = Path(raw_asset)
        if not self._asset_dir.is_absolute():
            self._asset_dir = (Path(__file__).resolve().parent / self._asset_dir).resolve()
        self._asset_dir.mkdir(parents=True, exist_ok=True)

        self._cache: dict[str, tuple[float, WhiteLabelConfig]] = {}
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS white_label_configs (
                    tenant_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def _default_config(self, tenant_id: str) -> WhiteLabelConfig:
        return WhiteLabelConfig(tenant_id=tenant_id)

    def _row_to_config(self, row: sqlite3.Row | None, tenant_id: str) -> WhiteLabelConfig:
        if row is None:
            return self._default_config(tenant_id)
        payload = json.loads(str(row["payload_json"] or "{}"))
        payload["tenant_id"] = tenant_id
        payload.setdefault("created_at", str(row["created_at"] or _utc_now()))
        payload.setdefault("updated_at", str(row["updated_at"] or _utc_now()))
        return WhiteLabelConfig(**payload)

    def get_config(self, tenant_id: str) -> WhiteLabelConfig:
        normalized = str(tenant_id or "").strip() or "tenant_main"
        cached = self._cache.get(normalized)
        if cached and (time.time() - cached[0]) < self.CACHE_TTL_SEC:
            return cached[1]
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM white_label_configs WHERE tenant_id = ?",
                (normalized,),
            ).fetchone()
        config = self._row_to_config(row, normalized)
        self._cache[normalized] = (time.time(), config)
        return config

    def save_config(self, config: WhiteLabelConfig) -> WhiteLabelConfig:
        normalized = self.get_config(config.tenant_id)
        payload = asdict(config)
        payload["tenant_id"] = normalized.tenant_id
        payload["created_at"] = normalized.created_at or payload.get("created_at") or _utc_now()
        payload["updated_at"] = _utc_now()
        saved = WhiteLabelConfig(**payload)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO white_label_configs(tenant_id, payload_json, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(tenant_id) DO UPDATE SET
                    payload_json=excluded.payload_json,
                    updated_at=excluded.updated_at
                """,
                (
                    saved.tenant_id,
                    json.dumps(asdict(saved), ensure_ascii=False),
                    saved.created_at,
                    saved.updated_at,
                ),
            )
            conn.commit()
        self._cache[saved.tenant_id] = (time.time(), saved)
        return saved

    def delete_config(self, tenant_id: str) -> bool:
        normalized = str(tenant_id or "").strip() or "tenant_main"
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM white_label_configs WHERE tenant_id = ?", (normalized,))
            conn.commit()
        self._cache.pop(normalized, None)
        return bool(cur.rowcount)

    def upload_asset(self, tenant_id: str, filename: str, content: bytes, asset_type: str = "logo") -> str:
        normalized_tenant = str(tenant_id or "").strip() or "tenant_main"
        safe_name = Path(filename or f"{asset_type}.bin").name
        asset_path = self._asset_dir / normalized_tenant
        asset_path.mkdir(parents=True, exist_ok=True)
        target = asset_path / f"{asset_type}_{safe_name}"
        target.write_bytes(content)
        return f"/white-label-assets/{normalized_tenant}/{target.name}"

    def get_css_vars(self, tenant_id: str) -> dict[str, str]:
        config = self.get_config(tenant_id)
        return {
            "--brand-primary": config.brand_primary_color,
            "--brand-secondary": config.brand_secondary_color,
            "--brand-bg": config.brand_bg_color,
            "--brand-text": config.brand_text_color,
        }

    def get_meta_tags(self, tenant_id: str) -> dict[str, str | None]:
        config = self.get_config(tenant_id)
        return {
            "title": config.brand_name,
            "favicon": config.brand_favicon_url,
            "description": config.login_slogan,
        }

    def resolve_tenant(self, *, tenant_id: str | None = None, host: str | None = None) -> str:
        if str(tenant_id or "").strip():
            return str(tenant_id).strip()
        normalized_host = str(host or "").strip().lower()
        if normalized_host:
            with self._connect() as conn:
                rows = conn.execute("SELECT tenant_id, payload_json FROM white_label_configs").fetchall()
            for row in rows:
                payload = json.loads(str(row["payload_json"] or "{}"))
                if str(payload.get("custom_domain") or "").strip().lower() == normalized_host:
                    return str(row["tenant_id"])
        return "tenant_main"


_manager: WhiteLabelManager | None = None


def get_white_label_manager() -> WhiteLabelManager:
    global _manager
    if _manager is None:
        _manager = WhiteLabelManager()
    return _manager
