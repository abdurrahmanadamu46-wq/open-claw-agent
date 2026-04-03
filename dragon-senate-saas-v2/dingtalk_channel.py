from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

import httpx


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class ChatEnvelope:
    channel: str
    chat_id: str
    user_text: str
    user_id: str
    raw: dict[str, Any]


def _pick_text(payload: dict[str, Any]) -> str:
    candidates: list[Any] = [
        payload.get("text"),
        payload.get("msgText"),
        payload.get("content"),
        (payload.get("text") or {}).get("content") if isinstance(payload.get("text"), dict) else None,
        (payload.get("content") or {}).get("text") if isinstance(payload.get("content"), dict) else None,
        ((payload.get("msg") or {}).get("text") if isinstance(payload.get("msg"), dict) else None),
        ((payload.get("msg") or {}).get("content") if isinstance(payload.get("msg"), dict) else None),
    ]
    for raw in candidates:
        if raw is None:
            continue
        if isinstance(raw, str):
            text = raw.strip()
            if not text:
                continue
            if text.startswith("{") and text.endswith("}"):
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict):
                        parsed_text = str(parsed.get("text") or parsed.get("content") or "").strip()
                        if parsed_text:
                            return parsed_text
                except json.JSONDecodeError:
                    pass
            return text
        if isinstance(raw, dict):
            text = str(raw.get("text") or raw.get("content") or "").strip()
            if text:
                return text
    return ""


class DingTalkChannelAdapter:
    """
    DingTalk webhook payload adapter.
    Supports:
    - callback payload parsing
    - sessionWebhook reply (preferred)
    - custom robot webhook reply
    """

    def __init__(self) -> None:
        self.enabled = False
        self.reply_mode = "webhook"
        self.bot_webhook = ""
        self.default_session_webhook = ""
        self.reload_from_env()

    def reload_from_env(self) -> None:
        self.enabled = _env_bool("DINGTALK_ENABLED", False)
        self.reply_mode = os.getenv("DINGTALK_REPLY_MODE", "webhook").strip().lower() or "webhook"
        self.bot_webhook = os.getenv("DINGTALK_BOT_WEBHOOK", "").strip()
        self.default_session_webhook = os.getenv("DINGTALK_SESSION_WEBHOOK", "").strip()

    def parse_event(self, payload: dict[str, Any]) -> ChatEnvelope | None:
        if not isinstance(payload, dict):
            return None
        event = payload.get("event")
        if not isinstance(event, dict):
            event = payload

        user_text = _pick_text(event) or _pick_text(payload)
        chat_id = str(
            event.get("conversationId")
            or event.get("chat_id")
            or payload.get("conversationId")
            or payload.get("chat_id")
            or event.get("sessionWebhook")
            or payload.get("sessionWebhook")
            or ""
        ).strip()
        user_id = str(
            event.get("senderId")
            or event.get("senderStaffId")
            or payload.get("senderId")
            or payload.get("senderStaffId")
            or ""
        ).strip()
        if not chat_id or not user_text:
            return None
        return ChatEnvelope(
            channel="dingtalk",
            chat_id=chat_id,
            user_text=user_text,
            user_id=user_id or "dingtalk_user",
            raw=payload,
        )

    async def reply(
        self,
        *,
        chat_id: str,
        text: str,
        session_webhook: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "reason": "dingtalk_disabled"}
        if not text.strip():
            return {"ok": False, "reason": "empty_text"}

        own_client = False
        if client is None:
            client = httpx.AsyncClient(timeout=15.0)
            own_client = True
        try:
            webhook = (session_webhook or "").strip() or self.default_session_webhook or self.bot_webhook
            if not webhook:
                return {"ok": False, "reason": "missing_webhook"}
            resp = await client.post(
                webhook,
                json={"msgtype": "text", "text": {"content": text}},
                timeout=15.0,
            )
            return {"ok": resp.status_code < 400, "status_code": resp.status_code, "mode": self.reply_mode, "chat_id": chat_id}
        finally:
            if own_client:
                await client.aclose()

    def describe(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "reply_mode": self.reply_mode,
            "bot_webhook_configured": bool(self.bot_webhook),
            "session_webhook_configured": bool(self.default_session_webhook),
        }


dingtalk_channel = DingTalkChannelAdapter()
