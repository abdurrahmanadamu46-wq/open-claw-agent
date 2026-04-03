"""
ChannelAccountManager — 渠道多账号管理器

借鉴 openclaw-docker-cn-im 的多账号 JSON 管理模式。
"""

from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class ChannelAccount:
    """单个渠道账号配置"""

    account_id: str
    channel: str
    tenant_id: str = ""
    name: str = ""
    enabled: bool = True
    credentials: dict[str, str] = field(default_factory=dict)
    options: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class SentChannelMessage:
    message_id: str
    chat_id: str
    account_id: str
    channel: str
    text: str = ""
    media_path: str = ""
    media_type: str = "text"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


class ChannelSender:
    def __init__(self, account: ChannelAccount) -> None:
        self.account = account
        self._message_store: dict[str, SentChannelMessage] = {}

    async def send_text(self, chat_id: str, text: str) -> str:
        message_id = f"msg_{uuid.uuid4().hex[:12]}"
        self._message_store[message_id] = SentChannelMessage(
            message_id=message_id,
            chat_id=str(chat_id or "").strip(),
            account_id=self.account.account_id,
            channel=self.account.channel,
            text=str(text or ""),
            media_type="text",
        )
        return message_id

    async def send_media(self, *, file_path: str, media_type: str, caption: str = "", chat_id: str = "") -> bool:
        message_id = f"media_{uuid.uuid4().hex[:12]}"
        self._message_store[message_id] = SentChannelMessage(
            message_id=message_id,
            chat_id=str(chat_id or "").strip(),
            account_id=self.account.account_id,
            channel=self.account.channel,
            text=str(caption or ""),
            media_path=str(file_path or ""),
            media_type=str(media_type or "file"),
        )
        return True

    async def send_placeholder(self, chat_id: str, text: str = "正在为您处理，稍候…") -> str:
        return await self.send_text(chat_id, text)

    async def update_message(self, message_id: str, new_text: str) -> bool:
        message = self._message_store.get(str(message_id or "").strip())
        if message is None:
            return False
        message.text = str(new_text or "")
        message.updated_at = time.time()
        return True

    async def delete_message(self, message_id: str) -> bool:
        return self._message_store.pop(str(message_id or "").strip(), None) is not None

    def get_message(self, message_id: str) -> SentChannelMessage | None:
        return self._message_store.get(str(message_id or "").strip())


def _env_enabled(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


class ChannelAccountManager:
    """
    管理所有渠道的所有账号。
    """

    def __init__(self) -> None:
        self._accounts: dict[str, dict[str, ChannelAccount]] = {}
        self._senders: dict[str, ChannelSender] = {}
        self.reload_from_env()

    def reload_from_env(self) -> None:
        """从环境变量加载所有渠道账号"""
        self._accounts = {}
        self._senders = {}
        channels = [
            "feishu",
            "dingtalk",
            "wecom",
            "douyin",
            "xiaohongshu",
            "kuaishou",
            "taobao",
            "jd",
            "pdd",
            "wechat",
            "telegram",
            "qqbot",
        ]
        for channel in channels:
            self._load_channel_accounts(channel)

    def _load_channel_accounts(self, channel: str) -> None:
        """加载单个渠道的账号配置"""
        prefix = channel.upper()
        accounts: dict[str, ChannelAccount] = {}

        json_env = os.getenv(f"{prefix}_ACCOUNTS_JSON", "").strip()
        if json_env:
            try:
                accounts_data = json.loads(json_env)
                if isinstance(accounts_data, list):
                    for item in accounts_data:
                        if not isinstance(item, dict):
                            continue
                        acc_id = str(item.get("id") or item.get("account_id") or f"{channel}_auto_{len(accounts)}")
                        credentials = {
                            k: str(v)
                            for k, v in item.items()
                            if k
                            in (
                                "app_key",
                                "app_secret",
                                "app_id",
                                "access_token",
                                "client_id",
                                "client_secret",
                                "bot_id",
                                "secret",
                                "corp_id",
                                "corp_secret",
                                "agent_id",
                                "session_key",
                                "bot_webhook",
                                "session_webhook",
                                "robot_code",
                            )
                            and str(v).strip()
                        }
                        options = {
                            k: v
                            for k, v in item.items()
                            if k
                            in (
                                "dm_policy",
                                "dm_scope",
                                "group_policy",
                                "allow_from",
                                "streaming",
                                "require_mention",
                                "welcome_message",
                                "group_respond_mode",
                                "thinking_placeholder_enabled",
                                "thinking_threshold_ms",
                            )
                        }
                        accounts[acc_id] = ChannelAccount(
                            account_id=acc_id,
                            channel=channel,
                            tenant_id=str(item.get("tenant_id", "")),
                            name=str(item.get("name", acc_id)),
                            enabled=bool(item.get("enabled", True)),
                            credentials=credentials,
                            options=options,
                        )
                elif isinstance(accounts_data, dict):
                    for acc_id, item in accounts_data.items():
                        if not isinstance(item, dict):
                            continue
                        accounts[str(acc_id)] = ChannelAccount(
                            account_id=str(acc_id),
                            channel=channel,
                            tenant_id=str(item.get("tenant_id", "")),
                            name=str(item.get("name", acc_id)),
                            enabled=bool(item.get("enabled", True)),
                            credentials={
                                k: str(v)
                                for k, v in item.items()
                                if k not in ("tenant_id", "name", "enabled") and str(v).strip()
                            },
                            options={},
                        )
            except (json.JSONDecodeError, TypeError) as exc:
                print(f"[channel_account_manager] Failed to parse {prefix}_ACCOUNTS_JSON: {exc}")

        if not accounts:
            cred_keys = {
                "app_id": f"{prefix}_APP_ID",
                "app_key": f"{prefix}_APP_KEY",
                "app_secret": f"{prefix}_APP_SECRET",
                "access_token": f"{prefix}_ACCESS_TOKEN",
                "client_id": f"{prefix}_CLIENT_ID",
                "client_secret": f"{prefix}_CLIENT_SECRET",
                "bot_id": f"{prefix}_BOT_ID",
                "secret": f"{prefix}_SECRET",
                "corp_id": f"{prefix}_CORP_ID",
                "corp_secret": f"{prefix}_CORP_SECRET",
                "agent_id": f"{prefix}_AGENT_ID",
                "bot_webhook": f"{prefix}_BOT_WEBHOOK",
                "session_webhook": f"{prefix}_SESSION_WEBHOOK",
                "robot_code": f"{prefix}_ROBOT_CODE",
                "bot_token": f"{prefix}_BOT_TOKEN",
            }
            credentials = {}
            for key, env_name in cred_keys.items():
                val = os.getenv(env_name, "").strip()
                if val:
                    credentials[key] = val

            if credentials:
                enabled = _env_enabled(os.getenv(f"{prefix}_ENABLED", ""))
                default_acc = ChannelAccount(
                    account_id=f"{channel}_default",
                    channel=channel,
                    name=f"{channel} 默认账号",
                    enabled=enabled,
                    credentials=credentials,
                    options={
                        "dm_policy": os.getenv(f"{prefix}_DM_POLICY", "").strip(),
                        "dm_scope": os.getenv(f"{prefix}_DM_SCOPE", "").strip(),
                        "group_policy": os.getenv(f"{prefix}_GROUP_POLICY", "").strip(),
                        "allow_from": os.getenv(f"{prefix}_ALLOW_FROM", "").strip(),
                        "group_respond_mode": os.getenv(f"{prefix}_GROUP_RESPOND_MODE", "").strip() or "intent",
                        "thinking_placeholder_enabled": _env_enabled(os.getenv(f"{prefix}_THINKING_PLACEHOLDER_ENABLED", "true")),
                        "thinking_threshold_ms": int(os.getenv(f"{prefix}_THINKING_THRESHOLD_MS", "2500") or 2500),
                    },
                )
                accounts[default_acc.account_id] = default_acc

        if accounts:
            self._accounts[channel] = accounts
            for account in accounts.values():
                self._senders[f"{channel}:{account.account_id}"] = ChannelSender(account)

    def get_accounts(self, channel: str) -> dict[str, ChannelAccount]:
        """获取某渠道的所有账号"""
        return self._accounts.get(channel, {})

    def get_account(self, channel: str, account_id: str) -> ChannelAccount | None:
        """获取指定账号"""
        return self._accounts.get(channel, {}).get(account_id)

    def get_default_account(self, channel: str) -> ChannelAccount | None:
        """获取渠道的默认账号（第一个启用的）"""
        accs = self._accounts.get(channel, {})
        for acc in accs.values():
            if acc.enabled:
                return acc
        return None

    def get_accounts_by_tenant(self, tenant_id: str) -> list[ChannelAccount]:
        """获取某租户的所有账号（跨渠道）"""
        result = []
        for channel_accs in self._accounts.values():
            for acc in channel_accs.values():
                if acc.tenant_id == tenant_id and acc.enabled:
                    result.append(acc)
        return result

    def get_all_enabled_channels(self) -> list[str]:
        """获取所有有启用账号的渠道列表"""
        channels = []
        for channel, accs in self._accounts.items():
            if any(acc.enabled for acc in accs.values()):
                channels.append(channel)
        return channels

    def route_message(self, channel: str, *, tenant_id: str = "", account_id: str = "") -> ChannelAccount | None:
        """根据渠道+租户+账号ID 选择正确的账号"""
        if account_id:
            acc = self.get_account(channel, account_id)
            if acc and acc.enabled:
                return acc

        if tenant_id:
            for acc in self._accounts.get(channel, {}).values():
                if acc.tenant_id == tenant_id and acc.enabled:
                    return acc

        return self.get_default_account(channel)

    def register_account(self, account: ChannelAccount) -> None:
        """运行时动态注册账号"""
        if account.channel not in self._accounts:
            self._accounts[account.channel] = {}
        self._accounts[account.channel][account.account_id] = account

    def update_account_options(self, channel: str, account_id: str, options_patch: dict[str, Any] | None = None) -> ChannelAccount | None:
        """Update runtime channel account options such as dm_scope."""
        account = self.get_account(channel, account_id)
        if account is None:
            return None
        account.options.update(dict(options_patch or {}))
        return account

    def get_sender(self, channel_id: str) -> ChannelSender | None:
        normalized = str(channel_id or "").strip()
        if not normalized:
            return None
        sender = self._senders.get(normalized)
        if sender is not None:
            return sender
        if ":" in normalized:
            channel, account_id = normalized.split(":", 1)
            account = self.get_account(channel, account_id)
            if account is None:
                return None
            sender = ChannelSender(account)
            self._senders[normalized] = sender
            return sender
        for channel, accounts in self._accounts.items():
            account = accounts.get(normalized)
            if account is not None:
                key = f"{channel}:{account.account_id}"
                sender = self._senders.get(key)
                if sender is None:
                    sender = ChannelSender(account)
                    self._senders[key] = sender
                return sender
        return None

    def get_group_respond_mode(self, channel: str, account_id: str = "", tenant_id: str = "") -> str:
        account = self.route_message(channel, tenant_id=tenant_id, account_id=account_id)
        if account is None:
            return "intent"
        value = str(account.options.get("group_respond_mode") or "intent").strip().lower()
        return value if value in {"always", "intent", "mention_only"} else "intent"

    def get_thinking_placeholder_config(self, channel: str, account_id: str = "", tenant_id: str = "") -> dict[str, Any]:
        account = self.route_message(channel, tenant_id=tenant_id, account_id=account_id)
        if account is None:
            return {"enabled": True, "threshold_ms": 2500}
        return {
            "enabled": bool(account.options.get("thinking_placeholder_enabled", True)),
            "threshold_ms": int(account.options.get("thinking_threshold_ms", 2500) or 2500),
        }

    def unregister_account(self, channel: str, account_id: str) -> bool:
        """运行时注销账号"""
        accs = self._accounts.get(channel, {})
        if account_id in accs:
            del accs[account_id]
            return True
        return False

    def describe(self) -> dict[str, Any]:
        """返回所有渠道账号状态概览"""
        result: dict[str, Any] = {}
        for channel, accs in self._accounts.items():
            result[channel] = {
                "total": len(accs),
                "enabled": sum(1 for a in accs.values() if a.enabled),
                "accounts": [
                    {
                        "id": a.account_id,
                        "name": a.name,
                        "enabled": a.enabled,
                        "tenant": a.tenant_id,
                        "options": dict(a.options),
                    }
                    for a in accs.values()
                ],
            }
        return result


channel_account_manager = ChannelAccountManager()


def get_channel_sender(channel_id: str) -> ChannelSender | None:
    return channel_account_manager.get_sender(channel_id)
