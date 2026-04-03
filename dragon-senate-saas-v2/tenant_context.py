"""
Tenant request context and isolation helpers.
"""

from __future__ import annotations

import os
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Request
from jose import JWTError, jwt

from channel_account_manager import channel_account_manager
from user_auth import claims_from_user, get_user_from_access_token


_tenant_ctx: ContextVar[str | None] = ContextVar("tenant_id", default=None)
_user_ctx: ContextVar[str | None] = ContextVar("user_id", default=None)
_roles_ctx: ContextVar[list[str]] = ContextVar("roles", default=[])


def _jwt_secret() -> str:
    return os.getenv("JWT_SECRET", "change_this_to_a_long_random_secret").strip()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_roles(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(item).strip().lower() for item in raw if str(item).strip()]
    if isinstance(raw, str):
        return [part.strip().lower() for part in raw.split(",") if part.strip()]
    return []


@dataclass(slots=True)
class TenantContext:
    tenant_id: str
    user_id: str
    roles: list[str]
    issued_at: str
    source: str = "token"

    def redis_prefix(self, key: str) -> str:
        return f"tenant:{self.tenant_id}:{str(key or '').lstrip(':')}"

    async def assert_resource_belongs_to_tenant(self, resource_type: str, resource_id: str) -> None:
        normalized_type = str(resource_type or "").strip().lower()
        normalized_id = str(resource_id or "").strip()
        if not normalized_id:
            return
        if normalized_type == "channel":
            parts = normalized_id.split(":", 1)
            if len(parts) == 2:
                account = channel_account_manager.get_account(parts[0], parts[1])
                if account is not None and account.tenant_id and account.tenant_id != self.tenant_id:
                    raise HTTPException(status_code=403, detail="resource does not belong to current tenant")
        if normalized_type == "workflow":
            try:
                from workflow_engine import WorkflowStore

                run = WorkflowStore().get_run(normalized_id)
                if run is not None and str(run.get("tenant_id") or "").strip() not in {"", self.tenant_id}:
                    raise HTTPException(status_code=403, detail="resource does not belong to current tenant")
            except Exception:
                return


def activate_tenant_context(ctx: TenantContext) -> tuple[Any, Any, Any]:
    token_a = _tenant_ctx.set(ctx.tenant_id)
    token_b = _user_ctx.set(ctx.user_id)
    token_c = _roles_ctx.set(list(ctx.roles))
    return token_a, token_b, token_c


def reset_tenant_context(tokens: tuple[Any, Any, Any] | None) -> None:
    if not tokens:
        _tenant_ctx.set(None)
        _user_ctx.set(None)
        _roles_ctx.set([])
        return
    token_a, token_b, token_c = tokens
    _tenant_ctx.reset(token_a)
    _user_ctx.reset(token_b)
    _roles_ctx.reset(token_c)


def get_current_tenant_id() -> str | None:
    return _tenant_ctx.get()


def get_current_user_id() -> str | None:
    return _user_ctx.get()


def get_current_roles() -> list[str]:
    return list(_roles_ctx.get())


async def _claims_from_token(token: str) -> TenantContext | None:
    raw = str(token or "").strip()
    if not raw:
        return None
    try:
        payload = jwt.decode(raw, _jwt_secret(), algorithms=["HS256"])
        tenant_id = str(payload.get("tenant_id") or payload.get("tenantId") or "").strip()
        if not tenant_id:
            return None
        return TenantContext(
            tenant_id=tenant_id,
            user_id=str(payload.get("sub") or "").strip() or "anonymous",
            roles=_normalize_roles(payload.get("roles")),
            issued_at=_utc_now(),
            source="legacy_jwt",
        )
    except JWTError:
        pass

    auth_user = await get_user_from_access_token(raw)
    if auth_user is None:
        return None
    claims = claims_from_user(auth_user)
    return TenantContext(
        tenant_id=claims.tenant_id,
        user_id=claims.sub,
        roles=[str(item).strip().lower() for item in claims.roles if str(item).strip()],
        issued_at=_utc_now(),
        source="auth_db",
    )


async def resolve_optional_tenant_context(request: Request) -> TenantContext | None:
    cached = getattr(request.state, "tenant_context", None)
    if isinstance(cached, TenantContext):
        return cached

    auth_header = str(request.headers.get("Authorization") or "").strip()
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    ctx = await _claims_from_token(token)
    if ctx is not None:
        request.state.tenant_context = ctx
        request.state.user_claims = {
            "sub": ctx.user_id,
            "tenant_id": ctx.tenant_id,
            "roles": list(ctx.roles),
        }
    return ctx


async def get_tenant_context(request: Request) -> TenantContext:
    ctx = await resolve_optional_tenant_context(request)
    if ctx is None:
        raise HTTPException(status_code=401, detail="Missing or invalid Bearer token")
    if not ctx.tenant_id:
        raise HTTPException(status_code=403, detail="No tenant_id in token")
    return ctx
