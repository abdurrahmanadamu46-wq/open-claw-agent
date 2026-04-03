from __future__ import annotations

import json
import os
import time
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


class FeishuChannelAdapter:
    """
    Feishu webhook/websocket payload adapter.
    - parse incoming payload to unified ChatEnvelope
    - send reply by webhook robot (simple) or OpenAPI bot (optional)
    """

    def __init__(self) -> None:
        self.enabled = False
        self.reply_mode = "webhook"
        self.bot_webhook = ""
        self.app_id = ""
        self.app_secret = ""
        self._tenant_token: str | None = None
        self._tenant_token_exp: int = 0
        self.reload_from_env()

    def reload_from_env(self) -> None:
        self.enabled = _env_bool("FEISHU_ENABLED", False)
        self.reply_mode = os.getenv("FEISHU_REPLY_MODE", "webhook").strip().lower() or "webhook"
        self.bot_webhook = os.getenv("FEISHU_BOT_WEBHOOK", "").strip()
        self.app_id = os.getenv("FEISHU_APP_ID", "").strip()
        self.app_secret = os.getenv("FEISHU_APP_SECRET", "").strip()

    def parse_event(self, payload: dict[str, Any]) -> ChatEnvelope | None:
        if not isinstance(payload, dict):
            return None

        # URL verification challenge
        if "challenge" in payload and "token" in payload:
            return ChatEnvelope(
                channel="feishu",
                chat_id="challenge",
                user_text=f"challenge:{payload.get('challenge')}",
                user_id="system",
                raw=payload,
            )

        event = payload.get("event")
        if not isinstance(event, dict):
            event = payload

        sender = event.get("sender") or {}
        sender_id = sender.get("sender_id") or {}
        user_id = str(
            sender_id.get("open_id")
            or sender_id.get("user_id")
            or sender.get("id")
            or ""
        ).strip()

        message = event.get("message") or {}
        chat_id = str(message.get("chat_id") or event.get("chat_id") or "").strip()
        content_text = ""
        content_raw = message.get("content")
        if isinstance(content_raw, str) and content_raw.strip():
            try:
                content_json = json.loads(content_raw)
                content_text = str(content_json.get("text") or content_json.get("content") or "").strip()
            except json.JSONDecodeError:
                content_text = content_raw.strip()

        if not content_text:
            content_text = str(event.get("text") or payload.get("text") or "").strip()

        if not chat_id or not content_text:
            return None

        return ChatEnvelope(
            channel="feishu",
            chat_id=chat_id,
            user_text=content_text,
            user_id=user_id or "feishu_user",
            raw=payload,
        )

    async def _get_tenant_access_token(self, client: httpx.AsyncClient) -> str | None:
        now = int(time.time())
        if self._tenant_token and now < self._tenant_token_exp - 60:
            return self._tenant_token
        if not self.app_id or not self.app_secret:
            return None
        try:
            resp = await client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": self.app_id, "app_secret": self.app_secret},
                timeout=10.0,
            )
            resp.raise_for_status()
            body = resp.json()
        except Exception:  # noqa: BLE001
            return None
        token = str(body.get("tenant_access_token") or "").strip()
        expire = int(body.get("expire") or 0)
        if not token:
            return None
        self._tenant_token = token
        self._tenant_token_exp = now + max(300, expire)
        return token

    async def reply(self, *, chat_id: str, text: str, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "reason": "feishu_disabled"}
        if not chat_id:
            return {"ok": False, "reason": "empty_chat_id"}
        if not text.strip():
            return {"ok": False, "reason": "empty_text"}

        own_client = False
        if client is None:
            client = httpx.AsyncClient(timeout=15.0)
            own_client = True
        try:
            if self.reply_mode == "openapi":
                token = await self._get_tenant_access_token(client)
                if not token:
                    return {"ok": False, "reason": "missing_tenant_access_token"}
                resp = await client.post(
                    f"https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
                    headers={"Authorization": f"Bearer {token}"},
                    json={
                        "receive_id": chat_id,
                        "msg_type": "text",
                        "content": json.dumps({"text": text}, ensure_ascii=False),
                    },
                )
                return {"ok": resp.status_code < 400, "status_code": resp.status_code, "mode": "openapi"}

            if not self.bot_webhook:
                return {"ok": False, "reason": "missing_bot_webhook"}
            resp = await client.post(
                self.bot_webhook,
                json={"msg_type": "text", "content": {"text": text}},
            )
            return {"ok": resp.status_code < 400, "status_code": resp.status_code, "mode": "webhook"}
        finally:
            if own_client:
                await client.aclose()

    def describe(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "reply_mode": self.reply_mode,
            "bot_webhook_configured": bool(self.bot_webhook),
            "openapi_configured": bool(self.app_id and self.app_secret),
        }


feishu_channel = FeishuChannelAdapter()
