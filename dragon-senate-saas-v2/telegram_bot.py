from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from redis.asyncio import Redis
from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


@dataclass(slots=True)
class BotConfig:
    token: str
    backend_base_url: str
    redis_url: str
    rate_limit_per_min: int
    memory_max_items: int
    hitl_secret: str
    backend_bearer: str


def load_config() -> BotConfig:
    hitl_secret = os.getenv("HITL_SHARED_SECRET", "").strip() or os.getenv("EDGE_SHARED_SECRET", "").strip()
    if not hitl_secret:
        raise RuntimeError("Missing required environment variable: HITL_SHARED_SECRET (or EDGE_SHARED_SECRET)")
    return BotConfig(
        token=_required_env("TELEGRAM_BOT_TOKEN"),
        backend_base_url=os.getenv("TELEGRAM_BACKEND_BASE_URL", "http://127.0.0.1:8000").rstrip("/"),
        redis_url=os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0").strip(),
        rate_limit_per_min=max(1, int(os.getenv("TELEGRAM_RATE_LIMIT_PER_MIN", "20"))),
        memory_max_items=max(20, int(os.getenv("TELEGRAM_MEMORY_MAX_ITEMS", "300"))),
        hitl_secret=hitl_secret,
        backend_bearer=os.getenv("TELEGRAM_BACKEND_BEARER", "").strip(),
    )


def _backend_headers(cfg: BotConfig) -> dict[str, str]:
    if not cfg.backend_bearer:
        return {}
    return {"Authorization": f"Bearer {cfg.backend_bearer}"}


def _redis_memory_key(chat_id: str) -> str:
    return f"tg:memory:{chat_id}"


def _redis_rate_key(chat_id: str) -> str:
    minute_bucket = int(time.time() // 60)
    return f"tg:rl:{chat_id}:{minute_bucket}"


async def _append_memory(redis: Redis, chat_id: str, role: str, text: str, max_items: int) -> None:
    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "role": role,
        "text": text[:4000],
    }
    key = _redis_memory_key(chat_id)
    async with redis.pipeline(transaction=True) as pipe:
        pipe.rpush(key, json.dumps(row, ensure_ascii=False))
        pipe.ltrim(key, -max_items, -1)
        pipe.expire(key, 86400 * 14)
        await pipe.execute()


async def _read_memories(redis: Redis, chat_id: str, limit: int = 10, keyword: str | None = None) -> list[dict[str, Any]]:
    rows = await redis.lrange(_redis_memory_key(chat_id), -max(1, limit), -1)
    parsed: list[dict[str, Any]] = []
    for raw in rows:
        try:
            item = json.loads(raw)
            if not isinstance(item, dict):
                continue
            if keyword and keyword.lower() not in str(item.get("text", "")).lower():
                continue
            parsed.append(item)
        except json.JSONDecodeError:
            continue
    return parsed


async def _allow_message(redis: Redis, chat_id: str, limit_per_min: int) -> bool:
    key = _redis_rate_key(chat_id)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, 75)
    return count <= limit_per_min


async def _post_chat_gateway(client: httpx.AsyncClient, base_url: str, chat_id: str, text: str) -> dict[str, Any]:
    payload = {
        "chat_id": chat_id,
        "user_text": text,
        "source": "telegram-bot",
    }
    response = await client.post(f"{base_url}/webhook/chat_gateway", json=payload, timeout=20.0)
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict):
        return data
    return {"ok": True}


async def _post_workspace_ensure(
    client: httpx.AsyncClient,
    cfg: BotConfig,
    *,
    chat_id: str,
    tenant_id: str | None = None,
    workspace_name: str | None = None,
) -> dict[str, Any]:
    if not cfg.backend_bearer:
        return {"ok": False, "error": "missing_TELEGRAM_BACKEND_BEARER"}
    payload = {
        "user_id": chat_id,
        "tenant_id": tenant_id,
        "workspace_name": workspace_name,
    }
    response = await client.post(
        f"{cfg.backend_base_url}/integrations/anythingllm/workspaces/ensure",
        json=payload,
        headers=_backend_headers(cfg),
        timeout=20.0,
    )
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict):
        return data
    return {"ok": True}


async def _post_hitl_decision(
    client: httpx.AsyncClient,
    base_url: str,
    secret: str,
    approval_id: str,
    decision: str,
    operator: str,
) -> dict[str, Any]:
    payload = {
        "approval_id": approval_id,
        "decision": decision,
        "operator": operator,
    }
    response = await client.post(
        f"{base_url}/hitl/decide",
        json=payload,
        headers={"x-hitl-secret": secret},
        timeout=20.0,
    )
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict):
        return data
    return {"ok": True}


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_chat or not update.message:
        return
    text = (
        "Dragon Senate Telegram console connected.\n"
        "Commands:\n"
        "/memories [N] [keyword] - browse memory history\n"
        "/workspace [tenant_id] [workspace_name] - ensure AnythingLLM workspace\n"
        "/approve <approval_id> - approve HITL action\n"
        "/reject <approval_id> - reject HITL action\n"
        "Send a URL or plain task text to trigger the Senate workflow."
    )
    await update.message.reply_text(text)


async def cmd_memories(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_chat or not update.message:
        return
    app = context.application
    redis: Redis = app.bot_data["redis"]
    chat_id = str(update.effective_chat.id)
    args = context.args or []

    limit = 10
    keyword = None
    if args:
        try:
            limit = max(1, min(int(args[0]), 30))
            keyword = " ".join(args[1:]).strip() or None
        except ValueError:
            keyword = " ".join(args).strip() or None

    rows = await _read_memories(redis, chat_id, limit=limit, keyword=keyword)
    if not rows:
        await update.message.reply_text("Memory browser: no records yet.")
        return

    lines = ["*Memory Browser*"]
    for row in rows:
        role = str(row.get("role", "unknown"))
        ts = str(row.get("ts", ""))[:19].replace("T", " ")
        text = str(row.get("text", "")).strip().replace("\n", " ")
        lines.append(f"- `{ts}` [{role}] {text[:180]}")
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)


async def _handle_hitl_action(update: Update, context: ContextTypes.DEFAULT_TYPE, decision: str) -> None:
    if not update.effective_chat or not update.message:
        return
    app = context.application
    client: httpx.AsyncClient = app.bot_data["http_client"]
    cfg: BotConfig = app.bot_data["config"]
    redis: Redis = app.bot_data["redis"]
    chat_id = str(update.effective_chat.id)
    operator = update.effective_user.username or f"chat:{chat_id}"

    if not context.args:
        usage = "/approve <approval_id>" if decision == "approved" else "/reject <approval_id>"
        await update.message.reply_text(f"Usage: {usage}")
        return
    approval_id = context.args[0].strip()
    if not approval_id:
        await update.message.reply_text("approval_id cannot be empty.")
        return

    try:
        result = await _post_hitl_decision(
            client=client,
            base_url=cfg.backend_base_url,
            secret=cfg.hitl_secret,
            approval_id=approval_id,
            decision=decision,
            operator=operator,
        )
        status = result.get("status", {})
        await _append_memory(
            redis,
            chat_id=chat_id,
            role="assistant",
            text=f"HITL {decision}: {approval_id} -> {status}",
            max_items=cfg.memory_max_items,
        )
        await update.message.reply_text(f"Submitted: {decision} {approval_id}")
    except Exception as exc:  # noqa: BLE001
        await update.message.reply_text(f"HITL submit failed: {exc}")


async def cmd_approve(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _handle_hitl_action(update, context, "approved")


async def cmd_reject(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _handle_hitl_action(update, context, "rejected")


async def cmd_workspace(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_chat or not update.message:
        return
    app = context.application
    redis: Redis = app.bot_data["redis"]
    client: httpx.AsyncClient = app.bot_data["http_client"]
    cfg: BotConfig = app.bot_data["config"]
    chat_id = str(update.effective_chat.id)

    tenant_id = None
    workspace_name = None
    if context.args:
        tenant_id = context.args[0].strip() or None
    if len(context.args) > 1:
        workspace_name = " ".join(context.args[1:]).strip() or None

    result = await _post_workspace_ensure(
        client=client,
        cfg=cfg,
        chat_id=chat_id,
        tenant_id=tenant_id,
        workspace_name=workspace_name,
    )
    await _append_memory(
        redis,
        chat_id=chat_id,
        role="assistant",
        text=f"workspace ensure result: {result}",
        max_items=cfg.memory_max_items,
    )
    if not result.get("ok"):
        await update.message.reply_text(f"Workspace ensure failed: {result.get('error', 'unknown_error')}")
        return

    workspace = result.get("workspace", {})
    workspace_slug = result.get("workspace", {}).get("slug") or result.get("workspace_slug")
    await update.message.reply_text(
        "Workspace ready:\n"
        f"- slug: {workspace_slug}\n"
        f"- created: {result.get('created')}\n"
        f"- detail: {workspace}"
    )


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_chat or not update.message or not update.message.text:
        return
    app = context.application
    redis: Redis = app.bot_data["redis"]
    client: httpx.AsyncClient = app.bot_data["http_client"]
    cfg: BotConfig = app.bot_data["config"]
    chat_id = str(update.effective_chat.id)
    text = update.message.text.strip()

    allowed = await _allow_message(redis, chat_id, cfg.rate_limit_per_min)
    if not allowed:
        await update.message.reply_text("Too many requests. Please retry later (rate limit active).")
        return

    await _append_memory(redis, chat_id=chat_id, role="user", text=text, max_items=cfg.memory_max_items)
    try:
        data = await _post_chat_gateway(client, cfg.backend_base_url, chat_id, text)
        routed = data.get("routed", "unknown")
        ack = f"Accepted. Routed to `{routed}`."
        await _append_memory(redis, chat_id=chat_id, role="assistant", text=ack, max_items=cfg.memory_max_items)
        await update.message.reply_text(ack, parse_mode=ParseMode.MARKDOWN)
    except Exception as exc:  # noqa: BLE001
        err_text = f"Gateway call failed: {exc}"
        await _append_memory(redis, chat_id=chat_id, role="assistant", text=err_text, max_items=cfg.memory_max_items)
        await update.message.reply_text(err_text)


async def on_startup(app: Application) -> None:
    cfg: BotConfig = app.bot_data["config"]
    app.bot_data["redis"] = Redis.from_url(cfg.redis_url, decode_responses=True)
    app.bot_data["http_client"] = httpx.AsyncClient(timeout=30.0)


async def on_shutdown(app: Application) -> None:
    redis: Redis | None = app.bot_data.get("redis")
    client: httpx.AsyncClient | None = app.bot_data.get("http_client")
    if client is not None:
        await client.aclose()
    if redis is not None:
        await redis.close()


async def main() -> None:
    cfg = load_config()
    application = (
        Application.builder()
        .token(cfg.token)
        .post_init(on_startup)
        .post_shutdown(on_shutdown)
        .build()
    )
    application.bot_data["config"] = cfg

    application.add_handler(CommandHandler("start", cmd_start))
    application.add_handler(CommandHandler("memories", cmd_memories))
    application.add_handler(CommandHandler("workspace", cmd_workspace))
    application.add_handler(CommandHandler("approve", cmd_approve))
    application.add_handler(CommandHandler("reject", cmd_reject))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))

    await application.initialize()
    await application.start()
    await application.updater.start_polling(allowed_updates=Update.ALL_TYPES)
    print("telegram bot started (polling)")
    try:
        while True:
            await asyncio.sleep(60)
    finally:
        await application.updater.stop()
        await application.stop()
        await application.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
