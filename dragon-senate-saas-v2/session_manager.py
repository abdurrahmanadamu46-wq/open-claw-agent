"""
Session isolation manager for lobster conversations.

Supports:
1. per-peer: one peer + one lobster => one persistent session
2. isolated: one-off ephemeral session, never persisted
3. shared: one lobster shared across peers inside a tenant
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("session_manager")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class SessionContext:
    """Conversation state for one isolation bucket."""

    session_id: str
    peer_id: str
    lobster_id: str
    tenant_id: str = "default"
    channel: str = "websocket"
    mode: str = "shared"
    messages: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=_utc_now)
    last_active_at: str = field(default_factory=_utc_now)
    message_count: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


class SessionManager:
    """Manage persistent and ephemeral session contexts."""

    def __init__(self, storage_dir: str = "data/sessions"):
        self._storage = Path(storage_dir)
        self._storage.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, SessionContext] = {}
        self._index_existing_sessions()

    def _index_existing_sessions(self) -> None:
        for path in self._storage.glob("*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8-sig"))
                session = SessionContext(**payload)
                self._sessions[session.session_id] = session
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to preload session %s: %s", path.name, exc)

    def _make_session_id(self, peer_id: str, lobster_id: str, mode: str, tenant_id: str) -> str:
        normalized_mode = self._normalize_mode(mode)
        if normalized_mode == "isolated":
            seed = f"isolated:{tenant_id}:{peer_id}:{lobster_id}:{_utc_now()}"
        elif normalized_mode == "per-peer":
            seed = f"peer:{tenant_id}:{peer_id}:{lobster_id}"
        else:
            seed = f"shared:{tenant_id}:{lobster_id}"
        return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def _normalize_mode(mode: str | None) -> str:
        raw = str(mode or "shared").strip().lower()
        if raw in {"per-peer", "per_peer", "peer"}:
            return "per-peer"
        if raw in {"isolated", "isolate"}:
            return "isolated"
        return "shared"

    def get_or_create(
        self,
        *,
        peer_id: str,
        lobster_id: str,
        mode: str = "per-peer",
        channel: str = "websocket",
        tenant_id: str = "default",
        session_id: str | None = None,
    ) -> SessionContext:
        normalized_mode = self._normalize_mode(mode)
        resolved_session_id = session_id or self._make_session_id(peer_id, lobster_id, normalized_mode, tenant_id)

        session = self._sessions.get(resolved_session_id)
        if session is not None:
            session.last_active_at = _utc_now()
            return session

        path = self._storage / f"{resolved_session_id}.json"
        if normalized_mode != "isolated" and path.exists():
            try:
                session = SessionContext(**json.loads(path.read_text(encoding="utf-8-sig")))
                session.last_active_at = _utc_now()
                self._sessions[resolved_session_id] = session
                return session
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to load session %s: %s", resolved_session_id, exc)

        session = SessionContext(
            session_id=resolved_session_id,
            peer_id=peer_id,
            lobster_id=lobster_id,
            tenant_id=tenant_id,
            channel=channel,
            mode=normalized_mode,
        )
        self._sessions[resolved_session_id] = session
        if normalized_mode != "isolated":
            self._persist(session)
        logger.info(
            "Created %s session %s for tenant=%s peer=%s lobster=%s",
            normalized_mode,
            resolved_session_id,
            tenant_id,
            peer_id,
            lobster_id,
        )
        return session

    def append_message(self, session_id: str, *, role: str, content: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            logger.warning("Session %s not found while appending message", session_id)
            return
        session.messages.append(
            {
                "role": str(role or "unknown"),
                "content": str(content or ""),
                "timestamp": _utc_now(),
            }
        )
        session.message_count = len(session.messages)
        session.last_active_at = _utc_now()
        if session.mode != "isolated":
            self._persist(session)

    def get_session(self, session_id: str) -> SessionContext | None:
        session = self._sessions.get(session_id)
        if session is not None:
            return session
        path = self._storage / f"{session_id}.json"
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
            session = SessionContext(**payload)
            self._sessions[session.session_id] = session
            return session
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to read session %s: %s", session_id, exc)
            return None

    def set_metadata(self, session_id: str, metadata: dict[str, Any]) -> bool:
        session = self.get_session(session_id)
        if session is None:
            return False
        session.metadata = dict(metadata or {})
        session.last_active_at = _utc_now()
        if session.mode != "isolated":
            self._persist(session)
        return True

    def update_metadata(self, session_id: str, updates: dict[str, Any]) -> bool:
        session = self.get_session(session_id)
        if session is None:
            return False
        current = dict(session.metadata or {})
        current.update(dict(updates or {}))
        session.metadata = current
        session.last_active_at = _utc_now()
        if session.mode != "isolated":
            self._persist(session)
        return True

    def get_history(self, session_id: str, limit: int = 50) -> list[dict[str, Any]]:
        session = self._sessions.get(session_id)
        if session is None:
            return []
        return [dict(item) for item in session.messages[-max(1, limit):]]

    def clear_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        path = self._storage / f"{session_id}.json"
        if path.exists():
            path.unlink()

    def list_sessions(self, peer_id: str | None = None, lobster_id: str | None = None) -> list[dict[str, Any]]:
        # Include persisted sessions that may not have been touched in-memory since boot.
        self._index_existing_sessions()
        result: list[dict[str, Any]] = []
        for session in self._sessions.values():
            if peer_id and session.peer_id != peer_id:
                continue
            if lobster_id and session.lobster_id != lobster_id:
                continue
            result.append(
                {
                    "session_id": session.session_id,
                    "peer_id": session.peer_id,
                    "lobster_id": session.lobster_id,
                    "tenant_id": session.tenant_id,
                    "channel": session.channel,
                    "mode": session.mode,
                    "message_count": session.message_count,
                    "last_active_at": session.last_active_at,
                }
            )
        result.sort(key=lambda item: str(item.get("last_active_at") or ""), reverse=True)
        return result

    def _persist(self, session: SessionContext) -> None:
        path = self._storage / f"{session.session_id}.json"
        path.write_text(json.dumps(asdict(session), ensure_ascii=False, indent=2), encoding="utf-8")


_session_manager: SessionManager | None = None


def get_session_manager() -> SessionManager:
    global _session_manager
    if _session_manager is None:
        _session_manager = SessionManager(storage_dir=os.getenv("SESSIONS_STORAGE_DIR", "data/sessions"))
    return _session_manager


def reset_session_manager() -> None:
    global _session_manager
    _session_manager = None
