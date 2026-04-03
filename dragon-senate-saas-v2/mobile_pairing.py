from __future__ import annotations

import json
import os
import secrets
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _state_path() -> Path:
    raw = os.getenv("MOBILE_PAIRING_STATE_PATH", "data/mobile_pairing_state.json").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _push_outbox_path() -> Path:
    raw = os.getenv("MOBILE_PUSH_OUTBOX_PATH", "data/mobile_push_outbox.jsonl").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@dataclass(slots=True)
class MobilePairCode:
    access_code: str
    tenant_id: str
    user_id: str
    roles: list[str]
    expires_at: str
    created_at: str = field(default_factory=_utc_now)
    consumed_at: str | None = None
    device_hint: str | None = None

    def is_expired(self) -> bool:
        try:
            expires_at = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
        except ValueError:
            return True
        return expires_at <= datetime.now(timezone.utc)


@dataclass(slots=True)
class MobileDevice:
    device_id: str
    tenant_id: str
    user_id: str
    edge_id: str
    edge_secret: str = ""
    platform: str = "ios"
    device_name: str = ""
    app_version: str = ""
    push_token: str = ""
    capabilities: dict[str, Any] = field(default_factory=dict)
    paired_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)


class MobilePairingStore:
    def __init__(self) -> None:
        self._lock = RLock()
        self._path = _state_path()
        self._push_outbox = _push_outbox_path()

    def _load(self) -> dict[str, Any]:
        if not self._path.exists():
            return {"codes": {}, "devices": {}}
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
        except Exception:
            payload = {"codes": {}, "devices": {}}
        if not isinstance(payload, dict):
            payload = {"codes": {}, "devices": {}}
        payload.setdefault("codes", {})
        payload.setdefault("devices", {})
        return payload

    def _save(self, payload: dict[str, Any]) -> None:
        self._path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def create_code(
        self,
        *,
        tenant_id: str,
        user_id: str,
        roles: list[str],
        ttl_sec: int = 300,
        device_hint: str | None = None,
    ) -> MobilePairCode:
        bounded_ttl = max(60, min(int(ttl_sec or 300), 300))
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=bounded_ttl)).isoformat()
        code = secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8].upper()
        record = MobilePairCode(
            access_code=code,
            tenant_id=tenant_id,
            user_id=user_id,
            roles=[str(role).strip().lower() for role in roles if str(role).strip()],
            expires_at=expires_at,
            device_hint=device_hint,
        )
        with self._lock:
            payload = self._load()
            payload["codes"][code] = asdict(record)
            self._save(payload)
        return record

    def consume_code(self, access_code: str) -> MobilePairCode | None:
        code = str(access_code or "").strip().upper()
        if not code:
            return None
        with self._lock:
            payload = self._load()
            raw = payload.get("codes", {}).get(code)
            if not isinstance(raw, dict):
                return None
            record = MobilePairCode(**raw)
            if record.is_expired() or record.consumed_at:
                payload["codes"].pop(code, None)
                self._save(payload)
                return None
            record.consumed_at = _utc_now()
            payload["codes"][code] = asdict(record)
            self._save(payload)
            return record

    def register_device(
        self,
        *,
        device_id: str,
        tenant_id: str,
        user_id: str,
        edge_id: str,
        edge_secret: str,
        platform: str = "ios",
        device_name: str = "",
        app_version: str = "",
        push_token: str = "",
        capabilities: dict[str, Any] | None = None,
    ) -> MobileDevice:
        record = MobileDevice(
            device_id=device_id,
            tenant_id=tenant_id,
            user_id=user_id,
            edge_id=edge_id,
            edge_secret=edge_secret,
            platform=platform,
            device_name=device_name,
            app_version=app_version,
            push_token=push_token,
            capabilities=dict(capabilities or {}),
            updated_at=_utc_now(),
        )
        with self._lock:
            payload = self._load()
            payload["devices"][device_id] = asdict(record)
            self._save(payload)
        return record

    def find_device_by_edge_id(self, edge_id: str) -> dict[str, Any] | None:
        target = str(edge_id or "").strip()
        if not target:
            return None
        with self._lock:
            payload = self._load()
        for row in payload.get("devices", {}).values():
            if isinstance(row, dict) and str(row.get("edge_id") or "").strip() == target:
                return row
        return None

    def list_devices(self, *, tenant_id: str | None = None, user_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            payload = self._load()
        rows = list(payload.get("devices", {}).values())
        filtered = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            if tenant_id and str(row.get("tenant_id") or "") != tenant_id:
                continue
            if user_id and str(row.get("user_id") or "") != user_id:
                continue
            filtered.append(row)
        filtered.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        return filtered

    def enqueue_push(
        self,
        *,
        tenant_id: str,
        user_id: str | None,
        edge_id: str | None,
        title: str,
        body: str,
        data: dict[str, Any] | None = None,
        push_token: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "push_id": f"push_{secrets.token_hex(6)}",
            "tenant_id": tenant_id,
            "user_id": user_id or "",
            "edge_id": edge_id or "",
            "title": title,
            "body": body,
            "data": dict(data or {}),
            "push_token": push_token or "",
            "created_at": _utc_now(),
            "status": "queued",
        }
        with self._lock:
            with self._push_outbox.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
        return payload


_store: MobilePairingStore | None = None


def get_mobile_pairing_store() -> MobilePairingStore:
    global _store
    if _store is None:
        _store = MobilePairingStore()
    return _store
