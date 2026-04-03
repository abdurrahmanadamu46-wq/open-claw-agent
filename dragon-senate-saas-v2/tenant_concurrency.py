from __future__ import annotations

import asyncio
import json
import sqlite3
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class QueueDepthExceededError(RuntimeError):
    pass


class WorkflowRateLimitedError(RuntimeError):
    pass


class ConcurrencyAcquireTimeoutError(RuntimeError):
    pass


@dataclass
class TenantConcurrencyConfig:
    tenant_id: str
    plan_tier: str
    max_concurrent_workflows: int
    max_concurrent_steps: int
    max_queue_depth: int
    workflow_per_minute: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


PLAN_CONCURRENCY_DEFAULTS: dict[str, TenantConcurrencyConfig] = {
    "free": TenantConcurrencyConfig("*", "free", 1, 3, 5, 5),
    "standard": TenantConcurrencyConfig("*", "standard", 3, 10, 20, 30),
    "premium": TenantConcurrencyConfig("*", "premium", 10, 30, 100, 100),
    "enterprise": TenantConcurrencyConfig("*", "enterprise", 50, 150, 500, 500),
}

PLAN_ALIASES = {
    "starter": "standard",
    "pro": "premium",
}


class TenantConcurrencyManager:
    def __init__(self, db_path: str = "./data/tenant_concurrency.sqlite") -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()
        self._rate_buckets: dict[str, list[float]] = {}
        self._last_alert_at: dict[str, float] = {}
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS tenant_concurrency_configs (
                    tenant_id TEXT PRIMARY KEY,
                    plan_tier TEXT NOT NULL DEFAULT 'free',
                    overrides_json TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS concurrency_counters (
                    tenant_id TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    current_count INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, resource)
                );
                """
            )
            conn.commit()

    def get_tenant_config(self, tenant_id: str) -> TenantConcurrencyConfig:
        normalized_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        row = None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT tenant_id, plan_tier, overrides_json FROM tenant_concurrency_configs WHERE tenant_id = ?",
                (normalized_tenant,),
            ).fetchone()

        if row is not None:
            plan_tier = str(row["plan_tier"] or "free").strip().lower() or "free"
            overrides = json.loads(str(row["overrides_json"] or "{}"))
        else:
            plan_tier = self._infer_plan_tier(normalized_tenant)
            overrides = {}

        base = PLAN_CONCURRENCY_DEFAULTS.get(plan_tier, PLAN_CONCURRENCY_DEFAULTS["free"])
        return TenantConcurrencyConfig(
            tenant_id=normalized_tenant,
            plan_tier=plan_tier,
            max_concurrent_workflows=int(overrides.get("max_concurrent_workflows", base.max_concurrent_workflows)),
            max_concurrent_steps=int(overrides.get("max_concurrent_steps", base.max_concurrent_steps)),
            max_queue_depth=int(overrides.get("max_queue_depth", base.max_queue_depth)),
            workflow_per_minute=int(overrides.get("workflow_per_minute", base.workflow_per_minute)),
        )

    def _infer_plan_tier(self, tenant_id: str) -> str:
        try:
            from quota_middleware import get_quota_store

            plan = str(get_quota_store().get_tenant_plan(tenant_id) or "free").strip().lower()
            return PLAN_ALIASES.get(plan, plan if plan in PLAN_CONCURRENCY_DEFAULTS else "free")
        except Exception:
            return "free"

    async def acquire(self, tenant_id: str, resource: str, max_limit: int) -> bool:
        if max_limit <= 0:
            return True
        normalized_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        normalized_resource = str(resource or "workflows").strip() or "workflows"
        async with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT current_count FROM concurrency_counters WHERE tenant_id = ? AND resource = ?",
                    (normalized_tenant, normalized_resource),
                ).fetchone()
                current = int(row["current_count"] or 0) if row else 0
                if current >= max_limit:
                    return False
                next_count = current + 1
                conn.execute(
                    """
                    INSERT INTO concurrency_counters(tenant_id, resource, current_count, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(tenant_id, resource)
                    DO UPDATE SET current_count = excluded.current_count, updated_at = excluded.updated_at
                    """,
                    (normalized_tenant, normalized_resource, next_count, _utc_now_iso()),
                )
                conn.commit()
        await self._maybe_emit_usage_alert(normalized_tenant, normalized_resource, next_count, max_limit)
        return True

    async def release(self, tenant_id: str, resource: str) -> None:
        normalized_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        normalized_resource = str(resource or "workflows").strip() or "workflows"
        async with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT current_count FROM concurrency_counters WHERE tenant_id = ? AND resource = ?",
                    (normalized_tenant, normalized_resource),
                ).fetchone()
                current = int(row["current_count"] or 0) if row else 0
                next_count = max(0, current - 1)
                conn.execute(
                    """
                    INSERT INTO concurrency_counters(tenant_id, resource, current_count, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(tenant_id, resource)
                    DO UPDATE SET current_count = excluded.current_count, updated_at = excluded.updated_at
                    """,
                    (normalized_tenant, normalized_resource, next_count, _utc_now_iso()),
                )
                conn.commit()

    async def get_current(self, tenant_id: str, resource: str) -> int:
        normalized_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        normalized_resource = str(resource or "workflows").strip() or "workflows"
        with self._connect() as conn:
            row = conn.execute(
                "SELECT current_count FROM concurrency_counters WHERE tenant_id = ? AND resource = ?",
                (normalized_tenant, normalized_resource),
            ).fetchone()
        return int(row["current_count"] or 0) if row else 0

    async def get_stats(self, tenant_id: str) -> dict[str, int]:
        return {
            "concurrent_workflows": await self.get_current(tenant_id, "workflows"),
            "concurrent_steps": await self.get_current(tenant_id, "steps"),
        }

    async def wait_for_slot(
        self,
        *,
        tenant_id: str,
        resource: str,
        max_limit: int,
        wait_timeout_seconds: int = 300,
        poll_interval_seconds: int = 2,
    ) -> None:
        deadline = time.time() + max(1, wait_timeout_seconds)
        while time.time() < deadline:
            if await self.acquire(tenant_id, resource, max_limit):
                return
            await asyncio.sleep(max(1, poll_interval_seconds))
        raise ConcurrencyAcquireTimeoutError(f"concurrency_timeout:{resource}:{tenant_id}:{max_limit}")

    async def enforce_workflow_rate_limit(self, tenant_id: str, limit_per_minute: int) -> None:
        if limit_per_minute <= 0:
            return
        bucket_key = f"{tenant_id}:workflow_per_minute"
        now = time.time()
        cutoff = now - 60
        bucket = [item for item in self._rate_buckets.get(bucket_key, []) if item > cutoff]
        if len(bucket) >= limit_per_minute:
            raise WorkflowRateLimitedError(f"workflow_rate_limited:{tenant_id}:{limit_per_minute}")
        bucket.append(now)
        self._rate_buckets[bucket_key] = bucket

    async def _maybe_emit_usage_alert(self, tenant_id: str, resource: str, current: int, limit: int) -> None:
        if limit <= 0:
            return
        usage_pct = (current / max(1, limit)) * 100
        if usage_pct < 90:
            return
        alert_key = f"{tenant_id}:{resource}:{int(usage_pct // 10)}"
        now = time.time()
        last = self._last_alert_at.get(alert_key, 0.0)
        if now - last < 600:
            return
        self._last_alert_at[alert_key] = now
        try:
            from alert_engine import AlertFiringEvent, get_alert_engine
            from event_subjects import EventSubjects
            from webhook_event_bus import PlatformEvent, get_event_bus

            get_alert_engine().store.add_event(
                AlertFiringEvent(
                    event_id=f"con_{uuid.uuid4().hex[:12]}",
                    rule_id=f"tenant_concurrency_{resource}",
                    rule_name=f"tenant_concurrency_{resource}",
                    state="firing",
                    severity="warning",
                    message=f"租户 {tenant_id} 的 {resource} 并发使用率达到 {usage_pct:.1f}%",
                    current_value=float(current),
                    threshold=float(limit),
                    fired_at=_utc_now_iso(),
                    tenant_id=tenant_id,
                    lobster_id=None,
                )
            )
            await get_event_bus().emit(
                PlatformEvent(
                    event_type="tenant.concurrency.limit_reached",
                    subject=EventSubjects.format(
                        EventSubjects.TENANT_CONCURRENCY_LIMIT,
                        tenant_id=tenant_id,
                    ),
                    tenant_id=tenant_id,
                    payload={
                        "resource": resource,
                        "current": current,
                        "limit": limit,
                        "usage_pct": round(usage_pct, 1),
                    },
                )
            )
        except Exception:
            pass

    async def list_overview(self, tenant_ids: list[str]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for tenant_id in tenant_ids:
            config = self.get_tenant_config(tenant_id)
            current = await self.get_stats(tenant_id)
            items.append(
                {
                    "tenant_id": tenant_id,
                    "plan_tier": config.plan_tier,
                    **current,
                    "max_concurrent_workflows": config.max_concurrent_workflows,
                    "max_concurrent_steps": config.max_concurrent_steps,
                    "max_queue_depth": config.max_queue_depth,
                    "workflow_per_minute": config.workflow_per_minute,
                }
            )
        return items


_manager: TenantConcurrencyManager | None = None


def get_tenant_concurrency_manager() -> TenantConcurrencyManager:
    global _manager
    if _manager is None:
        _manager = TenantConcurrencyManager()
    return _manager
