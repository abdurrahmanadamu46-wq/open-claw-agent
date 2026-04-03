# Telegram Command Gateway

Thread: `sd-06`

Existing source anchor:

- [telegram_bot.py](/F:/openclaw-agent/dragon-senate-saas-v2/telegram_bot.py)

## 1. Boundary & Contract

Protocol:

- Telegram inbound: polling or webhook
- Backend submit/status: REST
- Result push: Telegram Bot API

Input example:

```json
{
  "schema_version": "tg.command.request.v1",
  "chat_id": "123456",
  "user_id": "tg:123456",
  "channel": "telegram",
  "text": "/run Build a strategy-only mission"
}
```

Output example:

```json
{
  "schema_version": "tg.command.result.v1",
  "status": "accepted",
  "routed": "run_dragon_team_async",
  "job_id": "job_001",
  "message_preview": "Commander queued the mission"
}
```

## 2. Core Responsibilities

- Parse commands
- Resolve chat/user binding
- Submit missions to async orchestrator
- Poll mission state
- Push summary and terminal messages back to chat

## 3. Fallback & Mock

- If backend is down, reply with queued-local or retry-later message
- If Telegram send fails, persist pending notification in Redis
- `/mission` must fall back to cached state snapshot

## 4. Independent Storage & Dependencies

- Dedicated Redis for chat memory and pending push
- Telegram Bot API credentials

## 5. Evolution Path

- Telegram-only
- Multi-channel command gateway
- Unified channel adapter layer
