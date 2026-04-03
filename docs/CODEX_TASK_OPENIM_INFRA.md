# Codex 任务：借鉴 OpenIM 的基础设施升级 — 连接管理 + Webhook 回调 + 消息队列

## 任务背景

我们的 `dragon-senate-saas-v2/app.py` 已有：
- ✅ Edge 注册 (`/edge/register`)、心跳 (`/edge/heartbeat`)、Outbox 轮询 (`/edge/pull/{edge_id}`)
- ✅ HITL 审批系统 (`/hitl/pending`, `/hitl/decide`)
- ✅ 飞书/钉钉/Telegram 多通道推送
- ✅ `edge_registry` 和 `edge_outbox` 内存字典
- ✅ `lossless_memory` 事件记录

**缺少的**（借鉴 OpenIM 的 3 个关键架构模式）：
1. **WebSocket 连接管理器** — 目前没有服务端 WS 连接管理，无法实时推送龙虾执行结果
2. **Before/After Webhook 回调** — 龙虾执行前无法拦截/修改，执行后通知不够结构化
3. **Redis Streams 消息队列** — 龙虾结果投递和多消费者解耦

**注意**：不要修改任何现有函数的签名和行为，所有功能都是**新增**。

---

## 任务 1：新建 `ws_connection_manager.py` — WebSocket 连接管理器

**新文件**: `dragon-senate-saas-v2/ws_connection_manager.py`

借鉴 OpenIM 的 `ws_server.go` 中 UserMap + 多端互踢 + 注册/注销通道模式。

```python
"""
WebSocket Connection Manager — 借鉴 OpenIM msggateway/ws_server.go

管理所有 WebSocket 连接的注册、注销、多端互踢、广播。
每个用户可以有多个连接（不同设备/页面），用 user_id + device_id 索引。

用途：
- 龙虾执行结果实时推送到操控台
- Edge Agent 在线状态实时同步
- HITL 审批通知实时推送
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket


@dataclass
class ClientConnection:
    """一个 WebSocket 客户端连接。"""
    user_id: str
    tenant_id: str
    device_id: str  # 浏览器 tab / 移动端 / edge_id
    platform: str   # "web" | "mobile" | "edge" | "api"
    ws: WebSocket
    connected_at: float = field(default_factory=time.time)
    last_ping_at: float = field(default_factory=time.time)
    metadata: dict[str, Any] = field(default_factory=dict)


class KickPolicy:
    """多端互踢策略（借鉴 OpenIM 的 MultiLogin.Policy）"""
    NONE = "none"                       # 不互踢，所有连接共存
    SAME_DEVICE_KICK = "same_device"    # 同设备互踢（默认）
    SAME_PLATFORM_KICK = "same_platform"  # 同平台互踢
    SINGLE_SESSION = "single_session"   # 只保留最新连接


class ConnectionManager:
    """
    WebSocket 连接管理器。
    
    借鉴 OpenIM WsServer 的核心设计：
    - UserMap: user_id → {device_id: ClientConnection}
    - registerChan / unregisterChan 通道模式
    - 多端登录策略
    - 在线用户数/连接数统计
    """

    def __init__(self, kick_policy: str = KickPolicy.SAME_DEVICE_KICK):
        # user_id → {device_id → ClientConnection}
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
        """
        注册新连接。根据互踢策略处理已有连接。
        
        Returns:
            新注册的 ClientConnection
        """
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

        # 根据策略互踢
        kicked = await self._apply_kick_policy(user_id, client)

        # 注册新连接
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

        # 如果用户没有任何连接了，清理
        if not user_conns:
            self._connections.pop(user_id, None)
            self._online_user_count = max(0, self._online_user_count - 1)

        print(
            f"[ws_manager] unregister: user={user_id} device={device_id} "
            f"online_users={self._online_user_count} online_conns={self._online_conn_count}"
        )

        # 安全关闭 WebSocket
        try:
            await client.ws.close()
        except Exception:  # noqa: BLE001
            pass

    def get_user_connections(self, user_id: str) -> list[ClientConnection]:
        """获取用户的所有活跃连接。"""
        user_conns = self._connections.get(user_id)
        if not user_conns:
            return []
        return list(user_conns.values())

    def get_user_platforms(self, user_id: str) -> list[str]:
        """获取用户在线的平台列表。"""
        return list({c.platform for c in self.get_user_connections(user_id)})

    def is_user_online(self, user_id: str) -> bool:
        """检查用户是否在线。"""
        return bool(self._connections.get(user_id))

    def get_online_users(self, tenant_id: str | None = None) -> list[str]:
        """获取在线用户列表，可按租户过滤。"""
        if tenant_id is None:
            return list(self._connections.keys())
        result = []
        for uid, conns in self._connections.items():
            if any(c.tenant_id == tenant_id for c in conns.values()):
                result.append(uid)
        return result

    async def send_to_user(self, user_id: str, message: dict[str, Any]) -> int:
        """
        向用户的所有连接发送消息。
        
        Returns:
            成功发送的连接数
        """
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

        # 清理断开的连接
        for device_id in failed_devices:
            await self.unregister(user_id, device_id)

        return sent

    async def broadcast_to_tenant(self, tenant_id: str, message: dict[str, Any]) -> int:
        """向租户的所有在线用户广播消息。"""
        users = self.get_online_users(tenant_id)
        total = 0
        for uid in users:
            total += await self.send_to_user(uid, message)
        return total

    async def broadcast_all(self, message: dict[str, Any]) -> int:
        """向所有在线用户广播消息。"""
        total = 0
        for uid in list(self._connections.keys()):
            total += await self.send_to_user(uid, message)
        return total

    def update_ping(self, user_id: str, device_id: str) -> None:
        """更新心跳时间。"""
        user_conns = self._connections.get(user_id)
        if user_conns and device_id in user_conns:
            user_conns[device_id].last_ping_at = time.time()

    def snapshot(self) -> dict[str, Any]:
        """当前状态快照。"""
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
                    }
                    for c in conns.values()
                ]
                for uid, conns in self._connections.items()
            },
        }

    async def _apply_kick_policy(
        self, user_id: str, new_client: ClientConnection
    ) -> list[ClientConnection]:
        """根据互踢策略踢掉旧连接。返回被踢的连接列表。"""
        user_conns = self._connections.get(user_id)
        if not user_conns:
            return []

        to_kick: list[ClientConnection] = []

        if self._kick_policy == KickPolicy.NONE:
            return []

        elif self._kick_policy == KickPolicy.SAME_DEVICE_KICK:
            # 同设备互踢
            existing = user_conns.get(new_client.device_id)
            if existing:
                to_kick.append(existing)

        elif self._kick_policy == KickPolicy.SAME_PLATFORM_KICK:
            # 同平台互踢
            for device_id, client in list(user_conns.items()):
                if client.platform == new_client.platform:
                    to_kick.append(client)

        elif self._kick_policy == KickPolicy.SINGLE_SESSION:
            # 只保留最新，踢掉所有旧的
            to_kick.extend(user_conns.values())

        # 执行互踢
        for client in to_kick:
            user_conns.pop(client.device_id, None)
            self._online_conn_count = max(0, self._online_conn_count - 1)
            try:
                await client.ws.send_text(json.dumps({
                    "type": "kicked",
                    "reason": f"new_login_{self._kick_policy}",
                    "device_id": new_client.device_id,
                }))
                await client.ws.close(code=4001, reason="kicked_by_new_login")
            except Exception:  # noqa: BLE001
                pass

        return to_kick


# ── 模块级单例 ──
_manager: ConnectionManager | None = None


def get_connection_manager() -> ConnectionManager:
    """获取全局 ConnectionManager 单例。"""
    global _manager
    if _manager is None:
        _manager = ConnectionManager(kick_policy=KickPolicy.SAME_DEVICE_KICK)
    return _manager
```

---

## 任务 2：新建 `lobster_webhook.py` — Before/After Webhook 回调系统

**新文件**: `dragon-senate-saas-v2/lobster_webhook.py`

借鉴 OpenIM 的 `callbackstruct/` Before/After 回调模式。

```python
"""
Lobster Webhook — Before/After 执行回调系统。

借鉴 OpenIM callbackstruct 的设计：
- Before: 龙虾执行前调用，可拦截/修改输入
- After: 龙虾执行后调用，通知业务系统

与现有系统的关系：
- 不替代 lossless_memory（事件记录）
- 不替代 HITL（人工审批）
- 是在 lobster_runner.py 执行链中新增的钩子层

用途：
- Before echoer.reply → 检查回复是否合规
- Before dispatcher.publish → 外部审批
- After catcher.capture_lead → 通知 CRM
- After abacus.score → 推送评分到钉钉
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable


@dataclass
class WebhookBeforeRequest:
    """执行前回调请求。"""
    lobster: str           # 哪只虾: "echoer", "strategist" 等
    action: str            # 什么动作: "reply_comment", "generate_strategy" 等
    tenant_id: str
    user_id: str
    trace_id: str
    payload: dict[str, Any]  # 龙虾的原始输入
    timestamp: float = field(default_factory=time.time)


@dataclass
class WebhookBeforeResponse:
    """执行前回调响应。"""
    allow: bool = True               # 是否允许继续执行
    modified_payload: dict[str, Any] | None = None  # 修改后的输入（None 表示不修改）
    reason: str = ""                 # 拦截/修改原因
    latency_ms: float = 0.0


@dataclass
class WebhookAfterRequest:
    """执行后回调请求。"""
    lobster: str
    action: str
    tenant_id: str
    user_id: str
    trace_id: str
    payload: dict[str, Any]   # 龙虾的原始输入
    result: dict[str, Any]    # 龙虾的执行结果
    duration_ms: float        # 执行耗时
    success: bool             # 是否成功
    error: str | None = None  # 错误信息
    timestamp: float = field(default_factory=time.time)


# ── 回调类型 ──
BeforeCallback = Callable[[WebhookBeforeRequest], Awaitable[WebhookBeforeResponse]]
AfterCallback = Callable[[WebhookAfterRequest], Awaitable[None]]


class LobsterWebhookRegistry:
    """
    管理所有龙虾的 Before/After 回调。
    
    使用方式：
        registry = get_webhook_registry()
        
        # 注册回调
        registry.register_before("echoer", "reply_comment", my_compliance_check)
        registry.register_after("catcher", "capture_lead", my_crm_notify)
        
        # 在 lobster_runner 中调用
        before_resp = await registry.fire_before(before_req)
        if not before_resp.allow:
            return {"blocked": True, "reason": before_resp.reason}
        
        result = await lobster.run(before_resp.modified_payload or original_payload)
        
        await registry.fire_after(after_req)
    """

    def __init__(self) -> None:
        # (lobster, action) → list of callbacks
        self._before_hooks: dict[tuple[str, str], list[BeforeCallback]] = {}
        self._after_hooks: dict[tuple[str, str], list[AfterCallback]] = {}
        # 通配符: ("*", "*") 匹配所有
        self._global_before: list[BeforeCallback] = []
        self._global_after: list[AfterCallback] = []

    def register_before(
        self,
        lobster: str,
        action: str,
        callback: BeforeCallback,
    ) -> None:
        """注册执行前回调。lobster="*" 或 action="*" 表示通配。"""
        if lobster == "*" and action == "*":
            self._global_before.append(callback)
        else:
            key = (lobster.lower(), action.lower())
            self._before_hooks.setdefault(key, []).append(callback)

    def register_after(
        self,
        lobster: str,
        action: str,
        callback: AfterCallback,
    ) -> None:
        """注册执行后回调。"""
        if lobster == "*" and action == "*":
            self._global_after.append(callback)
        else:
            key = (lobster.lower(), action.lower())
            self._after_hooks.setdefault(key, []).append(callback)

    def unregister_all(self, lobster: str, action: str) -> int:
        """移除指定龙虾+动作的所有回调。返回移除数量。"""
        key = (lobster.lower(), action.lower())
        count = len(self._before_hooks.pop(key, []))
        count += len(self._after_hooks.pop(key, []))
        return count

    async def fire_before(self, request: WebhookBeforeRequest) -> WebhookBeforeResponse:
        """
        触发所有匹配的 Before 回调。
        
        规则：
        1. 先执行精确匹配的回调，再执行通配符回调
        2. 任何一个回调返回 allow=False，整体拦截
        3. 如果有 modified_payload，用最后一个修改的
        4. 记录总延迟
        """
        started = time.time()
        final_response = WebhookBeforeResponse(allow=True)
        current_payload = dict(request.payload)

        key = (request.lobster.lower(), request.action.lower())
        
        # 收集所有匹配的回调
        callbacks: list[BeforeCallback] = []
        callbacks.extend(self._before_hooks.get(key, []))
        # 通配符匹配
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
                # 回调失败不阻塞执行

        final_response.latency_ms = round((time.time() - started) * 1000, 2)
        return final_response

    async def fire_after(self, request: WebhookAfterRequest) -> None:
        """
        触发所有匹配的 After 回调。
        
        规则：
        1. After 回调不影响执行结果（fire-and-forget 语义）
        2. 回调失败只打日志，不抛异常
        """
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
        """返回当前注册的回调概览。"""
        before_keys = list(self._before_hooks.keys())
        after_keys = list(self._after_hooks.keys())
        return {
            "before_hooks": {
                f"{k[0]}.{k[1]}": len(v) for k, v in self._before_hooks.items()
            },
            "after_hooks": {
                f"{k[0]}.{k[1]}": len(v) for k, v in self._after_hooks.items()
            },
            "global_before_count": len(self._global_before),
            "global_after_count": len(self._global_after),
            "total_before": sum(len(v) for v in self._before_hooks.values()) + len(self._global_before),
            "total_after": sum(len(v) for v in self._after_hooks.values()) + len(self._global_after),
        }


# ── 模块级单例 ──
_registry: LobsterWebhookRegistry | None = None


def get_webhook_registry() -> LobsterWebhookRegistry:
    """获取全局 LobsterWebhookRegistry 单例。"""
    global _registry
    if _registry is None:
        _registry = LobsterWebhookRegistry()
    return _registry
```

---

## 任务 3：新建 `lobster_event_bus.py` — Redis Streams 消息队列

**新文件**: `dragon-senate-saas-v2/lobster_event_bus.py`

借鉴 OpenIM 的 Kafka ToPush / ToOfflinePush 双 Topic 模式，用 Redis Streams 轻量实现。

```python
"""
Lobster Event Bus — Redis Streams 消息队列。

借鉴 OpenIM push.go 的 Kafka 双 Topic 模式：
- ToPush → 在线推送（通过 WebSocket 直推）
- ToOfflinePush → 离线推送（飞书/钉钉/Telegram）

我们的实现：
- Stream "lobster:results:{tenant_id}" → 龙虾执行结果
- Consumer Group 1: ws_push → 实时推送到操控台 WebSocket
- Consumer Group 2: lossless_log → 写入 lossless_memory
- Consumer Group 3: offline_notify → 推送到飞书/钉钉
- Consumer Group 4: downstream_trigger → 触发下游龙虾

与现有系统的关系：
- 替代 app.py 中直接调用 lossless_memory 和 send_chat_reply 的同步模式
- 解耦龙虾执行和结果投递
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable, Awaitable

try:
    from redis.asyncio import Redis
except ImportError:
    Redis = None  # type: ignore[assignment]


class LobsterEventBus:
    """
    基于 Redis Streams 的龙虾事件总线。
    
    如果 Redis 不可用，退化为内存队列 + 同步回调。
    """

    STREAM_PREFIX = "lobster:events"

    def __init__(self, redis: Any | None = None):
        self._redis: Any | None = redis
        self._consumers: dict[str, list[Callable]] = {}  # group_name → [callback]
        self._memory_queue: list[dict[str, Any]] = []  # fallback when no Redis

    @property
    def has_redis(self) -> bool:
        return self._redis is not None

    def _stream_key(self, tenant_id: str) -> str:
        return f"{self.STREAM_PREFIX}:{tenant_id}"

    async def publish(
        self,
        *,
        tenant_id: str,
        lobster: str,
        action: str,
        trace_id: str,
        user_id: str,
        payload: dict[str, Any],
        event_type: str = "result",
    ) -> str:
        """
        发布龙虾事件到 Stream。
        
        Returns:
            Redis Stream message ID, 或内存 fallback 的时间戳 ID
        """
        message = {
            "lobster": lobster,
            "action": action,
            "trace_id": trace_id,
            "user_id": user_id,
            "tenant_id": tenant_id,
            "event_type": event_type,
            "payload": json.dumps(payload, ensure_ascii=False, default=str),
            "ts": str(time.time()),
        }

        if self._redis is not None:
            try:
                stream_key = self._stream_key(tenant_id)
                msg_id = await self._redis.xadd(
                    stream_key,
                    message,
                    maxlen=10000,  # 保留最近 1 万条
                )
                # 同时触发已注册的消费者（push 模式）
                await self._dispatch_to_consumers(message)
                return str(msg_id)
            except Exception as exc:  # noqa: BLE001
                print(f"[event_bus] redis xadd failed, fallback to memory: {exc}")

        # 内存 fallback
        fallback_id = f"mem_{int(time.time() * 1000)}"
        message["_id"] = fallback_id
        self._memory_queue.append(message)
        # 保留最近 1000 条
        if len(self._memory_queue) > 1000:
            self._memory_queue = self._memory_queue[-1000:]
        await self._dispatch_to_consumers(message)
        return fallback_id

    def register_consumer(
        self,
        group: str,
        callback: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        """
        注册消费者回调。
        
        消费者组示例：
        - "ws_push": 推送到 WebSocket 连接
        - "lossless_log": 写入 lossless_memory
        - "offline_notify": 推送到飞书/钉钉
        - "downstream_trigger": 触发下游龙虾
        """
        self._consumers.setdefault(group, []).append(callback)

    async def _dispatch_to_consumers(self, message: dict[str, Any]) -> None:
        """分发消息到所有已注册的消费者。"""
        for group, callbacks in self._consumers.items():
            for callback in callbacks:
                try:
                    await callback(message)
                except Exception as exc:  # noqa: BLE001
                    print(f"[event_bus] consumer {group} error: {exc}")

    async def read_recent(
        self,
        tenant_id: str,
        count: int = 50,
        since_ms: int | None = None,
    ) -> list[dict[str, Any]]:
        """
        读取最近的事件（用于 API 查询）。
        
        Args:
            tenant_id: 租户隔离
            count: 返回数量
            since_ms: 从这个时间戳开始（毫秒）
        """
        if self._redis is not None:
            try:
                stream_key = self._stream_key(tenant_id)
                start = f"{since_ms}-0" if since_ms else "-"
                raw = await self._redis.xrevrange(stream_key, "+", start, count=count)
                results = []
                for msg_id, fields in raw:
                    entry = dict(fields)
                    entry["_id"] = str(msg_id)
                    # 解析 payload JSON
                    if "payload" in entry:
                        try:
                            entry["payload"] = json.loads(entry["payload"])
                        except (json.JSONDecodeError, TypeError):
                            pass
                    results.append(entry)
                return results
            except Exception as exc:  # noqa: BLE001
                print(f"[event_bus] redis xrevrange failed: {exc}")

        # 内存 fallback
        filtered = [
            msg for msg in self._memory_queue
            if msg.get("tenant_id") == tenant_id
        ]
        filtered.sort(key=lambda x: float(x.get("ts", 0)), reverse=True)
        return filtered[:count]

    def snapshot(self) -> dict[str, Any]:
        """当前状态快照。"""
        return {
            "has_redis": self.has_redis,
            "consumer_groups": {k: len(v) for k, v in self._consumers.items()},
            "memory_queue_size": len(self._memory_queue),
        }


# ── 模块级单例 ──
_bus: LobsterEventBus | None = None


def get_event_bus() -> LobsterEventBus:
    """获取全局 LobsterEventBus 单例。"""
    global _bus
    if _bus is None:
        _bus = LobsterEventBus()
    return _bus


def init_event_bus(redis: Any | None = None) -> LobsterEventBus:
    """初始化全局 EventBus（在 app lifespan 中调用）。"""
    global _bus
    _bus = LobsterEventBus(redis=redis)
    return _bus
```

---

## 任务 4：在 `app.py` 中集成以上模块

**文件**: `dragon-senate-saas-v2/app.py`

### 4.1 添加 import（在现有 import 区域附近）

```python
from ws_connection_manager import get_connection_manager, ClientConnection
from lobster_webhook import get_webhook_registry
from lobster_event_bus import get_event_bus, init_event_bus
```

### 4.2 在 lifespan 中初始化

在 `lifespan()` 函数中，`app.state.redis = redis` 之后添加：

```python
            # ── 初始化 OpenIM 借鉴的基础设施 ──
            event_bus = init_event_bus(redis=redis)
            app.state.event_bus = event_bus
            app.state.ws_manager = get_connection_manager()
            app.state.webhook_registry = get_webhook_registry()

            # 注册默认消费者：WebSocket 实时推送
            async def _ws_push_consumer(message: dict[str, Any]) -> None:
                user_id = str(message.get("user_id") or "").strip()
                if user_id:
                    ws_manager = getattr(app.state, "ws_manager", None)
                    if ws_manager:
                        await ws_manager.send_to_user(user_id, {
                            "type": "lobster_event",
                            "lobster": message.get("lobster"),
                            "action": message.get("action"),
                            "trace_id": message.get("trace_id"),
                            "event_type": message.get("event_type"),
                            "payload": message.get("payload"),
                        })

            # 注册默认消费者：lossless_memory 记录
            async def _lossless_log_consumer(message: dict[str, Any]) -> None:
                try:
                    payload = message.get("payload")
                    if isinstance(payload, str):
                        try:
                            payload = json.loads(payload)
                        except (json.JSONDecodeError, TypeError):
                            payload = {"raw": payload}
                    append_lossless_event(
                        user_id=str(message.get("user_id") or "system"),
                        trace_id=str(message.get("trace_id") or ""),
                        node=f"lobster.{message.get('lobster', 'unknown')}",
                        event_type=str(message.get("action") or message.get("event_type") or "result"),
                        payload=payload if isinstance(payload, dict) else {"data": payload},
                        level="info",
                    )
                except Exception:  # noqa: BLE001
                    pass

            event_bus.register_consumer("ws_push", _ws_push_consumer)
            event_bus.register_consumer("lossless_log", _lossless_log_consumer)
```

### 4.3 添加 WebSocket endpoint

在 `/webhook/chat_gateway` endpoint 附近添加：

```python
@app.websocket("/ws/console")
async def ws_console(websocket: WebSocket):
    """
    操控台 WebSocket 连接。
    
    连接参数 (query string):
    - token: JWT access token
    - device_id: 设备标识（可选，默认 "web_{timestamp}"）
    - platform: 平台标识（可选，默认 "web"）
    """
    await websocket.accept()

    # 从 query params 获取认证信息
    token = websocket.query_params.get("token", "").strip()
    device_id = websocket.query_params.get("device_id", "").strip()
    platform = websocket.query_params.get("platform", "web").strip()

    if not token:
        await websocket.send_json({"type": "error", "message": "token required"})
        await websocket.close(code=4001, reason="missing_token")
        return

    # 验证 token
    claims = _decode_legacy_user(token)
    if claims is None:
        auth_user = await get_user_from_access_token(token)
        if auth_user is not None:
            mapped = claims_from_user(auth_user)
            claims = UserClaims(
                sub=mapped.sub,
                tenant_id=mapped.tenant_id,
                roles=mapped.roles,
            )

    if claims is None:
        await websocket.send_json({"type": "error", "message": "invalid_token"})
        await websocket.close(code=4001, reason="invalid_token")
        return

    if not device_id:
        device_id = f"web_{int(time.time() * 1000)}"

    ws_manager = getattr(app.state, "ws_manager", get_connection_manager())
    client = await ws_manager.register(
        ws=websocket,
        user_id=claims.sub,
        tenant_id=claims.tenant_id,
        device_id=device_id,
        platform=platform,
    )

    # 发送连接成功消息
    await websocket.send_json({
        "type": "connected",
        "user_id": claims.sub,
        "device_id": device_id,
        "online_users": ws_manager.online_user_count,
        "online_conns": ws_manager.online_conn_count,
    })

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                msg = {"type": "text", "content": data}

            msg_type = str(msg.get("type", "")).strip().lower()

            if msg_type == "ping":
                ws_manager.update_ping(claims.sub, device_id)
                await websocket.send_json({"type": "pong", "ts": time.time()})

            elif msg_type == "subscribe":
                # 可扩展：订阅特定事件类型
                await websocket.send_json({"type": "subscribed", "channel": msg.get("channel")})

            else:
                await websocket.send_json({"type": "ack", "received": msg_type})

    except Exception:  # noqa: BLE001
        pass
    finally:
        await ws_manager.unregister(claims.sub, device_id)
```

### 4.4 添加管理 API

```python
@app.get("/ws/status")
async def ws_connection_status(current_user: UserClaims = Depends(_decode_user)):
    """WebSocket 连接管理器状态。"""
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    ws_manager = getattr(app.state, "ws_manager", get_connection_manager())
    return {"ok": True, "ws_manager": ws_manager.snapshot()}


@app.get("/webhook/registry")
async def webhook_registry_status(current_user: UserClaims = Depends(_decode_user)):
    """Webhook 回调注册表状态。"""
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    registry = getattr(app.state, "webhook_registry", get_webhook_registry())
    return {"ok": True, "webhook_registry": registry.describe()}


@app.get("/events/recent")
async def events_recent(
    tenant_id: str | None = Query(default=None),
    count: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    """查询最近的龙虾事件（来自 EventBus）。"""
    effective_tenant = tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    bus = getattr(app.state, "event_bus", get_event_bus())
    events = await bus.read_recent(effective_tenant, count=count)
    return {"ok": True, "count": len(events), "events": events}


@app.get("/events/bus/status")
async def events_bus_status(current_user: UserClaims = Depends(_decode_user)):
    """EventBus 状态。"""
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    bus = getattr(app.state, "event_bus", get_event_bus())
    return {"ok": True, "event_bus": bus.snapshot()}
```

### 4.5 在 route map 中注册

在 `@app.get("/")` 的 endpoints 字典中添加：

```python
"ws_console": "/ws/console",
"ws_status": "/ws/status",
"webhook_registry": "/webhook/registry",
"events_recent": "/events/recent",
"events_bus_status": "/events/bus/status",
```

---

## 任务 5：编写测试

**新文件**: `dragon-senate-saas-v2/tests/test_ws_connection_manager.py`

```python
"""Tests for ws_connection_manager module."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ws_connection_manager import ConnectionManager, KickPolicy, ClientConnection


class TestConnectionManager(unittest.TestCase):
    """Test ConnectionManager core functionality."""

    def _make_ws(self) -> MagicMock:
        ws = AsyncMock()
        ws.send_text = AsyncMock()
        ws.close = AsyncMock()
        return ws

    def test_register_and_count(self):
        mgr = ConnectionManager()
        ws = self._make_ws()
        asyncio.get_event_loop().run_until_complete(
            mgr.register(ws, "user1", "t1", "dev1", "web")
        )
        self.assertEqual(mgr.online_user_count, 1)
        self.assertEqual(mgr.online_conn_count, 1)
        self.assertTrue(mgr.is_user_online("user1"))

    def test_multiple_devices(self):
        mgr = ConnectionManager(kick_policy=KickPolicy.NONE)
        ws1 = self._make_ws()
        ws2 = self._make_ws()
        loop = asyncio.get_event_loop()
        loop.run_until_complete(mgr.register(ws1, "user1", "t1", "dev1", "web"))
        loop.run_until_complete(mgr.register(ws2, "user1", "t1", "dev2", "mobile"))
        self.assertEqual(mgr.online_user_count, 1)
        self.assertEqual(mgr.online_conn_count, 2)
        conns = mgr.get_user_connections("user1")
        self.assertEqual(len(conns), 2)

    def test_same_device_kick(self):
        mgr = ConnectionManager(kick_policy=KickPolicy.SAME_DEVICE_KICK)
        ws1 = self._make_ws()
        ws2 = self._make_ws()
        loop = asyncio.get_event_loop()
        loop.run_until_complete(mgr.register(ws1, "user1", "t1", "dev1", "web"))
        loop.run_until_complete(mgr.register(ws2, "user1", "t1", "dev1", "web"))
        # ws1 should be kicked
        self.assertEqual(mgr.online_conn_count, 1)
        conns = mgr.get_user_connections("user1")
        self.assertEqual(len(conns), 1)
        self.assertIs(conns[0].ws, ws2)

    def test_unregister(self):
        mgr = ConnectionManager()
        ws = self._make_ws()
        loop = asyncio.get_event_loop()
        loop.run_until_complete(mgr.register(ws, "user1", "t1", "dev1"))
        loop.run_until_complete(mgr.unregister("user1", "dev1"))
        self.assertEqual(mgr.online_user_count, 0)
        self.assertEqual(mgr.online_conn_count, 0)
        self.assertFalse(mgr.is_user_online("user1"))

    def test_snapshot(self):
        mgr = ConnectionManager()
        snap = mgr.snapshot()
        self.assertIn("online_user_count", snap)
        self.assertIn("online_conn_count", snap)
        self.assertIn("kick_policy", snap)

    def test_get_online_users_by_tenant(self):
        mgr = ConnectionManager(kick_policy=KickPolicy.NONE)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(mgr.register(self._make_ws(), "u1", "t1", "d1"))
        loop.run_until_complete(mgr.register(self._make_ws(), "u2", "t2", "d1"))
        self.assertEqual(mgr.get_online_users("t1"), ["u1"])
        self.assertEqual(mgr.get_online_users("t2"), ["u2"])
        self.assertEqual(len(mgr.get_online_users()), 2)


class TestKickPolicy(unittest.TestCase):
    def test_policy_values(self):
        self.assertEqual(KickPolicy.NONE, "none")
        self.assertEqual(KickPolicy.SAME_DEVICE_KICK, "same_device")
        self.assertEqual(KickPolicy.SAME_PLATFORM_KICK, "same_platform")
        self.assertEqual(KickPolicy.SINGLE_SESSION, "single_session")


if __name__ == "__main__":
    unittest.main()
```

**新文件**: `dragon-senate-saas-v2/tests/test_lobster_webhook.py`

```python
"""Tests for lobster_webhook module."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_webhook import (
    LobsterWebhookRegistry,
    WebhookBeforeRequest,
    WebhookBeforeResponse,
    WebhookAfterRequest,
)


def _make_before_req(**kwargs) -> WebhookBeforeRequest:
    defaults = {
        "lobster": "echoer",
        "action": "reply_comment",
        "tenant_id": "t1",
        "user_id": "u1",
        "trace_id": "tr1",
        "payload": {"text": "hello"},
    }
    defaults.update(kwargs)
    return WebhookBeforeRequest(**defaults)


class TestWebhookRegistry(unittest.TestCase):

    def test_no_hooks_allows(self):
        registry = LobsterWebhookRegistry()
        req = _make_before_req()
        resp = asyncio.get_event_loop().run_until_complete(registry.fire_before(req))
        self.assertTrue(resp.allow)

    def test_before_hook_blocks(self):
        registry = LobsterWebhookRegistry()

        async def block_all(req: WebhookBeforeRequest) -> WebhookBeforeResponse:
            return WebhookBeforeResponse(allow=False, reason="compliance_check_failed")

        registry.register_before("echoer", "reply_comment", block_all)
        req = _make_before_req()
        resp = asyncio.get_event_loop().run_until_complete(registry.fire_before(req))
        self.assertFalse(resp.allow)
        self.assertEqual(resp.reason, "compliance_check_failed")

    def test_before_hook_modifies_payload(self):
        registry = LobsterWebhookRegistry()

        async def modify(req: WebhookBeforeRequest) -> WebhookBeforeResponse:
            return WebhookBeforeResponse(
                allow=True,
                modified_payload={**req.payload, "sanitized": True},
            )

        registry.register_before("echoer", "reply_comment", modify)
        req = _make_before_req()
        resp = asyncio.get_event_loop().run_until_complete(registry.fire_before(req))
        self.assertTrue(resp.allow)
        self.assertTrue(resp.modified_payload["sanitized"])

    def test_after_hook_fires(self):
        registry = LobsterWebhookRegistry()
        called = []

        async def on_after(req: WebhookAfterRequest) -> None:
            called.append(req.lobster)

        registry.register_after("catcher", "capture_lead", on_after)
        after_req = WebhookAfterRequest(
            lobster="catcher",
            action="capture_lead",
            tenant_id="t1",
            user_id="u1",
            trace_id="tr1",
            payload={},
            result={"score": 85},
            duration_ms=100,
            success=True,
        )
        asyncio.get_event_loop().run_until_complete(registry.fire_after(after_req))
        self.assertEqual(called, ["catcher"])

    def test_global_hook(self):
        registry = LobsterWebhookRegistry()
        called = []

        async def global_after(req: WebhookAfterRequest) -> None:
            called.append(f"{req.lobster}.{req.action}")

        registry.register_after("*", "*", global_after)
        after_req = WebhookAfterRequest(
            lobster="abacus", action="score", tenant_id="t1",
            user_id="u1", trace_id="tr1", payload={},
            result={}, duration_ms=50, success=True,
        )
        asyncio.get_event_loop().run_until_complete(registry.fire_after(after_req))
        self.assertEqual(called, ["abacus.score"])

    def test_describe(self):
        registry = LobsterWebhookRegistry()

        async def noop_before(req):
            return WebhookBeforeResponse()

        async def noop_after(req):
            pass

        registry.register_before("echoer", "reply", noop_before)
        registry.register_after("catcher", "capture", noop_after)
        desc = registry.describe()
        self.assertIn("before_hooks", desc)
        self.assertIn("after_hooks", desc)
        self.assertEqual(desc["total_before"], 1)
        self.assertEqual(desc["total_after"], 1)


if __name__ == "__main__":
    unittest.main()
```

**新文件**: `dragon-senate-saas-v2/tests/test_lobster_event_bus.py`

```python
"""Tests for lobster_event_bus module."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_event_bus import LobsterEventBus


class TestEventBusMemoryFallback(unittest.TestCase):
    """Test EventBus without Redis (memory fallback)."""

    def test_publish_and_read(self):
        bus = LobsterEventBus(redis=None)
        loop = asyncio.get_event_loop()
        msg_id = loop.run_until_complete(bus.publish(
            tenant_id="t1",
            lobster="echoer",
            action="reply_comment",
            trace_id="tr1",
            user_id="u1",
            payload={"text": "hello"},
        ))
        self.assertTrue(msg_id.startswith("mem_"))

        events = loop.run_until_complete(bus.read_recent("t1", count=10))
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["lobster"], "echoer")

    def test_consumer_callback(self):
        bus = LobsterEventBus(redis=None)
        received = []

        async def consumer(msg):
            received.append(msg["lobster"])

        bus.register_consumer("test_group", consumer)

        loop = asyncio.get_event_loop()
        loop.run_until_complete(bus.publish(
            tenant_id="t1", lobster="catcher", action="capture",
            trace_id="tr2", user_id="u1", payload={},
        ))
        self.assertEqual(received, ["catcher"])

    def test_tenant_isolation(self):
        bus = LobsterEventBus(redis=None)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(bus.publish(
            tenant_id="t1", lobster="a", action="x",
            trace_id="tr1", user_id="u1", payload={},
        ))
        loop.run_until_complete(bus.publish(
            tenant_id="t2", lobster="b", action="y",
            trace_id="tr2", user_id="u2", payload={},
        ))
        t1_events = loop.run_until_complete(bus.read_recent("t1"))
        t2_events = loop.run_until_complete(bus.read_recent("t2"))
        self.assertEqual(len(t1_events), 1)
        self.assertEqual(len(t2_events), 1)
        self.assertEqual(t1_events[0]["lobster"], "a")
        self.assertEqual(t2_events[0]["lobster"], "b")

    def test_snapshot(self):
        bus = LobsterEventBus(redis=None)
        snap = bus.snapshot()
        self.assertFalse(snap["has_redis"])
        self.assertEqual(snap["memory_queue_size"], 0)

    def test_memory_queue_limit(self):
        bus = LobsterEventBus(redis=None)
        loop = asyncio.get_event_loop()
        for i in range(1100):
            loop.run_until_complete(bus.publish(
                tenant_id="t1", lobster="x", action="y",
                trace_id=f"tr_{i}", user_id="u1", payload={},
            ))
        # Should be capped at 1000
        self.assertLessEqual(len(bus._memory_queue), 1000)


if __name__ == "__main__":
    unittest.main()
```

---

## 通用规则

1. **文件位置**: 所有文件在 `dragon-senate-saas-v2/` 目录下
2. **不引入新依赖**: 只用标准库 + 已有的 `redis.asyncio` + `fastapi`
3. **不修改现有函数**: 所有功能都是新增
4. **保持现有系统运行**: `edge_registry`, `edge_outbox`, `hitl_pending` 等继续工作
5. **模块级单例**: 每个模块提供 `get_xxx()` 获取单例
6. **日志格式**: `print(f"[ws_manager] ...")`, `print(f"[lobster_webhook] ...")`, `print(f"[event_bus] ...")`
7. **Lazy import**: `app.py` 中在 lifespan 内初始化

---

## 文件清单

```
dragon-senate-saas-v2/
├── ws_connection_manager.py           # 新建 — WebSocket 连接管理器
├── lobster_webhook.py                 # 新建 — Before/After Webhook 回调
├── lobster_event_bus.py               # 新建 — Redis Streams 消息队列
├── app.py                             # 修改 — 集成以上 3 个模块 + 新增 5 个 endpoint
├── tests/
│   ├── test_ws_connection_manager.py  # 新建 — 连接管理器测试
│   ├── test_lobster_webhook.py        # 新建 — Webhook 回调测试
│   └── test_lobster_event_bus.py      # 新建 — 消息队列测试
```

## 验证标准

1. ✅ `ConnectionManager.register()` 正确注册连接并更新计数
2. ✅ `KickPolicy.SAME_DEVICE_KICK` 正确踢掉同设备旧连接
3. ✅ `ConnectionManager.send_to_user()` 向用户所有连接发送消息
4. ✅ `ConnectionManager.unregister()` 正确注销连接并更新计数
5. ✅ `LobsterWebhookRegistry.fire_before()` 支持拦截和修改
6. ✅ `LobsterWebhookRegistry.fire_after()` 支持通知且不阻塞
7. ✅ 全局通配符回调 `("*", "*")` 匹配所有龙虾和动作
8. ✅ `LobsterEventBus.publish()` 在无 Redis 时退化为内存队列
9. ✅ `LobsterEventBus.register_consumer()` 消费者收到消息
10. ✅ 租户隔离：不同 tenant_id 的事件互不影响
11. ✅ `/ws/console` WebSocket endpoint 正确认证和连接
12. ✅ 所有测试通过
