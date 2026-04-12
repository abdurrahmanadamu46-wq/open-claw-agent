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
    raw = str(os.getenv("VOICE_PROFILE_DB_PATH") or "data/voice_profiles.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@dataclass(slots=True)
class VoiceProfile:
    profile_id: str
    tenant_id: str
    name: str
    owner_type: str
    reference_audio_path: str
    voice_prompt: str = ""
    language: str = "zh"
    sample_rate: int = 48000
    consent_doc_id: str = ""
    clone_enabled: bool = False
    enabled: bool = True
    tags: list[str] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class VoiceProfileRegistry:
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
                CREATE TABLE IF NOT EXISTS voice_profiles (
                    profile_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    owner_type TEXT NOT NULL,
                    reference_audio_path TEXT NOT NULL,
                    voice_prompt TEXT NOT NULL DEFAULT '',
                    language TEXT NOT NULL DEFAULT 'zh',
                    sample_rate INTEGER NOT NULL DEFAULT 48000,
                    consent_doc_id TEXT NOT NULL DEFAULT '',
                    clone_enabled INTEGER NOT NULL DEFAULT 0,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    meta_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_voice_profiles_tenant
                    ON voice_profiles(tenant_id, updated_at DESC);
                """
            )
            conn.commit()

    def _row_to_profile(self, row: sqlite3.Row) -> VoiceProfile:
        try:
            tags = json.loads(str(row["tags_json"] or "[]"))
            if not isinstance(tags, list):
                tags = []
        except json.JSONDecodeError:
            tags = []
        try:
            meta = json.loads(str(row["meta_json"] or "{}"))
            if not isinstance(meta, dict):
                meta = {}
        except json.JSONDecodeError:
            meta = {}
        return VoiceProfile(
            profile_id=str(row["profile_id"]),
            tenant_id=str(row["tenant_id"]),
            name=str(row["name"]),
            owner_type=str(row["owner_type"]),
            reference_audio_path=str(row["reference_audio_path"]),
            voice_prompt=str(row["voice_prompt"] or ""),
            language=str(row["language"] or "zh"),
            sample_rate=int(row["sample_rate"] or 48000),
            consent_doc_id=str(row["consent_doc_id"] or ""),
            clone_enabled=bool(int(row["clone_enabled"] or 0)),
            enabled=bool(int(row["enabled"] or 0)),
            tags=[str(item) for item in tags if str(item).strip()],
            meta=meta,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    def list_profiles(self, tenant_id: str) -> list[VoiceProfile]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM voice_profiles WHERE tenant_id = ? ORDER BY updated_at DESC",
                (tenant_id,),
            ).fetchall()
        return [self._row_to_profile(row) for row in rows]

    def get_profile(self, profile_id: str) -> VoiceProfile | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM voice_profiles WHERE profile_id = ?",
                (str(profile_id),),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_profile(row)

    def create_profile(
        self,
        *,
        tenant_id: str,
        name: str,
        owner_type: str,
        reference_audio_path: str,
        voice_prompt: str = "",
        language: str = "zh",
        sample_rate: int = 48000,
        consent_doc_id: str = "",
        clone_enabled: bool = False,
        tags: list[str] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> VoiceProfile:
        profile = VoiceProfile(
            profile_id=f"vp_{uuid.uuid4().hex[:12]}",
            tenant_id=tenant_id,
            name=str(name).strip()[:160],
            owner_type=str(owner_type).strip()[:64],
            reference_audio_path=str(reference_audio_path).strip(),
            voice_prompt=str(voice_prompt or "").strip()[:2000],
            language=str(language or "zh").strip()[:16] or "zh",
            sample_rate=max(16000, min(int(sample_rate or 48000), 48000)),
            consent_doc_id=str(consent_doc_id or "").strip()[:128],
            clone_enabled=bool(clone_enabled),
            enabled=True,
            tags=[str(item).strip()[:64] for item in (tags or []) if str(item).strip()],
            meta=dict(meta or {}),
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO voice_profiles(
                    profile_id, tenant_id, name, owner_type, reference_audio_path, voice_prompt, language,
                    sample_rate, consent_doc_id, clone_enabled, enabled, tags_json, meta_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    profile.profile_id,
                    profile.tenant_id,
                    profile.name,
                    profile.owner_type,
                    profile.reference_audio_path,
                    profile.voice_prompt,
                    profile.language,
                    profile.sample_rate,
                    profile.consent_doc_id,
                    1 if profile.clone_enabled else 0,
                    1 if profile.enabled else 0,
                    json.dumps(profile.tags, ensure_ascii=False),
                    json.dumps(profile.meta, ensure_ascii=False),
                    profile.created_at,
                    profile.updated_at,
                ),
            )
            conn.commit()
        return profile

    def disable_profile(self, profile_id: str) -> bool:
        now = _utc_now()
        with self._connect() as conn:
            updated = conn.execute(
                "UPDATE voice_profiles SET enabled = 0, updated_at = ? WHERE profile_id = ?",
                (now, str(profile_id)),
            ).rowcount
            conn.commit()
        return bool(updated)


_registry: VoiceProfileRegistry | None = None


def get_voice_profile_registry() -> VoiceProfileRegistry:
    global _registry
    if _registry is None:
        _registry = VoiceProfileRegistry()
    return _registry
