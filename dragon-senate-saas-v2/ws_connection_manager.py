"""
WebSocket Connection Manager — 借鉴 OpenIM msggateway/ws_server.go

管理所有 WebSocket 连接的注册、注销、多端互踢、广播。
每个用户可以有多个连接（不同设备/页面），用 user_id + device_id 索引。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket
from session_manager import SessionContext, get_session_manager


@dataclass
class ClientConnection:
    """一个 WebSocket 客户端连接。"""

    user_id: str
    tenant_id: str
    device_id: str
    platform: str
    ws: WebSocket
    connected_at: float = field(default_factory=time.time)
    last_ping_at: float = field(default_factory=time.time)
    metadata: dict[str, Any] = field(default_factory=dict)


class KickPolicy:
    """多端互踢策略。"""

    NONE = "none"
    SAME_DEVICE_KICK = "same_device"
    SAME_PLATFORM_KICK = "same_platform"
    SINGLE_SESSION = "single_session"


class ConnectionManager:
    """
    WebSocket 连接管理器。

    user_id → {device_id → ClientConnection}
    """

    def __init__(self, kick_policy: str = KickPolicy.SAME_DEVICE_KICK):
        self._connections: dict[str, dict[str, ClientConnection]] = {}
        self._kick_policy = kick_policy
        self._online_user_count = 0
        self._online_conn_count = 0

    @property
    def online_user_count(self) -> int:
        return self._online_user_count

    @property
    def online_conn_count(self) -> int:
        return self._online_conn_count

    async def register(
        self,
        ws: WebSocket,
        user_id: str,
        tenant_id: str,
        device_id: str,
        platform: str = "web",
        metadata: dict[str, Any] | None = None,
    ) -> ClientConnection:
        """注册新连接。"""
        client = ClientConnection(
            user_id=user_id,
            tenant_id=tenant_id,
            device_id=device_id,
            platform=platform,
            ws=ws,
            metadata=metadata or {},
        )

        user_conns = self._connections.get(user_id)
        is_new_user = user_conns is None
        if is_new_user:
            self._connections[user_id] = {}
            self._online_user_count += 1

        kicked = await self._apply_kick_policy(user_id, client)
        self._connections[user_id][device_id] = client
        self._online_conn_count += 1

        print(
            f"[ws_manager] register: user={user_id} device={device_id} "
            f"platform={platform} kicked={len(kicked)} "
            f"online_users={self._online_user_count} online_conns={self._online_conn_count}"
        )
        return client

    async def unregister(self, user_id: str, device_id: str) -> None:
        """注销连接。"""
        user_conns = self._connections.get(user_id)
        if user_conns is None:
            return

        client = user_conns.pop(device_id, None)
        if client is None:
            return

        self._online_conn_count = max(0, self._online_conn_count - 1)
        if not user_conns:
            self._connections.pop(user_id, None)
            self._online_user_count = max(0, self._online_user_count - 1)

        print(
            f"[ws_manager] unregister: user={user_id} device={device_id} "
            f"online_users={self._online_user_count} online_conns={self._online_conn_count}"
        )

        try:
            await client.ws.close()
        except Exception:  # noqa: BLE001
            pass

    def get_user_connections(self, user_id: str) -> list[ClientConnection]:
        user_conns = self._connections.get(user_id)
        if not user_conns:
            return []
        return list(user_conns.values())

    def get_user_platforms(self, user_id: str) -> list[str]:
        return list({c.platform for c in self.get_user_connections(user_id)})

    def is_user_online(self, user_id: str) -> bool:
        return bool(self._connections.get(user_id))

    def get_online_users(self, tenant_id: str | None = None) -> list[str]:
        if tenant_id is None:
            return list(self._connections.keys())
        result: list[str] = []
        for uid, conns in self._connections.items():
            if any(c.tenant_id == tenant_id for c in conns.values()):
                result.append(uid)
        return result

    async def send_to_user(self, user_id: str, message: dict[str, Any]) -> int:
        """向用户的所有连接发送消息。"""
        conns = self.get_user_connections(user_id)
        if not conns:
            return 0

        payload = json.dumps(message, ensure_ascii=False, default=str)
        sent = 0
        failed_devices: list[str] = []
        for client in conns:
            try:
                await client.ws.send_text(payload)
                sent += 1
            except Exception:  # noqa: BLE001
                failed_devices.append(client.device_id)

        for device_id in failed_devices:
            await self.unregister(user_id, device_id)
        return sent

    async def broadcast_to_tenant(self, tenant_id: str, message: dict[str, Any]) -> int:
        total = 0
        for uid in self.get_online_users(tenant_id):
            total += await self.send_to_user(uid, message)
        return total

    async def broadcast_all(self, message: dict[str, Any]) -> int:
        total = 0
        for uid in list(self._connections.keys()):
            total += await self.send_to_user(uid, message)
        return total

    def update_ping(self, user_id: str, device_id: str) -> None:
        user_conns = self._connections.get(user_id)
        if user_conns and device_id in user_conns:
            user_conns[device_id].last_ping_at = time.time()

    def snapshot(self) -> dict[str, Any]:
        return {
            "online_user_count": self._online_user_count,
            "online_conn_count": self._online_conn_count,
            "kick_policy": self._kick_policy,
            "users": {
                uid: [
                    {
                        "device_id": c.device_id,
                        "platform": c.platform,
                        "connected_at": c.connected_at,
                        "last_ping_at": c.last_ping_at,
                        "dm_scope": str(c.metadata.get("dm_scope") or c.metadata.get("session_mode") or "shared"),
                    }
                    for c in conns.values()
                ]
                for uid, conns in self._connections.items()
            },
        }

    def resolve_session_for_connection(
        self,
        *,
        user_id: str,
        device_id: str,
        lobster_id: str,
        peer_id: str | None = None,
        mode: str | None = None,
        tenant_id: str | None = None,
    ) -> SessionContext | None:
        """Resolve a session context using connection metadata defaults when available."""
        user_conns = self._connections.get(user_id)
        if not user_conns:
            return None
        connection = user_conns.get(device_id)
        if connection is None:
            return None
        resolved_mode = str(
            mode
            or connection.metadata.get("dm_scope")
            or connection.metadata.get("session_mode")
            or "shared"
        )
        resolved_peer_id = str(peer_id or connection.metadata.get("peer_id") or user_id).strip() or user_id
        resolved_tenant_id = str(tenant_id or connection.tenant_id).strip() or connection.tenant_id
        return get_session_manager().get_or_create(
            peer_id=resolved_peer_id,
            lobster_id=lobster_id,
            mode=resolved_mode,
            channel=connection.platform,
            tenant_id=resolved_tenant_id,
        )

    async def _apply_kick_policy(
        self, user_id: str, new_client: ClientConnection
    ) -> list[ClientConnection]:
        """根据互踢策略踢掉旧连接。"""
        user_conns = self._connections.get(user_id)
        if not user_conns:
            return []

        to_kick: list[ClientConnection] = []
        if self._kick_policy == KickPolicy.NONE:
            return []
        if self._kick_policy == KickPolicy.SAME_DEVICE_KICK:
            existing = user_conns.get(new_client.device_id)
            if existing is not None:
                to_kick.append(existing)
        elif self._kick_policy == KickPolicy.SAME_PLATFORM_KICK:
            for client in list(user_conns.values()):
                if client.platform == new_client.platform:
                    to_kick.append(client)
        elif self._kick_policy == KickPolicy.SINGLE_SESSION:
            to_kick.extend(user_conns.values())

        for client in to_kick:
            user_conns.pop(client.device_id, None)
            self._online_conn_count = max(0, self._online_conn_count - 1)
            try:
                await client.ws.send_text(
                    json.dumps(
                        {
                            "type": "kicked",
                            "reason": f"new_login_{self._kick_policy}",
                            "device_id": new_client.device_id,
                        },
                        ensure_ascii=False,
                    )
                )
                await client.ws.close(code=4001, reason="kicked_by_new_login")
            except Exception:  # noqa: BLE001
                pass

        return to_kick


_manager: ConnectionManager | None = None


def get_connection_manager() -> ConnectionManager:
    """获取全局 ConnectionManager 单例。"""
    global _manager
    if _manager is None:
        _manager = ConnectionManager(kick_policy=KickPolicy.SAME_DEVICE_KICK)
    return _manager


def get_active_connections() -> list[dict[str, Any]]:
    """Compatibility helper: flatten active connection snapshots."""
    manager = get_connection_manager()
    snapshot = manager.snapshot()
    result: list[dict[str, Any]] = []
    for user_id, items in snapshot.get("users", {}).items():
        for item in items:
            row = dict(item)
            row["user_id"] = user_id
            result.append(row)
    return result
