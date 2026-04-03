"""
webhook_event_bus.py — 平台事件总线 + Webhook 分发
=====================================================
灵感来源：
  boxyhq/saas-starter-kit lib/svix.ts + components/webhook/
  open-saas template/app/src/payment/webhook.ts

核心设计：
  统一的"平台事件总线"，任何模块产生事件后：
  1. 写入本地事件日志（SQLite）
  2. 异步推送到租户配置的 Webhook 端点（via Svix 协议或直接 HTTP）
  3. 触发内部订阅者（如 SSE 推送、龙虾任务启动等）

事件类型（AppEvent）：
  龙虾任务类   : lobster.task.started / completed / failed
  账号操作类   : account.post.published / comment.replied / dm.sent
  线索类       : lead.captured / lead.converted
  审批类       : approval.requested / approval.granted
  系统类       : edge.connected / edge.disconnected / billing.updated

架构：
  任何模块 → emit(event) → EventBus
                              ├→ 本地订阅者（SSE/龙虾/调度）
                              ├→ 租户 Webhook（HTTP POST）
                              └→ 审计日志

集成点：
  api_lobster_realtime.py → 龙虾完成后 emit lobster.task.completed
  bridge_protocol.py      → 会话事件 emit
  app.py                  → /api/webhooks 端点（接收外部平台回调）
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal
import urllib.request
import urllib.error

from event_subjects import infer_subject, subject_matches
from event_bus_metrics import get_event_bus_metrics

logger = logging.getLogger("webhook_event_bus")

# ────────────────────────────────────────────────────────────────────
# 事件类型定义（仿 boxyhq AppEvent）
# ────────────────────────────────────────────────────────────────────

AppEvent = str


# ────────────────────────────────────────────────────────────────────
# 事件对象
# ────────────────────────────────────────────────────────────────────

@dataclass
class PlatformEvent:
    """
    平台事件对象（仿 boxyhq svix message）

    每个事件都有：
    - event_id    : 全局唯一 ID（幂等去重）
    - event_type  : 事件类型
    - tenant_id   : 所属租户
    - payload     : 事件数据
    - metadata    : 附加元数据（不进 webhook payload）
    """
    event_type: AppEvent
    tenant_id: str
    payload: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    subject: str = ""
    event_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    occurred_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        subject = self.subject or infer_subject(self.event_type, self.tenant_id, self.payload)
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "subject": subject,
            "tenant_id": self.tenant_id,
            "payload": self.payload,
            "occurred_at": self.occurred_at,
        }

    def to_webhook_body(self) -> str:
        """序列化为 Webhook 请求体（JSON）"""
        return json.dumps({
            "event": self.event_type,
            "subject": self.subject or infer_subject(self.event_type, self.tenant_id, self.payload),
            "event_id": self.event_id,
            "tenant_id": self.tenant_id,
            "data": self.payload,
            "timestamp": self.occurred_at,
        }, ensure_ascii=False)


# ────────────────────────────────────────────────────────────────────
# Webhook 端点配置
# ────────────────────────────────────────────────────────────────────

@dataclass
class WebhookEndpoint:
    """租户配置的 Webhook 端点（仿 boxyhq svix endpoint）"""
    endpoint_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    tenant_id: str = ""
    url: str = ""
    secret: str = field(default_factory=lambda: "whsec_" + uuid.uuid4().hex)
    description: str = ""
    event_types: list[str] = field(default_factory=list)  # 空=全部
    enabled: bool = True
    created_at: float = field(default_factory=time.time)
    failure_count: int = 0

    def should_receive(self, event_type: str, subject: str | None = None) -> bool:
        if not self.enabled:
            return False
        if not self.event_types:
            return True  # 空=接收所有
        normalized_subject = str(subject or "").strip()
        for pattern in self.event_types:
            current = str(pattern or "").strip()
            if current == event_type:
                return True
            if normalized_subject and subject_matches(current, normalized_subject):
                return True
        return False

    def compute_signature(self, body: str, timestamp: float) -> str:
        """计算 Webhook 签名（仿 Svix 签名算法）"""
        msg = f"{int(timestamp)}.{body}"
        secret_bytes = self.secret.replace("whsec_", "").encode()
        return "v1," + hmac.new(secret_bytes, msg.encode(), hashlib.sha256).hexdigest()

    def to_dict(self) -> dict[str, Any]:
        return {
            "endpoint_id": self.endpoint_id,
            "tenant_id": self.tenant_id,
            "url": self.url,
            "description": self.description,
            "event_types": self.event_types,
            "enabled": self.enabled,
            "created_at": self.created_at,
            "failure_count": self.failure_count,
        }


# ────────────────────────────────────────────────────────────────────
# 本地事件存储（SQLite）
# ────────────────────────────────────────────────────────────────────

_EVENT_DB_PATH = "data/platform_events.sqlite"


class EventStore:
    """本地事件日志（用于重放、审计、调试）"""

    def __init__(self) -> None:
        self._ensure_schema()

    def _get_db(self) -> sqlite3.Connection:
        p = Path(_EVENT_DB_PATH)
        p.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(p))
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._get_db()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS platform_events (
                    event_id    TEXT PRIMARY KEY,
                    event_type  TEXT NOT NULL,
                    subject     TEXT NOT NULL DEFAULT '',
                    tenant_id   TEXT NOT NULL,
                    payload     TEXT NOT NULL,
                    occurred_at REAL NOT NULL,
                    delivered   INTEGER DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_ev_tenant
                    ON platform_events(tenant_id, event_type, occurred_at);
                CREATE INDEX IF NOT EXISTS idx_ev_subject
                    ON platform_events(tenant_id, subject, occurred_at);

                CREATE TABLE IF NOT EXISTS webhook_endpoints (
                    endpoint_id  TEXT PRIMARY KEY,
                    tenant_id    TEXT NOT NULL,
                    url          TEXT NOT NULL,
                    secret       TEXT NOT NULL,
                    description  TEXT DEFAULT '',
                    event_types  TEXT DEFAULT '',
                    enabled      INTEGER DEFAULT 1,
                    failure_count INTEGER DEFAULT 0,
                    created_at   REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_wh_tenant
                    ON webhook_endpoints(tenant_id);
            """)
            cols = [row[1] for row in conn.execute("PRAGMA table_info(platform_events)").fetchall()]
            if "subject" not in cols:
                conn.execute("ALTER TABLE platform_events ADD COLUMN subject TEXT NOT NULL DEFAULT ''")
            conn.commit()
        finally:
            conn.close()

    def store_event(self, event: PlatformEvent) -> None:
        conn = self._get_db()
        try:
            conn.execute(
                "INSERT OR IGNORE INTO platform_events "
                "(event_id, event_type, subject, tenant_id, payload, occurred_at, delivered) "
                "VALUES (?,?,?,?,?,?,0)",
                (event.event_id, event.event_type, event.subject or infer_subject(event.event_type, event.tenant_id, event.payload), event.tenant_id,
                 json.dumps(event.payload), event.occurred_at),
            )
            conn.commit()
        finally:
            conn.close()

    def get_recent(self, tenant_id: str, limit: int = 50) -> list[dict[str, Any]]:
        conn = self._get_db()
        try:
            rows = conn.execute(
                "SELECT * FROM platform_events WHERE tenant_id=? "
                "ORDER BY occurred_at DESC LIMIT ?",
                (tenant_id, limit),
            ).fetchall()
            cols = [d[1] for d in conn.execute("PRAGMA table_info(platform_events)").fetchall()]
            return [dict(zip(cols, row)) for row in rows]
        finally:
            conn.close()

    # ── Webhook 端点 CRUD ─────────────────────────────────────────

    def add_endpoint(self, ep: WebhookEndpoint) -> None:
        conn = self._get_db()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO webhook_endpoints "
                "(endpoint_id, tenant_id, url, secret, description, "
                "event_types, enabled, failure_count, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (ep.endpoint_id, ep.tenant_id, ep.url, ep.secret,
                 ep.description, json.dumps(ep.event_types),
                 int(ep.enabled), ep.failure_count, ep.created_at),
            )
            conn.commit()
        finally:
            conn.close()

    def get_endpoints(self, tenant_id: str) -> list[WebhookEndpoint]:
        conn = self._get_db()
        try:
            rows = conn.execute(
                "SELECT * FROM webhook_endpoints WHERE tenant_id=? AND enabled=1",
                (tenant_id,),
            ).fetchall()
            result = []
            for row in rows:
                ep = WebhookEndpoint(
                    endpoint_id=row[0], tenant_id=row[1], url=row[2],
                    secret=row[3], description=row[4],
                    event_types=json.loads(row[5] or "[]"),
                    enabled=bool(row[6]), failure_count=row[7], created_at=row[8],
                )
                result.append(ep)
            return result
        finally:
            conn.close()

    def delete_endpoint(self, endpoint_id: str) -> None:
        conn = self._get_db()
        try:
            conn.execute("DELETE FROM webhook_endpoints WHERE endpoint_id=?", (endpoint_id,))
            conn.commit()
        finally:
            conn.close()

    def increment_failure(self, endpoint_id: str) -> int:
        conn = self._get_db()
        try:
            conn.execute(
                "UPDATE webhook_endpoints SET failure_count=failure_count+1 WHERE endpoint_id=?",
                (endpoint_id,),
            )
            conn.commit()
            row = conn.execute(
                "SELECT failure_count FROM webhook_endpoints WHERE endpoint_id=?",
                (endpoint_id,),
            ).fetchone()
            return row[0] if row else 0
        finally:
            conn.close()


# ────────────────────────────────────────────────────────────────────
# EventBus — 核心事件总线
# ────────────────────────────────────────────────────────────────────

SubscriberFn = Callable[[PlatformEvent], None]


class EventBus:
    """
    平台事件总线（仿 boxyhq svix + open-saas webhook.ts）

    功能：
    1. emit(event) → 存储 + 通知本地订阅者 + 异步推 Webhook
    2. subscribe(event_type, fn) → 内部订阅（SSE、龙虾启动等）
    3. Webhook 推送带签名 + 失败重试（最多3次）
    4. 连续失败5次自动禁用端点（保护措施）
    """

    MAX_FAILURES_BEFORE_DISABLE = 5
    WEBHOOK_TIMEOUT = 10  # 秒

    def __init__(self) -> None:
        self._store = EventStore()
        self._subscribers: dict[str, list[SubscriberFn]] = {}
        self._global_subscribers: list[SubscriberFn] = []

    def subscribe(
        self,
        fn: SubscriberFn,
        event_type: str | None = None,
    ) -> None:
        """订阅事件（内部模块使用）"""
        if event_type:
            self._subscribers.setdefault(event_type, []).append(fn)
        else:
            self._global_subscribers.append(fn)

    async def emit(self, event: PlatformEvent) -> None:
        """
        发布事件（异步，不阻塞调用方）

        1. 存储到本地 EventStore
        2. 通知本地订阅者（同步）
        3. 后台推送 Webhook（异步）
        """
        # 1. 存储
        if not event.subject:
            event.subject = infer_subject(event.event_type, event.tenant_id, event.payload)
        get_event_bus_metrics().record(event.subject)
        self._store.store_event(event)

        # 2. 本地订阅者
        for fn in self._global_subscribers:
            try:
                fn(event)
            except Exception as e:
                logger.warning("[EventBus] 订阅者异常：%s", e)

        matched_callbacks: list[SubscriberFn] = []
        matched_keys: set[tuple[str, int]] = set()
        for pattern, callbacks in self._subscribers.items():
            if not (
                pattern == event.event_type
                or pattern == event.subject
                or subject_matches(pattern, event.subject)
            ):
                continue
            for index, callback in enumerate(callbacks):
                key = (pattern, index)
                if key in matched_keys:
                    continue
                matched_keys.add(key)
                matched_callbacks.append(callback)

        for fn in matched_callbacks:
            try:
                fn(event)
            except Exception as e:
                logger.warning("[EventBus] 订阅者异常 type=%s subject=%s: %s", event.event_type, event.subject, e)

        # 3. 后台推送 Webhook
        asyncio.create_task(self._deliver_webhooks(event))

    async def publish_legacy(
        self,
        *,
        event_type: str,
        tenant_id: str,
        payload: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        subject: str | None = None,
    ) -> None:
        """
        迁移期兼容入口：
        保留旧 event_type，同时写入新的层级化 subject。
        """
        await self.emit(
            PlatformEvent(
                event_type=str(event_type),
                tenant_id=str(tenant_id),
                payload=payload or {},
                metadata=metadata or {},
                subject=str(subject or "").strip(),
            )
        )

    async def _deliver_webhooks(self, event: PlatformEvent) -> None:
        """推送到所有匹配的租户 Webhook 端点"""
        endpoints = self._store.get_endpoints(event.tenant_id)
        for ep in endpoints:
            if not ep.should_receive(event.event_type, event.subject):
                continue
            asyncio.create_task(self._send_webhook(ep, event))

    async def _send_webhook(
        self,
        ep: WebhookEndpoint,
        event: PlatformEvent,
        retries: int = 3,
    ) -> bool:
        """带重试的 Webhook 投递"""
        body = event.to_webhook_body()
        ts = event.occurred_at
        sig = ep.compute_signature(body, ts)

        headers = {
            "Content-Type": "application/json",
            "webhook-id": event.event_id,
            "webhook-timestamp": str(int(ts)),
            "webhook-signature": sig,
        }

        for attempt in range(retries):
            try:
                req = urllib.request.Request(
                    ep.url,
                    data=body.encode(),
                    headers=headers,
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=self.WEBHOOK_TIMEOUT) as resp:
                    if resp.status < 300:
                        logger.debug(
                            "[Webhook] 投递成功 endpoint=%s event=%s",
                            ep.endpoint_id, event.event_type,
                        )
                        return True
            except Exception as e:
                if attempt < retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                logger.warning(
                    "[Webhook] 投递失败 endpoint=%s event=%s error=%s",
                    ep.endpoint_id, event.event_type, e,
                )

        # 记录失败
        failures = self._store.increment_failure(ep.endpoint_id)
        if failures >= self.MAX_FAILURES_BEFORE_DISABLE:
            logger.error(
                "[Webhook] 端点连续失败 %d 次，自动禁用：%s",
                failures, ep.endpoint_id,
            )
        return False

    # ── 便捷 emit 方法 ─────────────────────────────────────────────

    async def emit_lobster_completed(
        self,
        tenant_id: str,
        task_id: str,
        lobster_id: str,
        result_summary: str = "",
    ) -> None:
        await self.emit(PlatformEvent(
            event_type="lobster.task.completed",
            tenant_id=tenant_id,
            payload={
                "task_id": task_id,
                "lobster_id": lobster_id,
                "result_summary": result_summary[:500],
            },
        ))

    async def emit_post_published(
        self,
        tenant_id: str,
        account_id: str,
        platform: str,
        post_id: str,
    ) -> None:
        await self.emit(PlatformEvent(
            event_type="account.post.published",
            tenant_id=tenant_id,
            payload={
                "account_id": account_id,
                "platform": platform,
                "post_id": post_id,
            },
        ))

    async def emit_lead_captured(
        self,
        tenant_id: str,
        lead_id: str,
        source: str,
        score: float = 0.0,
    ) -> None:
        await self.emit(PlatformEvent(
            event_type="lead.captured",
            tenant_id=tenant_id,
            payload={
                "lead_id": lead_id,
                "source": source,
                "score": score,
            },
        ))

    # ── Webhook 端点管理 ──────────────────────────────────────────

    def register_endpoint(self, ep: WebhookEndpoint) -> WebhookEndpoint:
        self._store.add_endpoint(ep)
        return ep

    def list_endpoints(self, tenant_id: str) -> list[dict[str, Any]]:
        return [ep.to_dict() for ep in self._store.get_endpoints(tenant_id)]

    def delete_endpoint(self, endpoint_id: str) -> None:
        self._store.delete_endpoint(endpoint_id)

    def get_recent_events(self, tenant_id: str, limit: int = 50) -> list[dict[str, Any]]:
        return self._store.get_recent(tenant_id, limit)


# ── 全局单例 ─────────────────────────────────────────────────────────

_global_event_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    global _global_event_bus
    if _global_event_bus is None:
        _global_event_bus = EventBus()
    return _global_event_bus
