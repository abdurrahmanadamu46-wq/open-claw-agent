"""
Lobster Webhook — Before/After 执行回调系统。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


@dataclass
class WebhookBeforeRequest:
    """执行前回调请求。"""

    lobster: str
    action: str
    tenant_id: str
    user_id: str
    trace_id: str
    payload: dict[str, Any]
    timestamp: float = field(default_factory=time.time)


@dataclass
class WebhookBeforeResponse:
    """执行前回调响应。"""

    allow: bool = True
    modified_payload: dict[str, Any] | None = None
    reason: str = ""
    latency_ms: float = 0.0


@dataclass
class WebhookAfterRequest:
    """执行后回调请求。"""

    lobster: str
    action: str
    tenant_id: str
    user_id: str
    trace_id: str
    payload: dict[str, Any]
    result: dict[str, Any]
    duration_ms: float
    success: bool
    error: str | None = None
    timestamp: float = field(default_factory=time.time)


BeforeCallback = Callable[[WebhookBeforeRequest], Awaitable[WebhookBeforeResponse]]
AfterCallback = Callable[[WebhookAfterRequest], Awaitable[None]]


class LobsterWebhookRegistry:
    """管理所有龙虾的 Before/After 回调。"""

    def __init__(self) -> None:
        self._before_hooks: dict[tuple[str, str], list[BeforeCallback]] = {}
        self._after_hooks: dict[tuple[str, str], list[AfterCallback]] = {}
        self._global_before: list[BeforeCallback] = []
        self._global_after: list[AfterCallback] = []

    def register_before(self, lobster: str, action: str, callback: BeforeCallback) -> None:
        if lobster == "*" and action == "*":
            self._global_before.append(callback)
            return
        key = (lobster.lower(), action.lower())
        self._before_hooks.setdefault(key, []).append(callback)

    def register_after(self, lobster: str, action: str, callback: AfterCallback) -> None:
        if lobster == "*" and action == "*":
            self._global_after.append(callback)
            return
        key = (lobster.lower(), action.lower())
        self._after_hooks.setdefault(key, []).append(callback)

    def unregister_all(self, lobster: str, action: str) -> int:
        key = (lobster.lower(), action.lower())
        count = len(self._before_hooks.pop(key, []))
        count += len(self._after_hooks.pop(key, []))
        return count

    async def fire_before(self, request: WebhookBeforeRequest) -> WebhookBeforeResponse:
        started = time.time()
        final_response = WebhookBeforeResponse(allow=True)
        current_payload = dict(request.payload)
        key = (request.lobster.lower(), request.action.lower())

        callbacks: list[BeforeCallback] = []
        callbacks.extend(self._before_hooks.get(key, []))
        callbacks.extend(self._before_hooks.get((request.lobster.lower(), "*"), []))
        callbacks.extend(self._before_hooks.get(("*", request.action.lower()), []))
        callbacks.extend(self._global_before)

        for callback in callbacks:
            try:
                resp = await callback(request)
                if not resp.allow:
                    final_response.allow = False
                    final_response.reason = resp.reason or "blocked_by_webhook"
                    break
                if resp.modified_payload is not None:
                    current_payload = resp.modified_payload
                    final_response.modified_payload = current_payload
            except Exception as exc:  # noqa: BLE001
                print(f"[lobster_webhook] before callback error: {exc}")

        final_response.latency_ms = round((time.time() - started) * 1000, 2)
        return final_response

    async def fire_after(self, request: WebhookAfterRequest) -> None:
        key = (request.lobster.lower(), request.action.lower())
        callbacks: list[AfterCallback] = []
        callbacks.extend(self._after_hooks.get(key, []))
        callbacks.extend(self._after_hooks.get((request.lobster.lower(), "*"), []))
        callbacks.extend(self._after_hooks.get(("*", request.action.lower()), []))
        callbacks.extend(self._global_after)

        for callback in callbacks:
            try:
                await callback(request)
            except Exception as exc:  # noqa: BLE001
                print(
                    f"[lobster_webhook] after callback error: "
                    f"lobster={request.lobster} action={request.action} error={exc}"
                )

    def describe(self) -> dict[str, Any]:
        return {
            "before_hooks": {f"{k[0]}.{k[1]}": len(v) for k, v in self._before_hooks.items()},
            "after_hooks": {f"{k[0]}.{k[1]}": len(v) for k, v in self._after_hooks.items()},
            "global_before_count": len(self._global_before),
            "global_after_count": len(self._global_after),
            "total_before": sum(len(v) for v in self._before_hooks.values()) + len(self._global_before),
            "total_after": sum(len(v) for v in self._after_hooks.values()) + len(self._global_after),
        }


_registry: LobsterWebhookRegistry | None = None


def get_webhook_registry() -> LobsterWebhookRegistry:
    """获取全局 LobsterWebhookRegistry 单例。"""
    global _registry
    if _registry is None:
        _registry = LobsterWebhookRegistry()
    return _registry


async def send_webhook(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Lightweight compatibility helper for system notifications.

    Current implementation is best-effort and keeps notification transport
    inside lobster_webhook.py so new subsystems do not add extra dependencies.
    """
    try:
        body = json.dumps({"event_type": event_type, "payload": payload}, ensure_ascii=False, default=str)
        print(f"[lobster_webhook] send_webhook {body}")
        return {"ok": True, "event_type": event_type}
    except Exception as exc:  # noqa: BLE001
        print(f"[lobster_webhook] send_webhook error: {exc}")
        return {"ok": False, "event_type": event_type, "error": str(exc)}
