"""
QuotaMiddleware — API 配额拦截中间件
======================================
灵感来源：Langfuse Plan-based Usage Limits
借鉴要点：
  - Langfuse Cloud 按 Plan 限制 Trace 数量（Free: 50k/月，Pro: 无限）
  - 超配额时 API 返回 429 Too Many Requests，而不是静默失败
  - 我们 dynamic_config.py 已有配额定义，但缺少 API 层的真正拦截
  - 此中间件在 FastAPI 请求链中拦截超配额租户，返回标准 429

配额维度：
  - workflow_runs_per_month：每月工作流执行次数
  - llm_tokens_per_month：每月 LLM token 用量
  - api_calls_per_minute：每分钟 API 调用数（Rate Limiting）
  - edge_nodes_max：最大在线边缘节点数

使用方式：
    from fastapi import FastAPI
    from quota_middleware import make_quota_middleware

    app = FastAPI()
    app.add_middleware(make_quota_middleware())
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


_DB_PATH = os.getenv("QUOTA_DB", "./data/quota_usage.sqlite")

# ─────────────────────────────────────────────────────────────────
# 计划配额定义（对应 Langfuse 的 plan limits）
# ─────────────────────────────────────────────────────────────────

PLAN_QUOTAS: dict[str, dict[str, Any]] = {
    "free": {
        "workflow_runs_per_month": 50,
        "llm_tokens_per_month": 100_000,
        "api_calls_per_minute": 30,
        "edge_nodes_max": 1,
        "prompt_versions_max": 10,
        "dataset_items_max": 100,
    },
    "starter": {
        "workflow_runs_per_month": 500,
        "llm_tokens_per_month": 1_000_000,
        "api_calls_per_minute": 120,
        "edge_nodes_max": 3,
        "prompt_versions_max": 100,
        "dataset_items_max": 1000,
    },
    "pro": {
        "workflow_runs_per_month": 5000,
        "llm_tokens_per_month": 10_000_000,
        "api_calls_per_minute": 600,
        "edge_nodes_max": 10,
        "prompt_versions_max": -1,  # 无限
        "dataset_items_max": -1,
    },
    "enterprise": {
        "workflow_runs_per_month": -1,
        "llm_tokens_per_month": -1,
        "api_calls_per_minute": -1,
        "edge_nodes_max": -1,
        "prompt_versions_max": -1,
        "dataset_items_max": -1,
    },
}

# API 路径 → 对应的配额维度映射
PATH_QUOTA_MAP: dict[str, str] = {
    "/api/workflow": "workflow_runs_per_month",
    "/api/lobster": "api_calls_per_minute",
    "/api/llm": "llm_tokens_per_month",
    "/api/edge": "api_calls_per_minute",
    "/api/prompt": "api_calls_per_minute",
    "/api/dataset": "api_calls_per_minute",
}


class QuotaStore:
    """配额用量存储（SQLite）"""

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()
        # 内存速率限制桶（per-minute 计数）
        self._rate_buckets: dict[str, list[float]] = {}

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                -- 租户配额配置（可被 dynamic_config 覆盖）
                CREATE TABLE IF NOT EXISTS tenant_plans (
                    tenant_id   TEXT PRIMARY KEY,
                    plan        TEXT DEFAULT 'free',
                    custom_quotas TEXT DEFAULT '{}',  -- JSON：覆盖 plan 默认值
                    updated_at  TEXT NOT NULL
                );

                -- 月度用量计数
                CREATE TABLE IF NOT EXISTS monthly_usage (
                    usage_id    TEXT PRIMARY KEY,
                    tenant_id   TEXT NOT NULL,
                    month       TEXT NOT NULL,  -- YYYY-MM
                    dimension   TEXT NOT NULL,  -- workflow_runs / llm_tokens / api_calls
                    value       INTEGER DEFAULT 0,
                    UNIQUE(tenant_id, month, dimension)
                );
                CREATE INDEX IF NOT EXISTS idx_mu_tenant ON monthly_usage(tenant_id, month);

                -- 配额超限事件（审计用）
                CREATE TABLE IF NOT EXISTS quota_violations (
                    violation_id TEXT PRIMARY KEY,
                    tenant_id    TEXT NOT NULL,
                    dimension    TEXT NOT NULL,
                    current_value INTEGER DEFAULT 0,
                    limit_value   INTEGER DEFAULT 0,
                    path         TEXT DEFAULT '',
                    created_at   TEXT NOT NULL
                );
            """)
            conn.commit()
        finally:
            conn.close()

    def get_tenant_plan(self, tenant_id: str) -> str:
        """获取租户计划"""
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT plan FROM tenant_plans WHERE tenant_id=?", (tenant_id,)
            ).fetchone()
            return row["plan"] if row else "free"
        finally:
            conn.close()

    def get_quota_limit(self, tenant_id: str, dimension: str) -> int:
        """获取租户某维度的配额上限（-1 表示无限）"""
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT plan, custom_quotas FROM tenant_plans WHERE tenant_id=?",
                (tenant_id,)
            ).fetchone()
        finally:
            conn.close()

        plan = row["plan"] if row else "free"
        custom = json.loads(row["custom_quotas"] if row else "{}") if row else {}

        # 先查自定义配额，再查 plan 默认
        if dimension in custom:
            return int(custom[dimension])
        plan_config = PLAN_QUOTAS.get(plan, PLAN_QUOTAS["free"])
        return plan_config.get(dimension, 0)

    def get_monthly_usage(self, tenant_id: str, dimension: str) -> int:
        """获取当月已用量"""
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT value FROM monthly_usage WHERE tenant_id=? AND month=? AND dimension=?",
                (tenant_id, month, dimension)
            ).fetchone()
            return row["value"] if row else 0
        finally:
            conn.close()

    def increment_usage(self, tenant_id: str, dimension: str, amount: int = 1) -> int:
        """增加用量计数，返回更新后的值"""
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO monthly_usage (usage_id, tenant_id, month, dimension, value)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(tenant_id, month, dimension)
                   DO UPDATE SET value=value+?""",
                (f"mu_{uuid.uuid4().hex[:8]}", tenant_id, month, dimension, amount, amount)
            )
            conn.commit()
            row = conn.execute(
                "SELECT value FROM monthly_usage WHERE tenant_id=? AND month=? AND dimension=?",
                (tenant_id, month, dimension)
            ).fetchone()
            return row["value"] if row else amount
        finally:
            conn.close()

    def check_rate_limit(self, tenant_id: str, dimension: str,
                         limit_per_minute: int) -> tuple[bool, int]:
        """
        检查速率限制（内存令牌桶，每分钟窗口）。
        返回 (is_exceeded, current_count)。
        """
        if limit_per_minute <= 0:
            return False, 0
        key = f"{tenant_id}:{dimension}"
        now = time.time()
        window_start = now - 60
        bucket = self._rate_buckets.get(key, [])
        # 清理窗口外的时间戳
        bucket = [t for t in bucket if t > window_start]
        current = len(bucket)
        if current >= limit_per_minute:
            self._rate_buckets[key] = bucket
            return True, current
        bucket.append(now)
        self._rate_buckets[key] = bucket
        return False, current + 1

    def record_violation(self, tenant_id: str, dimension: str,
                         current: int, limit: int, path: str) -> None:
        """记录配额超限事件"""
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO quota_violations
                   (violation_id, tenant_id, dimension, current_value, limit_value, path, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (f"qv_{uuid.uuid4().hex[:8]}", tenant_id, dimension,
                 current, limit, path, self._now())
            )
            conn.commit()
        finally:
            conn.close()

    def get_usage_summary(self, tenant_id: str) -> dict[str, Any]:
        """获取租户配额使用摘要（用于 Dashboard 显示）"""
        plan = self.get_tenant_plan(tenant_id)
        plan_config = PLAN_QUOTAS.get(plan, PLAN_QUOTAS["free"])
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT dimension, value FROM monthly_usage WHERE tenant_id=? AND month=?",
                (tenant_id, month)
            ).fetchall()
        finally:
            conn.close()

        usage_map = {r["dimension"]: r["value"] for r in rows}
        result = {"tenant_id": tenant_id, "plan": plan, "month": month, "dimensions": {}}
        for dim, limit in plan_config.items():
            used = usage_map.get(dim, 0)
            result["dimensions"][dim] = {
                "used": used,
                "limit": limit,
                "remaining": (limit - used) if limit > 0 else -1,
                "percent": round(used / limit * 100, 1) if limit > 0 else 0,
            }
        return result

    def set_tenant_plan(self, tenant_id: str, plan: str,
                        custom_quotas: dict | None = None) -> None:
        """设置租户计划"""
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO tenant_plans (tenant_id, plan, custom_quotas, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(tenant_id) DO UPDATE SET
                       plan=excluded.plan,
                       custom_quotas=excluded.custom_quotas,
                       updated_at=excluded.updated_at""",
                (tenant_id, plan, json.dumps(custom_quotas or {}),
                 datetime.now(timezone.utc).isoformat())
            )
            conn.commit()
        finally:
            conn.close()


# ─────────────────────────────────────────────────────────────────
# FastAPI 中间件工厂
# ─────────────────────────────────────────────────────────────────

def make_quota_middleware(quota_store: Optional[QuotaStore] = None):
    """
    生成配额拦截中间件（对应 Langfuse Plan-based Usage Limits）。

    用法：
        from fastapi import FastAPI
        from quota_middleware import make_quota_middleware
        app = FastAPI()
        app.add_middleware(make_quota_middleware())
    """
    if quota_store is None:
        quota_store = get_quota_store()

    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import JSONResponse

    # 不检查配额的路径
    SKIP_PATHS = {"/docs", "/redoc", "/openapi.json", "/health",
                  "/api/auth", "/api/quota"}

    class QuotaMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            path = request.url.path
            if any(path.startswith(p) for p in SKIP_PATHS):
                return await call_next(request)

            # 获取 tenant_id（由 ApiKeyMiddleware 注入，或从 header 获取）
            tenant_id = getattr(request.state, "tenant_id", None)
            if not tenant_id:
                tenant_id = request.headers.get("X-Tenant-Id", "")
            if not tenant_id:
                return await call_next(request)

            # 确定配额维度
            dimension = None
            for path_prefix, dim in PATH_QUOTA_MAP.items():
                if path.startswith(path_prefix):
                    dimension = dim
                    break

            if not dimension:
                return await call_next(request)

            # 速率限制检查（per-minute）
            if "per_minute" in dimension:
                rate_limit = quota_store.get_quota_limit(tenant_id, dimension)
                exceeded, current = quota_store.check_rate_limit(
                    tenant_id, dimension, rate_limit
                )
                if exceeded:
                    quota_store.record_violation(tenant_id, dimension, current, rate_limit, path)
                    return JSONResponse(
                        {
                            "error": "rate_limit_exceeded",
                            "message": f"超过速率限制：{rate_limit} 次/分钟",
                            "dimension": dimension,
                            "current": current,
                            "limit": rate_limit,
                            "retry_after_seconds": 60,
                        },
                        status_code=429,
                        headers={"Retry-After": "60", "X-RateLimit-Limit": str(rate_limit)},
                    )
            else:
                # 月度配额检查
                limit = quota_store.get_quota_limit(tenant_id, dimension)
                if limit > 0:  # -1 表示无限
                    current = quota_store.get_monthly_usage(tenant_id, dimension)
                    if current >= limit:
                        quota_store.record_violation(tenant_id, dimension, current, limit, path)
                        plan = quota_store.get_tenant_plan(tenant_id)
                        return JSONResponse(
                            {
                                "error": "quota_exceeded",
                                "message": f"已超过本月配额限制（{dimension}）",
                                "dimension": dimension,
                                "current": current,
                                "limit": limit,
                                "plan": plan,
                                "upgrade_url": "/api/billing/upgrade",
                            },
                            status_code=429,
                        )

            response = await call_next(request)

            # 成功后增加用量（非速率限制维度）
            if response.status_code < 400 and "per_minute" not in (dimension or ""):
                quota_store.increment_usage(tenant_id, dimension, 1)

            # 在响应头中返回配额信息
            if dimension:
                limit = quota_store.get_quota_limit(tenant_id, dimension)
                used = quota_store.get_monthly_usage(tenant_id, dimension)
                response.headers["X-Quota-Limit"] = str(limit)
                response.headers["X-Quota-Used"] = str(used)
                response.headers["X-Quota-Remaining"] = str(max(0, limit - used) if limit > 0 else -1)

            return response

    return QuotaMiddleware


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_store: Optional[QuotaStore] = None

def get_quota_store() -> QuotaStore:
    global _default_store
    if _default_store is None:
        _default_store = QuotaStore()
    return _default_store
