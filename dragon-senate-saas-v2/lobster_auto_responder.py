"""
Auto response action handlers for lobster rule engine.
"""

from __future__ import annotations

import asyncio
import os
import re
from typing import Any, Awaitable, Callable

import httpx

from channel_account_manager import channel_account_manager
from im_media_pipeline import extract_media_refs_from_output
from im_media_pipeline import send_media_to_channel
from lobster_runner import LobsterRunSpec, LobsterRunner


THINKING_THRESHOLD_MS = int(os.getenv("IM_THINKING_THRESHOLD_MS", "2500") or 2500)


def _render_template(template: str, event: dict[str, Any]) -> str:
    text = str(template or "")

    def _replace(match: re.Match[str]) -> str:
        path = str(match.group(1) or "").strip()
        current: Any = event
        for part in path.split("."):
            if not isinstance(current, dict):
                return ""
            current = current.get(part)
        return "" if current is None else str(current)

    return re.sub(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}", _replace, text)


def should_respond(message_ctx: dict[str, Any], *, group_respond_mode: str = "intent") -> bool:
    chat_type = str(message_ctx.get("chat_type") or "p2p").strip().lower() or "p2p"
    if chat_type == "p2p":
        return True

    mentions = message_ctx.get("mentions") or []
    if str(group_respond_mode or "intent").strip().lower() == "always":
        return True
    if str(group_respond_mode or "intent").strip().lower() == "mention_only":
        return bool(mentions)

    text = str(message_ctx.get("text") or "").strip()
    if mentions:
        return True
    if text.endswith("？") or text.endswith("?"):
        return True
    lower = text.lower()
    if any(w in lower for w in ["how", "why", "what", "when", "where", "who", "help"]):
        return True
    trigger_verbs = [
        "帮", "麻烦", "请", "能否", "可以", "解释", "看看", "分析",
        "总结", "写", "改", "修", "查", "对比", "翻译", "推荐",
        "比较", "活动", "优惠", "方案", "策略", "内容", "文案",
        "发布", "排期", "跟进", "评论", "回复",
    ]
    if any(v in text for v in trigger_verbs):
        return True
    if message_ctx.get("attachments") and not mentions:
        return False
    return False


class LobsterAutoResponder:
    def __init__(
        self,
        *,
        runtime_lobster_builder: Callable[[str, str], Any],
        llm_router: Any | None = None,
    ) -> None:
        self.runtime_lobster_builder = runtime_lobster_builder
        if llm_router is None:
            from llm_router import llm_router as default_llm_router

            llm_router = default_llm_router
        self.runner = LobsterRunner(llm_router)

    async def handle_im_message(self, message_ctx: dict[str, Any], params: dict[str, Any], tenant_id: str) -> dict[str, Any]:
        lobster_id = str(params.get("lobster_id") or message_ctx.get("route_to") or "echoer").strip() or "echoer"
        text = str(message_ctx.get("text") or "").strip()
        channel = str(message_ctx.get("channel") or "").strip().lower()
        account_id = str(message_ctx.get("account_id") or "").strip()
        chat_id = str(message_ctx.get("chat_id") or "").strip()
        channel_id = str(message_ctx.get("channel_id") or (f"{channel}:{account_id}" if channel and account_id else account_id)).strip()
        group_mode = str(
            message_ctx.get("group_respond_mode")
            or channel_account_manager.get_group_respond_mode(channel, account_id=account_id, tenant_id=tenant_id)
        ).strip().lower() or "intent"
        if not should_respond(message_ctx, group_respond_mode=group_mode):
            return {"ok": True, "filtered": True, "reason": "no_intent_signal"}

        lobster = self.runtime_lobster_builder(lobster_id, tenant_id)
        placeholder_id: str | None = None
        thinking_sent = False
        threshold_cfg = channel_account_manager.get_thinking_placeholder_config(channel, account_id=account_id, tenant_id=tenant_id)
        threshold_ms = int(message_ctx.get("thinking_threshold_ms") or threshold_cfg.get("threshold_ms") or THINKING_THRESHOLD_MS)
        placeholder_enabled = bool(message_ctx.get("thinking_placeholder_enabled", threshold_cfg.get("enabled", True)))
        sender = channel_account_manager.get_sender(channel_id) if channel_id else None

        async def _send_thinking() -> None:
            nonlocal placeholder_id, thinking_sent
            if not placeholder_enabled or sender is None or not chat_id:
                return
            await asyncio.sleep(max(0, threshold_ms) / 1000)
            placeholder_id = await sender.send_placeholder(chat_id)
            thinking_sent = True

        thinking_task = asyncio.create_task(_send_thinking())
        try:
            spec = LobsterRunSpec(
                role_id=lobster_id,
                system_prompt=getattr(lobster, "system_prompt_full", "") or f"You are {lobster_id}.",
                user_prompt=text,
                lobster=lobster,
                peer_id=chat_id or message_ctx.get("sender") or "im-user",
                session_mode="per-peer",
                fresh_context=True,
                meta={
                    "tenant_id": tenant_id,
                    "task_type": "im_auto_response",
                    "approved": True,
                    "channel": channel or "im",
                    "chat_id": chat_id,
                    "reply_channel_id": channel_id or None,
                    "reply_chat_id": chat_id or None,
                    "chat_type": str(message_ctx.get("chat_type") or "p2p"),
                    "mentions": list(message_ctx.get("mentions") or []),
                    "attachments": list(message_ctx.get("attachments") or []),
                },
            )
            result = await self.runner.run(spec)
        finally:
            thinking_task.cancel()

        reply_text = str(result.final_content or "").strip()
        media_refs = extract_media_refs_from_output(reply_text)
        sent_media = []
        if channel_id:
            for ref in media_refs:
                ok = await send_media_to_channel(channel_id, ref, chat_id=chat_id)
                sent_media.append({"path": ref, "ok": ok})

        if thinking_sent and placeholder_id and sender is not None:
            if reply_text:
                await sender.update_message(placeholder_id, reply_text)
            else:
                await sender.delete_message(placeholder_id)
        elif reply_text and sender is not None and chat_id:
            await sender.send_text(chat_id, reply_text)

        return {
            "ok": result.error is None,
            "lobster_id": lobster_id,
            "filtered": False,
            "text": reply_text,
            "media_refs": media_refs,
            "sent_media": sent_media,
            "placeholder_id": placeholder_id,
        }

    async def handle_dispatch_lobster(self, event: dict[str, Any], params: dict[str, Any], tenant_id: str) -> dict[str, Any]:
        lobster_id = str(params.get("lobster_id") or "").strip()
        task_text = str(params.get("task") or params.get("message_template") or "").strip()
        if not lobster_id or not task_text:
            return {"ok": False, "reason": "missing_lobster_id_or_task"}
        message_ctx = event.get("message_ctx") if isinstance(event.get("message_ctx"), dict) else None
        if isinstance(message_ctx, dict):
            merged_ctx = dict(message_ctx)
            merged_ctx.setdefault("text", _render_template(task_text, event))
            return await self.handle_im_message(merged_ctx, {"lobster_id": lobster_id}, tenant_id)
        prompt = _render_template(task_text, event)
        lobster = self.runtime_lobster_builder(lobster_id, tenant_id)

        async def _run() -> None:
            spec = LobsterRunSpec(
                role_id=lobster_id,
                system_prompt=getattr(lobster, "system_prompt_full", "") or f"You are {lobster_id}.",
                user_prompt=prompt,
                lobster=lobster,
                meta={
                    "tenant_id": tenant_id,
                    "task_type": "rule_engine_dispatch",
                    "approved": True,
                    "source": "lobster_rule_engine",
                    "event_type": str(((event or {}).get("event") or {}).get("type") or ""),
                },
            )
            await self.runner.run(spec)

        asyncio.create_task(_run())
        return {"ok": True, "queued": True, "lobster_id": lobster_id, "prompt": prompt[:200]}

    async def handle_send_alert(self, event: dict[str, Any], params: dict[str, Any], tenant_id: str) -> dict[str, Any]:
        from notification_center import send_notification

        message_template = str(params.get("message_template") or params.get("message") or "").strip()
        level = str(params.get("level") or "warning").strip() or "warning"
        message = _render_template(message_template, event) if message_template else str(event)
        await send_notification(
            tenant_id=tenant_id,
            message=message,
            level=level,
            category="lobster_rule_engine",
        )
        return {"ok": True, "message": message}

    async def handle_update_field(self, event: dict[str, Any], params: dict[str, Any], tenant_id: str) -> dict[str, Any]:
        field = str(params.get("field") or "").strip()
        value = params.get("value")
        if not field:
            return {"ok": False, "reason": "missing_field"}
        current: Any = event
        parts = field.split(".")
        for part in parts[:-1]:
            if not isinstance(current, dict):
                return {"ok": False, "reason": "invalid_path"}
            current = current.setdefault(part, {})
        if not isinstance(current, dict):
            return {"ok": False, "reason": "invalid_target"}
        current[parts[-1]] = value
        return {"ok": True, "field": field, "value": value, "tenant_id": tenant_id}

    async def handle_webhook(self, event: dict[str, Any], params: dict[str, Any], tenant_id: str) -> dict[str, Any]:
        url = str(params.get("url") or "").strip()
        if not url:
            return {"ok": False, "reason": "missing_url"}
        body = params.get("body") if isinstance(params.get("body"), dict) else {"event": event, "tenant_id": tenant_id}
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=body)
        return {"ok": response.is_success, "status_code": response.status_code}
