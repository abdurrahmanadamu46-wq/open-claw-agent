"""
bridge_pipeline.py — 边缘消息 5 层处理管道
=========================================

借鉴 Golutra message_service/pipeline 的 normalize -> policy ->
throttle -> reliability -> dispatch 处理顺序。

这里的目标不是替换现有桥接层，而是把云边入口的关键可靠性能力独立出来，
便于单测、逐步接入 bridge_protocol.py / app.py / 网关事件。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

logger = logging.getLogger("bridge_pipeline")


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


async def _maybe_await(value: Any) -> Any:
    if hasattr(value, "__await__"):
        return await value
    return value


@dataclass
class EdgeMessage:
    """标准化后的边缘消息。"""

    msg_id: str
    msg_type: str
    tenant_id: str
    node_id: str
    account_id: str | None = None
    platform: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    signature: str = ""
    protocol_version: str = "1.0"
    headers: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    def idempotency_key(self) -> str:
        return f"{self.node_id}:{self.msg_id}"

    def signature_payload(self) -> str:
        return _json_dumps(self.payload)


@dataclass
class PipelineDecision:
    accepted: bool
    status: str
    reason: str = ""
    message: EdgeMessage | None = None
    handler_result: Any = None


class NormalizeLayer:
    """字段统一、版本兼容、旧协议映射。"""

    REQUIRED_FIELDS = ("msg_id", "msg_type", "tenant_id", "node_id")
    META_KEYS = {
        "msg_id",
        "msgId",
        "message_id",
        "id",
        "msg_type",
        "type",
        "event",
        "tenant_id",
        "tenantId",
        "node_id",
        "nodeId",
        "edge_id",
        "edgeId",
        "account_id",
        "accountId",
        "platform",
        "payload",
        "data",
        "timestamp",
        "signature",
        "protocol_version",
        "protocolVersion",
        "headers",
    }

    async def process(self, raw_msg: dict[str, Any], *, envelope_type: str | None = None) -> EdgeMessage:
        if not isinstance(raw_msg, dict):
            raise ValueError("raw_msg must be a dict")

        raw = dict(raw_msg)
        if envelope_type and not (raw.get("msg_type") or raw.get("type") or raw.get("event")):
            raw["msg_type"] = envelope_type

        normalized = {
            "msg_id": self._first(raw, "msg_id", "msgId", "message_id", "id"),
            "msg_type": self._first(raw, "msg_type", "type", "event"),
            "tenant_id": self._first(raw, "tenant_id", "tenantId"),
            "node_id": self._first(raw, "node_id", "nodeId", "edge_id", "edgeId"),
        }
        missing = [name for name, value in normalized.items() if not str(value or "").strip()]
        if missing:
            raise ValueError(f"missing required fields: {', '.join(missing)}")

        payload = raw.get("payload")
        if payload is None and "data" in raw:
            payload = raw.get("data")
        if payload is None:
            payload = {key: value for key, value in raw.items() if key not in self.META_KEYS}
        if not isinstance(payload, dict):
            payload = {"value": payload}

        version = str(
            raw.get("protocol_version")
            or raw.get("protocolVersion")
            or ("0.9" if "data" in raw and "payload" not in raw else "1.0")
        ).strip()

        timestamp = raw.get("timestamp")
        try:
            normalized_ts = float(timestamp) if timestamp is not None else time.time()
        except (TypeError, ValueError):
            normalized_ts = time.time()

        return EdgeMessage(
            msg_id=str(normalized["msg_id"]).strip(),
            msg_type=str(normalized["msg_type"]).strip(),
            tenant_id=str(normalized["tenant_id"]).strip(),
            node_id=str(normalized["node_id"]).strip(),
            account_id=self._strip_optional(self._first(raw, "account_id", "accountId")),
            platform=self._strip_optional(self._first(raw, "platform")),
            payload=payload,
            timestamp=normalized_ts,
            signature=str(raw.get("signature") or "").strip(),
            protocol_version=version or "1.0",
            headers=dict(raw.get("headers") or {}),
            raw=raw,
        )

    @staticmethod
    def _first(raw: dict[str, Any], *keys: str) -> Any:
        for key in keys:
            if key in raw and raw.get(key) is not None:
                return raw.get(key)
        return None

    @staticmethod
    def _strip_optional(value: Any) -> str | None:
        normalized = str(value or "").strip()
        return normalized or None


class PolicyLayer:
    """签名、租户归属和敏感字段治理。"""

    DEFAULT_SENSITIVE_FIELDS = {
        "password",
        "token",
        "cookie",
        "secret",
        "authorization",
        "api_key",
        "apikey",
        "session",
        "sessionid",
    }

    def __init__(
        self,
        hmac_secrets: dict[str, str] | None = None,
        *,
        tenant_resolver: Callable[[str], str | None | Awaitable[str | None]] | None = None,
        require_signature: bool = False,
        sensitive_fields: set[str] | None = None,
    ) -> None:
        self.hmac_secrets = dict(hmac_secrets or {})
        self.tenant_resolver = tenant_resolver
        self.require_signature = require_signature
        self.sensitive_fields = {item.lower() for item in (sensitive_fields or self.DEFAULT_SENSITIVE_FIELDS)}

    async def process(self, msg: EdgeMessage) -> EdgeMessage:
        await self._verify_signature(msg)
        await self._check_tenant_permission(msg)
        self._redact_sensitive_fields(msg.payload)
        return msg

    async def _verify_signature(self, msg: EdgeMessage) -> None:
        secret = self.hmac_secrets.get(msg.node_id)
        if not msg.signature:
            if self.require_signature:
                raise PermissionError(f"missing signature for node {msg.node_id}")
            return
        if not secret:
            raise PermissionError(f"unknown node secret for {msg.node_id}")
        expected = hmac.new(secret.encode("utf-8"), msg.signature_payload().encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(msg.signature, expected):
            raise PermissionError(f"invalid signature for msg {msg.msg_id}")

    async def _check_tenant_permission(self, msg: EdgeMessage) -> None:
        if self.tenant_resolver is None:
            return
        registered_tenant = await _maybe_await(self.tenant_resolver(msg.node_id))
        normalized = str(registered_tenant or "").strip()
        if normalized and normalized != msg.tenant_id:
            raise PermissionError(
                f"tenant mismatch for node {msg.node_id}: expected {normalized}, got {msg.tenant_id}"
            )

    def _redact_sensitive_fields(self, payload: Any) -> Any:
        if isinstance(payload, dict):
            for key, value in list(payload.items()):
                if str(key).lower() in self.sensitive_fields:
                    payload[key] = "[REDACTED]"
                else:
                    payload[key] = self._redact_sensitive_fields(value)
            return payload
        if isinstance(payload, list):
            for index, value in enumerate(payload):
                payload[index] = self._redact_sensitive_fields(value)
        return payload


class ThrottleLayer:
    """每节点 / 每租户窗口限流。"""

    def __init__(self, node_limit: int = 100, tenant_limit: int = 500, window_seconds: int = 60) -> None:
        self.node_limit = max(1, int(node_limit))
        self.tenant_limit = max(1, int(tenant_limit))
        self.window_seconds = max(1, int(window_seconds))
        self._node_hits: dict[str, deque[float]] = defaultdict(deque)
        self._tenant_hits: dict[str, deque[float]] = defaultdict(deque)

    async def process(self, msg: EdgeMessage) -> EdgeMessage:
        now = time.time()
        node_hits = self._node_hits[msg.node_id]
        tenant_hits = self._tenant_hits[msg.tenant_id]
        self._trim(node_hits, now)
        self._trim(tenant_hits, now)
        if len(node_hits) >= self.node_limit:
            raise RuntimeError(f"node {msg.node_id} rate limit exceeded")
        if len(tenant_hits) >= self.tenant_limit:
            raise RuntimeError(f"tenant {msg.tenant_id} rate limit exceeded")
        node_hits.append(now)
        tenant_hits.append(now)
        return msg

    def _trim(self, hits: deque[float], now: float) -> None:
        cutoff = now - self.window_seconds
        while hits and hits[0] < cutoff:
            hits.popleft()


class ReliabilityLayer:
    """幂等去重。"""

    def __init__(self, ttl_seconds: int = 300) -> None:
        self.ttl_seconds = max(1, int(ttl_seconds))
        self._seen: dict[str, float] = {}

    async def process(self, msg: EdgeMessage) -> EdgeMessage | None:
        now = time.time()
        self._prune(now)
        key = msg.idempotency_key()
        if key in self._seen:
            logger.info("[BridgePipeline] duplicate dropped key=%s", key)
            return None
        self._seen[key] = now + self.ttl_seconds
        return msg

    def _prune(self, now: float) -> None:
        expired = [key for key, expires_at in self._seen.items() if expires_at <= now]
        for key in expired:
            self._seen.pop(key, None)


class DispatchLayer:
    """按消息类型分发到处理器。"""

    def __init__(self) -> None:
        self._handlers: dict[str, Callable[[EdgeMessage], Awaitable[Any]]] = {}

    def register(self, msg_type: str, handler: Callable[[EdgeMessage], Awaitable[Any]]) -> None:
        normalized = str(msg_type or "").strip()
        if not normalized:
            raise ValueError("msg_type is required")
        self._handlers[normalized] = handler

    async def process(self, msg: EdgeMessage) -> tuple[bool, Any]:
        handler = self._handlers.get(msg.msg_type)
        if handler is None:
            logger.warning("[BridgePipeline] no handler for msg_type=%s", msg.msg_type)
            return False, None
        return True, await handler(msg)


class EdgeMessagePipeline:
    """完整 5 层边缘消息管道。"""

    def __init__(
        self,
        *,
        hmac_secrets: dict[str, str] | None = None,
        tenant_resolver: Callable[[str], str | None | Awaitable[str | None]] | None = None,
        require_signature: bool = False,
        node_limit: int = 100,
        tenant_limit: int = 500,
        window_seconds: int = 60,
        reliability_ttl: int = 300,
    ) -> None:
        self.normalize = NormalizeLayer()
        self.policy = PolicyLayer(
            hmac_secrets=hmac_secrets,
            tenant_resolver=tenant_resolver,
            require_signature=require_signature,
        )
        self.throttle = ThrottleLayer(
            node_limit=node_limit,
            tenant_limit=tenant_limit,
            window_seconds=window_seconds,
        )
        self.reliability = ReliabilityLayer(ttl_seconds=reliability_ttl)
        self.dispatch = DispatchLayer()

    def register(self, msg_type: str, handler: Callable[[EdgeMessage], Awaitable[Any]]) -> None:
        self.dispatch.register(msg_type, handler)

    async def process(self, raw_msg: dict[str, Any], *, envelope_type: str | None = None) -> PipelineDecision:
        try:
            msg = await self.normalize.process(raw_msg, envelope_type=envelope_type)
            msg = await self.policy.process(msg)
            msg = await self.throttle.process(msg)
            msg = await self.reliability.process(msg)
            if msg is None:
                return PipelineDecision(accepted=False, status="duplicate", reason="duplicate_msg_id")
            handled, result = await self.dispatch.process(msg)
            if not handled:
                return PipelineDecision(
                    accepted=False,
                    status="unhandled",
                    reason=f"no_handler:{msg.msg_type}",
                    message=msg,
                )
            return PipelineDecision(
                accepted=True,
                status="dispatched",
                message=msg,
                handler_result=result,
            )
        except ValueError as exc:
            logger.error("[BridgePipeline] normalize rejected: %s", exc)
            return PipelineDecision(accepted=False, status="invalid", reason=str(exc))
        except PermissionError as exc:
            logger.warning("[BridgePipeline] policy rejected: %s", exc)
            return PipelineDecision(accepted=False, status="policy_rejected", reason=str(exc))
        except RuntimeError as exc:
            logger.warning("[BridgePipeline] throttled: %s", exc)
            return PipelineDecision(accepted=False, status="throttled", reason=str(exc))


def sign_payload(payload: dict[str, Any], secret: str) -> str:
    """测试/边缘构造签名时的辅助函数。"""

    return hmac.new(secret.encode("utf-8"), _json_dumps(payload).encode("utf-8"), hashlib.sha256).hexdigest()
