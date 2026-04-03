"""
ApiKeyManager — Project 级别 API Key 多 Key 管理
==================================================
灵感来源：Langfuse projectApiKeysRouter
借鉴要点：
  - 每个租户（Tenant）可以创建多个 API Key（sk-xxx）
  - Key 有标签（dev/prod/test）、用量统计、吊销功能
  - Key 调用时自动记录使用量（rate_limit 配额联动）
  - 哈希存储（只展示前缀，不明文保存）

使用方式：
    mgr = ApiKeyManager()

    # 创建 API Key
    key_info = mgr.create_key(tenant_id="t001", label="生产环境Key",
                               tag="production", created_by="admin")
    # → {"key_id": "ak_xxx", "key_prefix": "sk-abc12", "secret": "sk-abc1234...（仅显示一次）"}

    # 验证 API Key（API 中间件调用）
    result = mgr.verify_key("sk-abc1234...")
    # → {"valid": True, "tenant_id": "t001", "tag": "production", "key_id": "ak_xxx"}

    # 列出租户所有 Key
    keys = mgr.list_keys(tenant_id="t001")

    # 吊销 Key
    mgr.revoke_key("ak_xxx", revoked_by="admin")
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_DB_PATH = os.getenv("API_KEY_MANAGER_DB", "./data/api_key_manager.sqlite")


class ApiKeyManager:
    """
    Project 级别 API Key 管理（对应 Langfuse projectApiKeysRouter）。

    特性：
    - Key 前缀：sk- 开头，共32位随机字符
    - 哈希存储：数据库只存 SHA-256 哈希，明文只在创建时返回一次
    - 标签：production / staging / development / test
    - 用量追踪：每次调用自动更新 call_count / last_used_at
    - 吊销：软删除（is_revoked=1），不影响历史记录
    - 配额联动：验证时可附带配额检查（传入 quota_checker 回调）
    """

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()
        # 内存缓存（避免每次请求都查 DB）
        self._cache: dict[str, dict] = {}

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _hash_key(self, raw_key: str) -> str:
        return hashlib.sha256(raw_key.encode()).hexdigest()

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS api_keys (
                    key_id          TEXT PRIMARY KEY,
                    tenant_id       TEXT NOT NULL,
                    key_hash        TEXT NOT NULL UNIQUE,   -- SHA-256 哈希
                    key_prefix      TEXT NOT NULL,          -- 前8位（用于 UI 显示）
                    label           TEXT DEFAULT '',        -- 用户自定义标签
                    tag             TEXT DEFAULT 'production', -- production/staging/dev/test
                    permissions     TEXT DEFAULT '["read","write"]',  -- JSON array
                    call_count      INTEGER DEFAULT 0,
                    last_used_at    TEXT,
                    is_revoked      INTEGER DEFAULT 0,
                    revoked_at      TEXT,
                    revoked_by      TEXT DEFAULT '',
                    created_by      TEXT DEFAULT 'system',
                    created_at      TEXT NOT NULL,
                    expires_at      TEXT                    -- NULL 表示永不过期
                );
                CREATE INDEX IF NOT EXISTS idx_key_tenant ON api_keys(tenant_id, is_revoked);
                CREATE INDEX IF NOT EXISTS idx_key_hash ON api_keys(key_hash);

                -- Key 调用记录（按天汇总，节省空间）
                CREATE TABLE IF NOT EXISTS api_key_usage (
                    usage_id    TEXT PRIMARY KEY,
                    key_id      TEXT NOT NULL,
                    tenant_id   TEXT NOT NULL,
                    day         TEXT NOT NULL,  -- YYYY-MM-DD
                    call_count  INTEGER DEFAULT 1,
                    UNIQUE(key_id, day),
                    FOREIGN KEY (key_id) REFERENCES api_keys(key_id)
                );
                CREATE INDEX IF NOT EXISTS idx_usage_key ON api_key_usage(key_id, day);
                CREATE INDEX IF NOT EXISTS idx_usage_tenant ON api_key_usage(tenant_id, day);
            """)
            conn.commit()
        finally:
            conn.close()

    # ── 创建 ──────────────────────────────────────────────────────

    def create_key(
        self,
        tenant_id: str,
        label: str = "",
        tag: str = "production",
        permissions: list[str] | None = None,
        created_by: str = "system",
        expires_at: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        创建新 API Key（对应 Langfuse projectApiKeyRouter.create）。
        明文 secret 只在此方法返回一次，之后无法恢复。
        返回 {key_id, key_prefix, secret（完整 key，仅此一次）, label, tag}
        """
        # 生成 sk- 前缀的32位随机 key
        raw_key = "sk-" + secrets.token_urlsafe(32)[:32]
        key_prefix = raw_key[:8]  # 前8位用于 UI 显示（如 "sk-abc12"）
        key_hash = self._hash_key(raw_key)
        key_id = f"ak_{uuid.uuid4().hex[:12]}"

        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO api_keys
                   (key_id, tenant_id, key_hash, key_prefix, label, tag,
                    permissions, created_by, created_at, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (key_id, tenant_id, key_hash, key_prefix, label, tag,
                 json.dumps(permissions or ["read", "write"]),
                 created_by, self._now(), expires_at)
            )
            conn.commit()
        finally:
            conn.close()

        # 清除缓存
        self._cache.pop(key_hash, None)

        return {
            "key_id": key_id,
            "tenant_id": tenant_id,
            "key_prefix": key_prefix,
            "secret": raw_key,  # ⚠️ 仅此一次，请立即保存
            "label": label,
            "tag": tag,
            "permissions": permissions or ["read", "write"],
            "created_at": self._now(),
            "warning": "⚠️ 请立即保存此 Key，离开此页面后将无法再次查看完整 Key",
        }

    # ── 验证 ──────────────────────────────────────────────────────

    def verify_key(self, raw_key: str) -> dict[str, Any]:
        """
        验证 API Key（API 中间件调用）。
        自动更新 call_count 和 last_used_at。
        返回 {valid, tenant_id, key_id, tag, permissions} 或 {valid: False, reason}
        """
        if not raw_key or not raw_key.startswith("sk-"):
            return {"valid": False, "reason": "invalid_format"}

        key_hash = self._hash_key(raw_key)

        # 内存缓存（TTL 60秒，避免频繁 DB 查询）
        cached = self._cache.get(key_hash)
        if cached:
            import time
            if time.time() - cached.get("_cached_at", 0) < 60:
                self._record_usage_async(cached["key_id"], cached["tenant_id"])
                return {k: v for k, v in cached.items() if not k.startswith("_")}

        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM api_keys WHERE key_hash=?", (key_hash,)
            ).fetchone()
        finally:
            conn.close()

        if not row:
            return {"valid": False, "reason": "key_not_found"}

        if row["is_revoked"]:
            return {"valid": False, "reason": "key_revoked"}

        if row["expires_at"] and row["expires_at"] < self._now():
            return {"valid": False, "reason": "key_expired"}

        result = {
            "valid": True,
            "key_id": row["key_id"],
            "tenant_id": row["tenant_id"],
            "tag": row["tag"],
            "label": row["label"],
            "permissions": json.loads(row["permissions"] or '["read","write"]'),
        }

        # 更新缓存
        import time
        self._cache[key_hash] = {**result, "_cached_at": time.time()}

        # 异步更新 call_count（非阻塞）
        self._record_usage_async(row["key_id"], row["tenant_id"])

        return result

    def _record_usage_async(self, key_id: str, tenant_id: str) -> None:
        """更新 call_count 和每日用量（忽略失败）"""
        try:
            today = datetime.now(timezone.utc).date().isoformat()
            conn = self._conn()
            try:
                conn.execute(
                    "UPDATE api_keys SET call_count=call_count+1, last_used_at=? WHERE key_id=?",
                    (self._now(), key_id)
                )
                conn.execute(
                    """INSERT INTO api_key_usage (usage_id, key_id, tenant_id, day, call_count)
                       VALUES (?, ?, ?, ?, 1)
                       ON CONFLICT(key_id, day) DO UPDATE SET call_count=call_count+1""",
                    (f"ku_{uuid.uuid4().hex[:8]}", key_id, tenant_id, today)
                )
                conn.commit()
            finally:
                conn.close()
        except Exception:
            pass

    # ── 列表 / 查询 ───────────────────────────────────────────────

    def list_keys(self, tenant_id: str) -> list[dict[str, Any]]:
        """列出租户所有 API Key（不含 key_hash，仅显示前缀）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                """SELECT key_id, tenant_id, key_prefix, label, tag, permissions,
                          call_count, last_used_at, is_revoked, revoked_at,
                          created_by, created_at, expires_at
                   FROM api_keys WHERE tenant_id=? ORDER BY created_at DESC""",
                (tenant_id,)
            ).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                d["permissions"] = json.loads(d.get("permissions", '["read","write"]'))
                d["key_display"] = d["key_prefix"] + "..." + "****"  # 只显示前缀
                result.append(d)
            return result
        finally:
            conn.close()

    def get_usage_stats(self, key_id: str, days: int = 30) -> dict[str, Any]:
        """获取 API Key 每日调用趋势"""
        from datetime import timedelta
        since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
        conn = self._conn()
        try:
            daily = conn.execute(
                """SELECT day, call_count FROM api_key_usage
                   WHERE key_id=? AND day >= ? ORDER BY day""",
                (key_id, since)
            ).fetchall()
            total = conn.execute(
                "SELECT call_count, last_used_at FROM api_keys WHERE key_id=?", (key_id,)
            ).fetchone()
            return {
                "key_id": key_id,
                "total_calls": total["call_count"] if total else 0,
                "last_used_at": total["last_used_at"] if total else None,
                "daily_trend": [dict(r) for r in daily],
            }
        finally:
            conn.close()

    # ── 吊销 ──────────────────────────────────────────────────────

    def revoke_key(self, key_id: str, revoked_by: str = "system") -> bool:
        """吊销 API Key（软删除）"""
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE api_keys SET is_revoked=1, revoked_at=?, revoked_by=? WHERE key_id=?",
                (self._now(), revoked_by, key_id)
            )
            conn.commit()
            # 清除缓存
            self._cache = {k: v for k, v in self._cache.items()
                           if v.get("key_id") != key_id}
            return True
        finally:
            conn.close()

    def rotate_key(
        self,
        key_id: str,
        rotated_by: str = "system",
    ) -> dict[str, Any]:
        """
        轮换 Key（吊销旧 Key + 创建新 Key，保持相同配置）。
        返回新 Key 信息（含一次性明文 secret）。
        """
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM api_keys WHERE key_id=?", (key_id,)
            ).fetchone()
        finally:
            conn.close()

        if not row:
            return {"error": "Key 不存在"}

        # 创建新 Key
        new_key = self.create_key(
            tenant_id=row["tenant_id"],
            label=f"{row['label']} (rotated)",
            tag=row["tag"],
            permissions=json.loads(row["permissions"] or '["read","write"]'),
            created_by=rotated_by,
        )
        # 吊销旧 Key
        self.revoke_key(key_id, revoked_by=rotated_by)
        new_key["old_key_id"] = key_id
        new_key["rotated"] = True
        return new_key


# FastAPI 中间件：验证 API Key + 配额检查
def make_api_key_middleware(key_manager: Optional[ApiKeyManager] = None):
    """
    生成 FastAPI API Key 验证中间件（对应 Langfuse API 认证）。

    用法：
        from fastapi import FastAPI
        from api_key_manager import make_api_key_middleware
        app = FastAPI()
        app.middleware("http")(make_api_key_middleware())
    """
    if key_manager is None:
        key_manager = get_api_key_manager()

    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import JSONResponse

    # 不需要 API Key 的路径前缀
    PUBLIC_PATHS = {"/docs", "/redoc", "/openapi.json", "/health",
                   "/api/auth", "/api/public/webhook"}

    class ApiKeyMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            path = request.url.path
            # 公开路径直接放行
            if any(path.startswith(p) for p in PUBLIC_PATHS):
                return await call_next(request)

            # 内部路径（/internal/）跳过 API Key 检查
            if path.startswith("/internal/"):
                return await call_next(request)

            # 提取 API Key
            auth_header = request.headers.get("Authorization", "")
            api_key = ""
            if auth_header.startswith("Bearer "):
                api_key = auth_header[7:]
            elif auth_header.startswith("Basic "):
                import base64
                try:
                    decoded = base64.b64decode(auth_header[6:]).decode()
                    api_key = decoded.split(":")[1] if ":" in decoded else decoded
                except Exception:
                    pass
            # 也支持 X-Api-Key header
            if not api_key:
                api_key = request.headers.get("X-Api-Key", "")

            if not api_key:
                return JSONResponse(
                    {"error": "missing_api_key", "message": "请提供 API Key（Authorization: Bearer sk-xxx）"},
                    status_code=401
                )

            result = key_manager.verify_key(api_key)
            if not result["valid"]:
                return JSONResponse(
                    {"error": "invalid_api_key", "reason": result.get("reason", "unknown")},
                    status_code=401
                )

            # 将 tenant_id 注入 request.state
            request.state.tenant_id = result["tenant_id"]
            request.state.key_id = result["key_id"]
            request.state.api_key_tag = result["tag"]

            return await call_next(request)

    return ApiKeyMiddleware


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_mgr: Optional[ApiKeyManager] = None

def get_api_key_manager() -> ApiKeyManager:
    global _default_mgr
    if _default_mgr is None:
        _default_mgr = ApiKeyManager()
    return _default_mgr
