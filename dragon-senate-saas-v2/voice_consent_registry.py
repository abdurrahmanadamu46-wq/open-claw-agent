from __future__ import annotations

import json
import os
import sqlite3
import uuid
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    raw = str(os.getenv("VOICE_CONSENT_DB_PATH") or "data/voice_consents.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@dataclass(slots=True)
class VoiceConsent:
    consent_id: str
    tenant_id: str
    owner_name: str
    owner_type: str
    consent_doc_id: str
    scope: str
    reference_audio_path: str
    status: str = "review"
    notes: str = ""
    meta: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)
    review_note: str = ""
    reviewed_by: str = ""
    reviewed_at: str = ""
    revoked_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class VoiceConsentRegistry:
    def __init__(self) -> None:
        self._path = _db_path()
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS voice_consents (
                    consent_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    owner_name TEXT NOT NULL,
                    owner_type TEXT NOT NULL,
                    consent_doc_id TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    reference_audio_path TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    notes TEXT NOT NULL DEFAULT '',
                    meta_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    review_note TEXT NOT NULL DEFAULT '',
                    reviewed_by TEXT NOT NULL DEFAULT '',
                    reviewed_at TEXT NOT NULL DEFAULT '',
                    revoked_at TEXT NOT NULL DEFAULT ''
                );

                CREATE INDEX IF NOT EXISTS idx_voice_consents_tenant
                    ON voice_consents(tenant_id, updated_at DESC);
                """
            )
            columns = {str(row["name"]) for row in conn.execute("PRAGMA table_info(voice_consents)").fetchall()}
            if "review_note" not in columns:
                conn.execute("ALTER TABLE voice_consents ADD COLUMN review_note TEXT NOT NULL DEFAULT ''")
            if "reviewed_by" not in columns:
                conn.execute("ALTER TABLE voice_consents ADD COLUMN reviewed_by TEXT NOT NULL DEFAULT ''")
            if "reviewed_at" not in columns:
                conn.execute("ALTER TABLE voice_consents ADD COLUMN reviewed_at TEXT NOT NULL DEFAULT ''")
            conn.commit()

    def _row_to_consent(self, row: sqlite3.Row) -> VoiceConsent:
        try:
            meta = json.loads(str(row["meta_json"] or "{}"))
            if not isinstance(meta, dict):
                meta = {}
        except json.JSONDecodeError:
            meta = {}
        return VoiceConsent(
            consent_id=str(row["consent_id"]),
            tenant_id=str(row["tenant_id"]),
            owner_name=str(row["owner_name"]),
            owner_type=str(row["owner_type"]),
            consent_doc_id=str(row["consent_doc_id"]),
            scope=str(row["scope"]),
            reference_audio_path=str(row["reference_audio_path"]),
            status=str(row["status"] or "active"),
            notes=str(row["notes"] or ""),
            meta=meta,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            review_note=str(row["review_note"] or ""),
            reviewed_by=str(row["reviewed_by"] or ""),
            reviewed_at=str(row["reviewed_at"] or ""),
            revoked_at=str(row["revoked_at"] or ""),
        )

    def list_consents(self, tenant_id: str) -> list[VoiceConsent]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM voice_consents WHERE tenant_id = ? ORDER BY updated_at DESC",
                (tenant_id,),
            ).fetchall()
        return [self._row_to_consent(row) for row in rows]

    def get_consent(self, consent_id: str) -> VoiceConsent | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM voice_consents WHERE consent_id = ?",
                (str(consent_id),),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_consent(row)

    def create_consent(
        self,
        *,
        tenant_id: str,
        owner_name: str,
        owner_type: str,
        consent_doc_id: str,
        scope: str,
        reference_audio_path: str,
        notes: str = "",
        meta: dict[str, Any] | None = None,
    ) -> VoiceConsent:
        consent = VoiceConsent(
            consent_id=f"consent_{uuid.uuid4().hex[:12]}",
            tenant_id=tenant_id,
            owner_name=str(owner_name).strip()[:160],
            owner_type=str(owner_type).strip()[:64],
            consent_doc_id=str(consent_doc_id).strip()[:128],
            scope=str(scope).strip()[:128],
            reference_audio_path=str(reference_audio_path).strip(),
            status="review",
            notes=str(notes or "").strip()[:1000],
            meta=dict(meta or {}),
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO voice_consents(
                    consent_id, tenant_id, owner_name, owner_type, consent_doc_id, scope, reference_audio_path,
                    status, notes, meta_json, created_at, updated_at, review_note, reviewed_by, reviewed_at, revoked_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    consent.consent_id,
                    consent.tenant_id,
                    consent.owner_name,
                    consent.owner_type,
                    consent.consent_doc_id,
                    consent.scope,
                    consent.reference_audio_path,
                    consent.status,
                    consent.notes,
                    json.dumps(consent.meta, ensure_ascii=False),
                    consent.created_at,
                    consent.updated_at,
                    consent.review_note,
                    consent.reviewed_by,
                    consent.reviewed_at,
                    consent.revoked_at,
                ),
            )
            conn.commit()
        return consent

    def revoke_consent(self, consent_id: str) -> bool:
        now = _utc_now()
        with self._connect() as conn:
            updated = conn.execute(
                """
                UPDATE voice_consents
                SET status = 'revoked', updated_at = ?, reviewed_at = ?, revoked_at = ?
                WHERE consent_id = ?
                """,
                (now, now, now, str(consent_id)),
            ).rowcount
            conn.commit()
        return bool(updated)

    def set_review_status(
        self,
        consent_id: str,
        *,
        status: str,
        reviewer: str,
        note: str = "",
    ) -> bool:
        now = _utc_now()
        normalized = str(status or "").strip().lower()
        if normalized not in {"review", "active", "rejected", "revoked"}:
            raise ValueError("invalid_voice_consent_status")
        revoked_at = now if normalized == "revoked" else ""
        with self._connect() as conn:
            updated = conn.execute(
                """
                UPDATE voice_consents
                SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?, revoked_at = ?
                WHERE consent_id = ?
                """,
                (normalized, str(note or "")[:1000], str(reviewer or "")[:128], now, now, revoked_at, str(consent_id)),
            ).rowcount
            conn.commit()
        return bool(updated)


_registry: VoiceConsentRegistry | None = None


def get_voice_consent_registry() -> VoiceConsentRegistry:
    global _registry
    if _registry is None:
        _registry = VoiceConsentRegistry()
    return _registry
