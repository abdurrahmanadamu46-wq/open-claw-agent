"""
FastAPI resource-level RBAC dependency helper.
"""

from __future__ import annotations

from typing import Any, Callable

from fastapi import Depends, HTTPException, Request

from rbac_permission import ResourceScope, ResourceType, get_rbac_service
from tenant_audit_log import AuditEventType, get_audit_service
from tenant_context import TenantContext, get_tenant_context


def require_resource_permission(
    resource_type: ResourceType,
    scope: ResourceScope,
    resource_id_param: str = "resource_id",
    resource_id_builder: Callable[[Request], str] | None = None,
):
    async def _dependency(
        request: Request,
        ctx: TenantContext = Depends(get_tenant_context),
    ) -> TenantContext:
        resource_id = (
            resource_id_builder(request)
            if callable(resource_id_builder)
            else str(
                request.path_params.get(resource_id_param)
                or request.query_params.get(resource_id_param)
                or "*"
            ).strip()
        ) or "*"

        await ctx.assert_resource_belongs_to_tenant(resource_type.value, resource_id)
        allowed, matched_rule, reason = get_rbac_service().check_resource_permission(
            user_id=ctx.user_id,
            tenant_id=ctx.tenant_id,
            resource_type=resource_type,
            resource_id=resource_id,
            scope=scope,
            roles=ctx.roles,
        )
        if allowed:
            return ctx

        await get_audit_service().log(
            event_type=AuditEventType.PERMISSION_DENIED,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
            resource_type=resource_type.value,
            resource_id=resource_id,
            details={
                "scope": scope.value,
                "roles": list(ctx.roles),
                "reason": reason,
                "matched_rule": matched_rule.to_dict() if matched_rule else None,
                "path": request.url.path,
                "method": request.method,
            },
            ip_address=getattr(request.client, "host", "") if request.client else "",
        )
        raise HTTPException(status_code=403, detail="Resource permission denied")

    return Depends(_dependency)
