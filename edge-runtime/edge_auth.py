"""
EdgeAuth — HMAC-based edge authentication helpers.

Provides:
- signed HTTP headers for edge -> cloud requests
- signed websocket auth payloads for edge -> fleet gateway
- verification helpers for cloud side
"""

from __future__ import annotations

import hashlib
import hmac
import time
import uuid
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class EdgeAuthPayload:
    node_id: str
    tenant_id: str
    timestamp: str
    nonce: str
    signature: str
    legacy_edge_secret: str = ""

    def to_headers(self) -> dict[str, str]:
        headers = {
            "X-Edge-Node-Id": self.node_id,
            "X-Timestamp": self.timestamp,
            "X-Nonce": self.nonce,
            "X-Signature": self.signature,
        }
        if self.tenant_id:
            headers["X-Tenant-Id"] = self.tenant_id
        if self.legacy_edge_secret:
            headers["X-Edge-Secret"] = self.legacy_edge_secret
        return headers

    def to_socket_auth(self) -> dict[str, str]:
        payload = {
            "nodeId": self.node_id,
            "tenantId": self.tenant_id,
            "timestamp": self.timestamp,
            "nonce": self.nonce,
            "signature": self.signature,
        }
        if self.legacy_edge_secret:
            payload["edgeSecret"] = self.legacy_edge_secret
        return payload


class EdgeAuthManager:
    def __init__(self, node_id: str, secret_key: str, tenant_id: str = "") -> None:
        self.node_id = str(node_id or "").strip()
        self.tenant_id = str(tenant_id or "").strip()
        self._secret = str(secret_key or "").strip()

    def generate(self, *, include_legacy_secret: bool = True) -> EdgeAuthPayload:
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex[:12]
        signature = self._sign(self.node_id, timestamp, nonce, self._secret)
        return EdgeAuthPayload(
            node_id=self.node_id,
            tenant_id=self.tenant_id,
            timestamp=timestamp,
            nonce=nonce,
            signature=signature,
            legacy_edge_secret=self._secret if include_legacy_secret else "",
        )

    def generate_auth_header(self, *, include_legacy_secret: bool = True) -> dict[str, str]:
        return self.generate(include_legacy_secret=include_legacy_secret).to_headers()

    def generate_socket_auth(self, *, include_legacy_secret: bool = True) -> dict[str, str]:
        return self.generate(include_legacy_secret=include_legacy_secret).to_socket_auth()

    @classmethod
    def verify_auth_header(
        cls,
        headers: dict[str, Any],
        secret_key: str,
        *,
        max_age_sec: int = 60,
    ) -> bool:
        node_id = str(headers.get("X-Edge-Node-Id") or headers.get("x-edge-node-id") or "").strip()
        timestamp = str(headers.get("X-Timestamp") or headers.get("x-timestamp") or "").strip()
        nonce = str(headers.get("X-Nonce") or headers.get("x-nonce") or "").strip()
        signature = str(headers.get("X-Signature") or headers.get("x-signature") or "").strip()
        return cls.verify(node_id, timestamp, nonce, signature, secret_key, max_age_sec=max_age_sec)

    @classmethod
    def verify_socket_auth(
        cls,
        auth_payload: dict[str, Any],
        secret_key: str,
        *,
        max_age_sec: int = 60,
    ) -> bool:
        node_id = str(auth_payload.get("nodeId") or auth_payload.get("node_id") or "").strip()
        timestamp = str(auth_payload.get("timestamp") or "").strip()
        nonce = str(auth_payload.get("nonce") or "").strip()
        signature = str(auth_payload.get("signature") or "").strip()
        return cls.verify(node_id, timestamp, nonce, signature, secret_key, max_age_sec=max_age_sec)

    @classmethod
    def verify(
        cls,
        node_id: str,
        timestamp: str,
        nonce: str,
        signature: str,
        secret_key: str,
        *,
        max_age_sec: int = 60,
    ) -> bool:
        if not all([node_id, timestamp, nonce, signature, secret_key]):
            return False
        try:
            ts = int(timestamp)
        except (TypeError, ValueError):
            return False
        if abs(int(time.time()) - ts) > max(1, int(max_age_sec)):
            return False
        expected = cls._sign(node_id, timestamp, nonce, secret_key)
        return hmac.compare_digest(expected, signature)

    @staticmethod
    def _sign(node_id: str, timestamp: str, nonce: str, secret_key: str) -> str:
        payload = f"{node_id}:{timestamp}:{nonce}"
        return hmac.new(secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
