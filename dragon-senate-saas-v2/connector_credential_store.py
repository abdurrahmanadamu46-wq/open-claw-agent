"""
ConnectorCredentialStore — 外部连接器凭证统一存储

借鉴 Onyx connectors/credentials_provider.py：
- 租户维度加密存储 OAuth / API Token
- 过期判断
- 按需刷新
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import sqlite3
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger("connector_credential_store")

DB_PATH = Path(os.getenv("CONNECTOR_CREDENTIAL_DB", "./data/connector_credentials.sqlite"))
SUPPORTED_CONNECTORS = {
    "feishu",
    "wecom",
    "dingtalk",
    "notion",
    "hubspot",
    "lark",
    "salesforce",
    "google_drive",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _secret() -> str:
    return (
        os.getenv("CONNECTOR_CREDENTIAL_SECRET", "").strip()
        or os.getenv("APP_SECRET", "").strip()
        or os.getenv("SECRET_KEY", "").strip()
        or "lobster-connector-credential-secret"
    )


def _fernet() -> Fernet:
    digest = hashlib.sha256(_secret().encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _mask_value(value: Any) -> Any:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) <= 8:
        return "*" * len(text)
    return f"{text[:3]}****{text[-3:]}"


def _parse_expiry(value: Any) -> float:
    if value in (None, "", 0):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        pass
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return 0.0


@dataclass(slots=True)
class ConnectorCredentialStatus:
    tenant_id: str
    connector: str
    present: bool
    expires_at: float = 0.0
    expired: bool = False
    updated_at: str = ""
    fields: list[str] | None = None
    has_refresh_token: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ConnectorCredentialStore:
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
                CREATE TABLE IF NOT EXISTS connector_credentials (
                    tenant_id TEXT NOT NULL,
                    connector TEXT NOT NULL,
                    credential_enc TEXT NOT NULL,
                    expires_at REAL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    updated_by TEXT DEFAULT 'system',
                    PRIMARY KEY (tenant_id, connector)
                );
                """
            )
            conn.commit()

    def save_credential(
        self,
        tenant_id: str,
        connector: str,
        credential: dict[str, Any],
        *,
        updated_by: str = "system",
    ) -> bool:
        safe_connector = str(connector or "").strip().lower()
        if safe_connector not in SUPPORTED_CONNECTORS:
            logger.warning("Unsupported connector credential save: %s", connector)
            return False
        payload = dict(credential or {})
        expires_at = max(
            _parse_expiry(payload.get("expires_at")),
            _parse_expiry(payload.get("expiry")),
            _parse_expiry(payload.get("expires_at_ts")),
        )
        encrypted = _fernet().encrypt(json.dumps(payload, ensure_ascii=False).encode("utf-8")).decode("utf-8")
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO connector_credentials (
                    tenant_id, connector, credential_enc, expires_at, updated_at, updated_by
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, connector) DO UPDATE SET
                    credential_enc=excluded.credential_enc,
                    expires_at=excluded.expires_at,
                    updated_at=excluded.updated_at,
                    updated_by=excluded.updated_by
                """,
                (
                    str(tenant_id or "tenant_main").strip() or "tenant_main",
                    safe_connector,
                    encrypted,
                    expires_at,
                    _utc_now(),
                    str(updated_by or "system"),
                ),
            )
            conn.commit()
        return True

    def get_credential(self, tenant_id: str, connector: str) -> dict[str, Any]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT credential_enc FROM connector_credentials WHERE tenant_id=? AND connector=?",
                (str(tenant_id or "tenant_main").strip() or "tenant_main", str(connector or "").strip().lower()),
            ).fetchone()
        if row is None:
            return {}
        try:
            text = _fernet().decrypt(str(row["credential_enc"]).encode("utf-8")).decode("utf-8")
            payload = json.loads(text)
            return payload if isinstance(payload, dict) else {}
        except InvalidToken:
            logger.warning("Failed to decrypt connector credential, fallback to empty payload")
            return {}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Connector credential decode failed: %s", exc)
            return {}

    def delete_credential(self, tenant_id: str, connector: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM connector_credentials WHERE tenant_id=? AND connector=?",
                (str(tenant_id or "tenant_main").strip() or "tenant_main", str(connector or "").strip().lower()),
            )
            conn.commit()
            return cur.rowcount > 0

    def list_statuses(self, tenant_id: str) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT tenant_id, connector
                FROM connector_credentials
                WHERE tenant_id=?
                ORDER BY connector ASC
                """,
                (str(tenant_id or "tenant_main").strip() or "tenant_main",),
            ).fetchall()
        return [self.get_status(str(row["tenant_id"]), str(row["connector"])) for row in rows]

    def get_status(self, tenant_id: str, connector: str) -> dict[str, Any]:
        safe_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        safe_connector = str(connector or "").strip().lower()
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT expires_at, updated_at
                FROM connector_credentials
                WHERE tenant_id=? AND connector=?
                """,
                (safe_tenant, safe_connector),
            ).fetchone()
        credential = self.get_credential(safe_tenant, safe_connector) if row else {}
        expires_at = float(row["expires_at"] or 0) if row else 0.0
        status = ConnectorCredentialStatus(
            tenant_id=safe_tenant,
            connector=safe_connector,
            present=row is not None,
            expires_at=expires_at,
            expired=bool(expires_at and time.time() >= expires_at),
            updated_at=str(row["updated_at"] or "") if row else "",
            fields=sorted(str(key) for key in credential.keys()),
            has_refresh_token=bool(credential.get("refresh_token")),
        )
        payload = status.to_dict()
        if credential:
            payload["masked_preview"] = {
                key: _mask_value(value)
                for key, value in credential.items()
                if isinstance(value, (str, int, float)) and key.lower() in {
                    "access_token",
                    "refresh_token",
                    "api_key",
                    "client_secret",
                    "tenant_key",
                    "app_secret",
                }
            }
        return payload

    def is_token_expired(self, tenant_id: str, connector: str, *, buffer_seconds: int = 300) -> bool:
        status = self.get_status(tenant_id, connector)
        expires_at = float(status.get("expires_at") or 0)
        if not expires_at:
            return False
        return time.time() + max(0, int(buffer_seconds)) >= expires_at

    def refresh_if_needed(
        self,
        tenant_id: str,
        connector: str,
        refresh_fn: Callable[[dict[str, Any]], dict[str, Any]],
        *,
        buffer_seconds: int = 300,
        updated_by: str = "system",
    ) -> dict[str, Any]:
        current = self.get_credential(tenant_id, connector)
        if not current:
            return {}
        if not self.is_token_expired(tenant_id, connector, buffer_seconds=buffer_seconds):
            return current
        refreshed = refresh_fn(dict(current))
        if not isinstance(refreshed, dict) or not refreshed:
            return current
        self.save_credential(tenant_id, connector, refreshed, updated_by=updated_by)
        return refreshed


_credential_store: ConnectorCredentialStore | None = None


def get_connector_credential_store() -> ConnectorCredentialStore:
    global _credential_store
    if _credential_store is None:
        _credential_store = ConnectorCredentialStore()
    return _credential_store
