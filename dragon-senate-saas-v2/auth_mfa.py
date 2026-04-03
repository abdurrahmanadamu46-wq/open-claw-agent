from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
import struct
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    raw = os.getenv("AUTH_MFA_DB_PATH", "data/auth_mfa.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _issuer() -> str:
    return os.getenv("AUTH_MFA_ISSUER", "Dragon Senate").strip() or "Dragon Senate"


def _normalize_key(secret: str) -> bytes:
    padded = secret.strip().upper()
    missing = len(padded) % 8
    if missing:
        padded += "=" * (8 - missing)
    return base64.b32decode(padded.encode("utf-8"), casefold=True)


def _generate_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("utf-8").rstrip("=")


def _totp_code(secret: str, timestamp: int | None = None, step: int = 30, digits: int = 6) -> str:
    ts = int(timestamp or datetime.now(timezone.utc).timestamp())
    counter = ts // max(1, int(step))
    key = _normalize_key(secret)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % (10**digits)
    return str(code_int).zfill(digits)


@dataclass(slots=True)
class MfaStatus:
    tenant_id: str
    user_id: str
    enabled: bool = False
    pending: bool = False
    secret: str = ""
    created_at: str = ""
    updated_at: str = ""
    last_verified_at: str = ""

    def otpauth_uri(self) -> str:
        label = urllib.parse.quote(f"{_issuer()}:{self.user_id}")
        issuer = urllib.parse.quote(_issuer())
        return f"otpauth://totp/{label}?secret={self.secret}&issuer={issuer}&digits=6&period=30"

    def to_dict(self, include_secret: bool = False) -> dict[str, object]:
        payload: dict[str, object] = {
            "tenant_id": self.tenant_id,
            "user_id": self.user_id,
            "enabled": self.enabled,
            "pending": self.pending,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_verified_at": self.last_verified_at or None,
        }
        if include_secret:
            payload["secret"] = self.secret
            payload["otpauth_uri"] = self.otpauth_uri()
        return payload


class MfaStore:
    def __init__(self) -> None:
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(_db_path()))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS auth_mfa_settings (
                    tenant_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    secret TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 0,
                    pending INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_verified_at TEXT,
                    PRIMARY KEY (tenant_id, user_id)
                );
                """
            )
            conn.commit()

    def get_status(self, tenant_id: str, user_id: str) -> MfaStatus:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM auth_mfa_settings WHERE tenant_id = ? AND user_id = ?",
                (tenant_id, user_id),
            ).fetchone()
        if row is None:
            return MfaStatus(tenant_id=tenant_id, user_id=user_id)
        return MfaStatus(
            tenant_id=str(row["tenant_id"]),
            user_id=str(row["user_id"]),
            secret=str(row["secret"] or ""),
            enabled=bool(int(row["enabled"] or 0)),
            pending=bool(int(row["pending"] or 0)),
            created_at=str(row["created_at"] or ""),
            updated_at=str(row["updated_at"] or ""),
            last_verified_at=str(row["last_verified_at"] or ""),
        )

    def begin_setup(self, tenant_id: str, user_id: str) -> MfaStatus:
        now = _utc_now()
        status = MfaStatus(
            tenant_id=tenant_id,
            user_id=user_id,
            secret=_generate_secret(),
            enabled=False,
            pending=True,
            created_at=now,
            updated_at=now,
            last_verified_at="",
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO auth_mfa_settings(tenant_id, user_id, secret, enabled, pending, created_at, updated_at, last_verified_at)
                VALUES (?, ?, ?, 0, 1, ?, ?, NULL)
                ON CONFLICT(tenant_id, user_id) DO UPDATE SET
                    secret = excluded.secret,
                    enabled = 0,
                    pending = 1,
                    updated_at = excluded.updated_at,
                    last_verified_at = NULL
                """,
                (tenant_id, user_id, status.secret, now, now),
            )
            conn.commit()
        return status

    def verify_code(self, tenant_id: str, user_id: str, code: str, *, allow_pending: bool = True) -> bool:
        status = self.get_status(tenant_id, user_id)
        if not status.secret:
            return False
        if not allow_pending and not status.enabled:
            return False
        normalized = str(code or "").strip().replace(" ", "")
        if not normalized.isdigit():
            return False
        now_ts = int(datetime.now(timezone.utc).timestamp())
        for offset in (-30, 0, 30):
            if _totp_code(status.secret, timestamp=now_ts + offset) == normalized:
                return True
        return False

    def enable(self, tenant_id: str, user_id: str, code: str) -> MfaStatus | None:
        if not self.verify_code(tenant_id, user_id, code, allow_pending=True):
            return None
        now = _utc_now()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE auth_mfa_settings
                SET enabled = 1, pending = 0, updated_at = ?, last_verified_at = ?
                WHERE tenant_id = ? AND user_id = ?
                """,
                (now, now, tenant_id, user_id),
            )
            conn.commit()
        return self.get_status(tenant_id, user_id)

    def disable(self, tenant_id: str, user_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM auth_mfa_settings WHERE tenant_id = ? AND user_id = ?",
                (tenant_id, user_id),
            )
            conn.commit()

    def mark_verified(self, tenant_id: str, user_id: str) -> None:
        now = _utc_now()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE auth_mfa_settings
                SET updated_at = ?, last_verified_at = ?
                WHERE tenant_id = ? AND user_id = ? AND enabled = 1
                """,
                (now, now, tenant_id, user_id),
            )
            conn.commit()

    def is_enabled(self, tenant_id: str, user_id: str) -> bool:
        status = self.get_status(tenant_id, user_id)
        return bool(status.enabled)


_store: MfaStore | None = None


def get_mfa_store() -> MfaStore:
    global _store
    if _store is None:
        _store = MfaStore()
    return _store
