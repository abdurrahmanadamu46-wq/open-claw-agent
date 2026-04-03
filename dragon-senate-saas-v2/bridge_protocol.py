"""
bridge_protocol.py — 云边桥接协议层
======================================
灵感来源：cccback-master bridge/types.ts + bridge/remoteBridgeCore.ts
         + remote/RemoteSessionManager.ts + bridge/capacityWake.ts

核心升级：
  把现有 ws_connection_manager.py 的简单 WebSocket 连接
  升级为完整的"桥接协议层"，支持：

  - Session 类型分层  : control / execution / viewer-only
  - Session 生命周期  : 连接→认证→active→断开→重连
  - Auth Token 刷新   : 自动续期，不中断任务
  - 权限回调          : 前台审批、viewer-only 隔离
  - CapacityWake      : 边缘节点唤醒原语
  - 重连策略          : 指数退避 + jitter
  - 任务活动流        : 实时推送 activity stream

工作模式（映射到龙虾执行场景）：
  assistive    — 人工主导，AI 辅助
  supervised   — AI 执行，人工随时介入
  autonomous   — AI 全自主（仅 enterprise）
  viewer_only  — 只读查看（审计/培训场景）

集成点：
  ws_connection_manager.py → 升级为使用 BridgeSession
  edge-runtime/wss_receiver.py → 注册 CapacityWake 回调
  前端 Dashboard → 消费 activity_stream
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal

from bridge_pipeline import EdgeMessage
from bridge_pipeline import EdgeMessagePipeline
from bridge_pipeline import PipelineDecision
from edge_outbox import EdgeOutbox

logger = logging.getLogger("bridge_protocol")


# ────────────────────────────────────────────────────────────────────
# 类型定义
# ────────────────────────────────────────────────────────────────────

SessionType = Literal[
    "control",    # 控制会话（commander 下指令）
    "execution",  # 执行会话（龙虾运行）
    "viewer",     # 只读查看（审计/培训）
]

WorkMode = Literal[
    "assistive",   # 人工主导，AI 辅助
    "supervised",  # AI 执行，人工随时介入
    "autonomous",  # AI 全自主（仅 enterprise）
    "viewer_only", # 只读
]

SessionStatus = Literal[
    "connecting",
    "authenticating",
    "active",
    "backgrounded",
    "reconnecting",
    "disconnected",
    "error",
]

ActivityType = Literal[
    "session_start",
    "session_end",
    "lobster_started",
    "lobster_completed",
    "lobster_failed",
    "tool_called",
    "approval_requested",
    "approval_granted",
    "approval_rejected",
    "message_sent",
    "error",
    "capacity_wake",
]


# ────────────────────────────────────────────────────────────────────
# Activity Stream — 实时活动推送
# ────────────────────────────────────────────────────────────────────

@dataclass
class ActivityEvent:
    """单个活动事件（仿 cccback session title/activity stream）"""
    activity_type: ActivityType
    session_id: str
    lobster_id: str = ""
    message: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    event_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "type": self.activity_type,
            "session_id": self.session_id,
            "lobster_id": self.lobster_id,
            "message": self.message,
            "data": self.data,
            "timestamp": self.timestamp,
        }

    def to_sse(self) -> str:
        """格式化为 SSE 事件"""
        import json
        return f"event: activity\ndata: {json.dumps(self.to_dict(), ensure_ascii=False)}\n\n"


# ────────────────────────────────────────────────────────────────────
# CapacityWake — 边缘节点唤醒原语
# 灵感来源：cccback bridge/capacityWake.ts
# ────────────────────────────────────────────────────────────────────

@dataclass
class CapacityWakeSignal:
    """
    边缘节点唤醒信号（仿 cccback capacityWake）

    当调度器有新任务时，发送此信号唤醒休眠的边缘节点。
    edge-runtime 的 wss_receiver.py 监听此信号。
    """
    edge_id: str
    tenant_id: str
    task_id: str
    priority: int = 0  # 0=normal, 1=high, 2=urgent
    payload: dict[str, Any] = field(default_factory=dict)
    signal_id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "signal_id": self.signal_id,
            "edge_id": self.edge_id,
            "tenant_id": self.tenant_id,
            "task_id": self.task_id,
            "priority": self.priority,
            "payload": self.payload,
            "created_at": self.created_at,
        }


class CapacityWakeManager:
    """
    边缘节点容量唤醒管理器。

    维护边缘节点注册表，调度器发布任务时，
    自动选择合适的边缘节点并发送唤醒信号。
    """

    def __init__(self) -> None:
        # edge_id → asyncio.Queue（每个边缘节点独立的信号队列）
        self._wake_queues: dict[str, asyncio.Queue] = {}
        # edge_id → 最后心跳时间
        self._last_heartbeat: dict[str, float] = {}
        # edge_id → 元数据
        self._edge_metadata: dict[str, dict[str, Any]] = {}

    def register_edge(
        self,
        edge_id: str,
        *,
        tenant_id: str,
        capabilities: list[str] | None = None,
    ) -> asyncio.Queue:
        """注册边缘节点，返回其唤醒信号队列"""
        if edge_id not in self._wake_queues:
            self._wake_queues[edge_id] = asyncio.Queue(maxsize=100)
        self._last_heartbeat[edge_id] = time.time()
        self._edge_metadata[edge_id] = {
            "tenant_id": tenant_id,
            "capabilities": capabilities or [],
            "registered_at": time.time(),
        }
        logger.info("[CapacityWake] 边缘节点注册：%s tenant=%s", edge_id, tenant_id)
        return self._wake_queues[edge_id]

    def heartbeat(self, edge_id: str) -> None:
        """边缘节点心跳"""
        self._last_heartbeat[edge_id] = time.time()

    def unregister_edge(self, edge_id: str) -> None:
        """注销边缘节点"""
        self._wake_queues.pop(edge_id, None)
        self._last_heartbeat.pop(edge_id, None)
        self._edge_metadata.pop(edge_id, None)
        logger.info("[CapacityWake] 边缘节点注销：%s", edge_id)

    async def wake(self, signal: CapacityWakeSignal) -> bool:
        """
        向指定边缘节点发送唤醒信号。
        返回是否成功（False = 节点不在线或队列满）
        """
        queue = self._wake_queues.get(signal.edge_id)
        if queue is None:
            logger.warning("[CapacityWake] 边缘节点 %s 未注册", signal.edge_id)
            return False
        try:
            queue.put_nowait(signal)
            logger.info(
                "[CapacityWake] 唤醒信号已发送：edge=%s task=%s priority=%d",
                signal.edge_id, signal.task_id, signal.priority,
            )
            return True
        except asyncio.QueueFull:
            logger.warning("[CapacityWake] 边缘节点 %s 队列已满", signal.edge_id)
            return False

    async def wake_any(
        self,
        tenant_id: str,
        task_id: str,
        *,
        required_capability: str | None = None,
        priority: int = 0,
        payload: dict[str, Any] | None = None,
    ) -> str | None:
        """
        唤醒最合适的在线边缘节点（自动选择）。
        返回被唤醒的 edge_id，None = 没有可用节点。
        """
        now = time.time()
        online_timeout = 60.0  # 60s 没心跳视为离线

        candidates: list[str] = []
        for edge_id, metadata in self._edge_metadata.items():
            if metadata.get("tenant_id") != tenant_id:
                continue
            if now - self._last_heartbeat.get(edge_id, 0) > online_timeout:
                continue
            if required_capability and required_capability not in metadata.get("capabilities", []):
                continue
            candidates.append(edge_id)

        if not candidates:
            return None

        # 选负载最低的（队列最短）
        best = min(candidates, key=lambda eid: self._wake_queues[eid].qsize())
        signal = CapacityWakeSignal(
            edge_id=best,
            tenant_id=tenant_id,
            task_id=task_id,
            priority=priority,
            payload=payload or {},
        )
        await self.wake(signal)
        return best

    def list_online_edges(self, tenant_id: str | None = None) -> list[dict[str, Any]]:
        """列出在线的边缘节点"""
        now = time.time()
        result = []
        for edge_id, metadata in self._edge_metadata.items():
            if tenant_id and metadata.get("tenant_id") != tenant_id:
                continue
            last_hb = self._last_heartbeat.get(edge_id, 0)
            result.append({
                "edge_id": edge_id,
                "tenant_id": metadata.get("tenant_id"),
                "capabilities": metadata.get("capabilities", []),
                "online": now - last_hb < 60.0,
                "last_heartbeat_sec": round(now - last_hb, 1),
                "queue_size": self._wake_queues[edge_id].qsize() if edge_id in self._wake_queues else 0,
            })
        return result


# ────────────────────────────────────────────────────────────────────
# BridgeSession — 会话对象
# ────────────────────────────────────────────────────────────────────

@dataclass
class BridgeAuthToken:
    """桥接会话认证 Token（支持自动续期）"""
    token: str
    expires_at: float
    refresh_token: str = ""
    tenant_id: str = ""
    user_id: str = ""

    def is_expired(self, buffer_sec: float = 30.0) -> bool:
        """检查是否即将过期（buffer_sec 秒缓冲）"""
        return time.time() >= self.expires_at - buffer_sec


@dataclass
class BridgeSession:
    """
    桥接会话对象（仿 cccback bridge/types.ts BridgeSession）

    一个 BridgeSession 对应一个边缘节点连接或一个前端页面连接。
    """
    session_id: str = field(default_factory=lambda: f"bridge-{uuid.uuid4().hex[:12]}")
    session_type: SessionType = "execution"
    work_mode: WorkMode = "supervised"
    status: SessionStatus = "connecting"
    tenant_id: str = ""
    user_id: str = ""
    edge_id: str = ""

    # 连接管理
    connected_at: float = field(default_factory=time.time)
    last_active_at: float = field(default_factory=time.time)
    reconnect_count: int = 0
    auth_token: BridgeAuthToken | None = None

    # 权限
    viewer_only: bool = False
    approved_actions: list[str] = field(default_factory=list)

    # 活动流
    activity_stream: list[ActivityEvent] = field(default_factory=list)
    activity_queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=500))

    # 权限回调（审批流程）
    on_approval_requested: Callable | None = None

    def is_viewer_only(self) -> bool:
        return self.viewer_only or self.work_mode == "viewer_only"

    def can_execute(self) -> bool:
        return not self.is_viewer_only() and self.status == "active"

    def requires_approval(self, action: str) -> bool:
        """检查指定动作是否需要审批"""
        if self.work_mode == "autonomous":
            return False
        if action in self.approved_actions:
            return False
        return self.work_mode in ("supervised", "assistive")

    def grant_approval(self, action: str) -> None:
        """授予指定动作的审批"""
        if action not in self.approved_actions:
            self.approved_actions.append(action)

    async def emit(self, event: ActivityEvent) -> None:
        """发射活动事件到流"""
        self.activity_stream.append(event)
        if len(self.activity_stream) > 200:
            self.activity_stream = self.activity_stream[-100:]
        try:
            self.activity_queue.put_nowait(event)
        except asyncio.QueueFull:
            pass
        self.last_active_at = time.time()

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "session_type": self.session_type,
            "work_mode": self.work_mode,
            "status": self.status,
            "tenant_id": self.tenant_id,
            "user_id": self.user_id,
            "edge_id": self.edge_id,
            "connected_at": self.connected_at,
            "last_active_at": self.last_active_at,
            "reconnect_count": self.reconnect_count,
            "viewer_only": self.viewer_only,
            "can_execute": self.can_execute(),
            "approved_actions": self.approved_actions,
            "activity_count": len(self.activity_stream),
        }


# ────────────────────────────────────────────────────────────────────
# ReconnectStrategy — 重连策略
# 灵感来源：cccback remote/SessionsWebSocket.ts reconnect logic
# ────────────────────────────────────────────────────────────────────

@dataclass
class ReconnectStrategy:
    """
    指数退避 + jitter 重连策略（仿 cccback reconnect logic）

    max_attempts: 最大重连次数（None = 无限）
    base_delay:   初始等待时间（秒）
    max_delay:    最大等待时间（秒）
    jitter:       随机抖动因子（0~1，避免群体重连）
    """
    max_attempts: int | None = 10
    base_delay: float = 1.0
    max_delay: float = 60.0
    jitter: float = 0.3

    def get_delay(self, attempt: int) -> float:
        """计算第 N 次重连的等待时间"""
        delay = min(self.base_delay * (2 ** attempt), self.max_delay)
        jitter_amount = delay * self.jitter * random.random()
        return delay + jitter_amount

    def should_retry(self, attempt: int) -> bool:
        """是否应该继续重连"""
        if self.max_attempts is None:
            return True
        return attempt < self.max_attempts


# ────────────────────────────────────────────────────────────────────
# BridgeProtocolManager — 桥接协议管理器
# ────────────────────────────────────────────────────────────────────

class BridgeProtocolManager:
    """
    云边桥接协议管理器（仿 cccback remoteBridgeCore.ts）

    职责：
    1. 会话生命周期管理（创建/激活/断开/重连）
    2. Token 自动续期
    3. 权限回调路由（审批流）
    4. 活动流订阅
    5. CapacityWake 集成
    """

    def __init__(self) -> None:
        self._sessions: dict[str, BridgeSession] = {}
        self._capacity_wake = CapacityWakeManager()
        self._node_secrets: dict[str, str] = {}
        self._recent_edge_messages: list[dict[str, Any]] = []
        self._pipeline = EdgeMessagePipeline(
            hmac_secrets=self._node_secrets,
            tenant_resolver=self._resolve_tenant_for_node,
            require_signature=False,
        )
        self._outbox = EdgeOutbox()
        self.register_message_handler("node_ping", self._handle_node_ping)
        self.register_message_handler("publish_result", self._handle_publish_result)
        self.register_message_handler("monitor_data", self._handle_monitor_data)

    @property
    def capacity_wake(self) -> CapacityWakeManager:
        return self._capacity_wake

    @property
    def outbox(self) -> EdgeOutbox:
        return self._outbox

    def set_outbox(self, outbox: EdgeOutbox) -> None:
        self._outbox = outbox

    def register_node_secret(self, edge_id: str, secret: str) -> None:
        normalized_edge = str(edge_id or "").strip()
        normalized_secret = str(secret or "").strip()
        if not normalized_edge or not normalized_secret:
            return
        self._node_secrets[normalized_edge] = normalized_secret
        self._pipeline.policy.hmac_secrets[normalized_edge] = normalized_secret

    def register_message_handler(
        self,
        msg_type: str,
        handler: Callable[[EdgeMessage], Awaitable[Any]],
    ) -> None:
        self._pipeline.register(msg_type, handler)

    async def process_edge_message(
        self,
        raw_msg: dict[str, Any],
        *,
        envelope_type: str | None = None,
    ) -> PipelineDecision:
        payload = dict(raw_msg or {})
        msg_type = str(payload.get("msg_type") or payload.get("type") or payload.get("event") or envelope_type or "").strip()
        node_id = str(payload.get("node_id") or payload.get("nodeId") or payload.get("edge_id") or payload.get("edgeId") or "").strip()
        if msg_type and "msg_type" not in payload and "type" not in payload and "event" not in payload:
            payload["msg_type"] = msg_type
        if node_id and not any(payload.get(key) for key in ("node_id", "nodeId", "edge_id", "edgeId")):
            payload["node_id"] = node_id
        if "msg_id" not in payload and "msgId" not in payload and "message_id" not in payload and "id" not in payload:
            payload["msg_id"] = f"{msg_type or 'edge'}_{uuid.uuid4().hex[:12]}"
        if "tenant_id" not in payload and "tenantId" not in payload and node_id:
            tenant_id = self._resolve_tenant_for_node(node_id)
            if tenant_id:
                payload["tenant_id"] = tenant_id
        decision = await self._pipeline.process(payload, envelope_type=envelope_type)
        if decision.message is not None:
            self._record_recent_message(decision.message, decision)
        return decision

    async def enqueue_to_edge(
        self,
        *,
        tenant_id: str,
        node_id: str,
        msg_type: str,
        payload: dict[str, Any],
        delivery_mode: str = "poll",
        webhook_url: str = "",
        max_retries: int = 3,
    ) -> str:
        return await self._outbox.enqueue(
            tenant_id=tenant_id,
            node_id=node_id,
            msg_type=msg_type,
            payload=payload,
            delivery_mode=delivery_mode,
            webhook_url=webhook_url,
            max_retries=max_retries,
        )

    async def ack_outbox(self, outbox_id: str) -> bool:
        return await self._outbox.ack(outbox_id)

    def outbox_stats(self) -> dict[str, Any]:
        return self._outbox.stats()

    def recent_edge_messages(self, limit: int = 50) -> list[dict[str, Any]]:
        return self._recent_edge_messages[-max(1, int(limit)) :]

    # ── 会话生命周期 ─────────────────────────────────────────────────

    def create_session(
        self,
        *,
        session_type: SessionType = "execution",
        work_mode: WorkMode = "supervised",
        tenant_id: str,
        user_id: str,
        edge_id: str = "",
        viewer_only: bool = False,
    ) -> BridgeSession:
        """创建新的桥接会话"""
        session = BridgeSession(
            session_type=session_type,
            work_mode=work_mode,
            status="connecting",
            tenant_id=tenant_id,
            user_id=user_id,
            edge_id=edge_id,
            viewer_only=viewer_only,
        )
        self._sessions[session.session_id] = session
        logger.info(
            "[Bridge] 会话创建：%s type=%s mode=%s edge=%s",
            session.session_id, session_type, work_mode, edge_id,
        )
        return session

    async def activate_session(
        self,
        session_id: str,
        *,
        auth_token: BridgeAuthToken | None = None,
    ) -> BridgeSession | None:
        """激活会话（认证通过后调用）"""
        session = self._sessions.get(session_id)
        if not session:
            return None
        session.status = "active"
        session.auth_token = auth_token
        session.last_active_at = time.time()
        await session.emit(ActivityEvent(
            activity_type="session_start",
            session_id=session_id,
            message=f"会话已激活（mode={session.work_mode}）",
        ))
        return session

    async def disconnect_session(
        self,
        session_id: str,
        reason: str = "normal",
    ) -> None:
        """断开会话"""
        session = self._sessions.get(session_id)
        if not session:
            return
        session.status = "disconnected"
        await session.emit(ActivityEvent(
            activity_type="session_end",
            session_id=session_id,
            message=f"会话断开：{reason}",
        ))
        logger.info("[Bridge] 会话断开：%s reason=%s", session_id, reason)

    def get_session(self, session_id: str) -> BridgeSession | None:
        return self._sessions.get(session_id)

    def list_sessions(
        self,
        tenant_id: str | None = None,
        status: str | None = None,
    ) -> list[BridgeSession]:
        sessions = list(self._sessions.values())
        if tenant_id:
            sessions = [s for s in sessions if s.tenant_id == tenant_id]
        if status:
            sessions = [s for s in sessions if s.status == status]
        return sessions

    # ── Token 自动续期 ───────────────────────────────────────────────

    async def maybe_refresh_token(
        self,
        session_id: str,
        token_refresher: Callable[[str], Awaitable[BridgeAuthToken]],
    ) -> bool:
        """
        检查并自动续期 Token（仿 cccback auth token refresh）

        Args:
            session_id:     会话 ID
            token_refresher: 异步函数，输入 refresh_token，返回新 BridgeAuthToken

        Returns:
            True = 续期成功，False = 无需续期或失败
        """
        session = self._sessions.get(session_id)
        if not session or not session.auth_token:
            return False
        if not session.auth_token.is_expired():
            return False

        try:
            new_token = await token_refresher(session.auth_token.refresh_token)
            session.auth_token = new_token
            logger.info("[Bridge] Token 续期成功：%s", session_id)
            return True
        except Exception as e:
            logger.error("[Bridge] Token 续期失败：%s error=%s", session_id, e)
            session.status = "error"
            return False

    # ── 审批流回调 ───────────────────────────────────────────────────

    async def request_approval(
        self,
        session_id: str,
        action: str,
        description: str,
        metadata: dict[str, Any] | None = None,
    ) -> bool:
        """
        请求人工审批（仿 cccback bridgePermissionCallbacks.ts）

        调用 on_approval_requested 回调，等待前端响应。
        Returns: True = 审批通过，False = 拒绝/超时
        """
        session = self._sessions.get(session_id)
        if not session:
            return False

        # viewer-only 会话不能执行
        if session.is_viewer_only():
            return False

        # 已审批则跳过
        if not session.requires_approval(action):
            return True

        # 推送审批请求到活动流
        await session.emit(ActivityEvent(
            activity_type="approval_requested",
            session_id=session_id,
            message=f"需要审批：{description}",
            data={"action": action, "metadata": metadata or {}},
        ))

        # 调用外部回调（由前端 WebSocket 处理）
        if session.on_approval_requested:
            try:
                approved = await asyncio.wait_for(
                    session.on_approval_requested(action, description, metadata),
                    timeout=300.0,  # 5分钟超时
                )
            except asyncio.TimeoutError:
                logger.warning("[Bridge] 审批超时：%s action=%s", session_id, action)
                approved = False
        else:
            # 没有回调则默认拒绝（安全优先）
            approved = False

        if approved:
            session.grant_approval(action)
            await session.emit(ActivityEvent(
                activity_type="approval_granted",
                session_id=session_id,
                message=f"审批通过：{action}",
            ))
        else:
            await session.emit(ActivityEvent(
                activity_type="approval_rejected",
                session_id=session_id,
                message=f"审批拒绝：{action}",
            ))

        return approved

    # ── 活动流 API ────────────────────────────────────────────────────

    async def subscribe_activity_stream(
        self,
        session_id: str,
        request_disconnected_fn: Callable[[], Awaitable[bool]] | None = None,
    ):
        """
        异步生成器：订阅会话活动流（供 SSE 端点使用）

        async for event in bridge.subscribe_activity_stream(session_id):
            yield event.to_sse()
        """
        session = self._sessions.get(session_id)
        if not session:
            return

        while True:
            if request_disconnected_fn and await request_disconnected_fn():
                break
            if session.status == "disconnected":
                break
            try:
                event: ActivityEvent = await asyncio.wait_for(
                    session.activity_queue.get(), timeout=5.0
                )
                yield event
            except asyncio.TimeoutError:
                # 发送心跳
                yield ActivityEvent(
                    activity_type="session_start",
                    session_id=session_id,
                    message="ping",
                )

    def _resolve_tenant_for_node(self, edge_id: str) -> str | None:
        row = self._capacity_wake._edge_metadata.get(str(edge_id or "").strip(), {})
        tenant_id = str(row.get("tenant_id") or "").strip()
        return tenant_id or None

    def _record_recent_message(self, msg: EdgeMessage, decision: PipelineDecision) -> None:
        self._recent_edge_messages.append(
            {
                "msg_id": msg.msg_id,
                "msg_type": msg.msg_type,
                "tenant_id": msg.tenant_id,
                "node_id": msg.node_id,
                "status": decision.status,
                "accepted": decision.accepted,
                "timestamp": msg.timestamp,
            }
        )
        if len(self._recent_edge_messages) > 200:
            self._recent_edge_messages = self._recent_edge_messages[-100:]

    async def _handle_node_ping(self, msg: EdgeMessage) -> dict[str, Any]:
        capabilities = msg.payload.get("capabilities") or msg.payload.get("skills") or []
        if msg.node_id not in self._capacity_wake._edge_metadata:
            self._capacity_wake.register_edge(
                msg.node_id,
                tenant_id=msg.tenant_id,
                capabilities=[str(item) for item in capabilities if str(item).strip()],
            )
        else:
            self._capacity_wake.heartbeat(msg.node_id)
        metadata = self._capacity_wake._edge_metadata.setdefault(msg.node_id, {})
        metadata["last_payload"] = dict(msg.payload)
        metadata["last_protocol_version"] = msg.protocol_version
        return {"ok": True, "node_id": msg.node_id, "tenant_id": msg.tenant_id}

    async def _handle_publish_result(self, msg: EdgeMessage) -> dict[str, Any]:
        return {
            "ok": True,
            "received": "publish_result",
            "node_id": msg.node_id,
            "task_id": msg.payload.get("task_id") or msg.payload.get("taskId"),
        }

    async def _handle_monitor_data(self, msg: EdgeMessage) -> dict[str, Any]:
        return {
            "ok": True,
            "received": "monitor_data",
            "node_id": msg.node_id,
            "keys": sorted(msg.payload.keys()),
        }


# ── 全局单例 ─────────────────────────────────────────────────────────

_global_bridge: BridgeProtocolManager | None = None


def get_bridge_manager() -> BridgeProtocolManager:
    """获取全局桥接协议管理器"""
    global _global_bridge
    if _global_bridge is None:
        _global_bridge = BridgeProtocolManager()
    return _global_bridge
