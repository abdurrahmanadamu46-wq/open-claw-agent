"""
Global cross-entity search API.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Query

from channel_account_manager import channel_account_manager
from lifecycle_manager import get_lifecycle_manager
from tenant_audit_log import get_audit_service
from tenant_context import TenantContext, get_tenant_context
from white_label_config import get_white_label_manager
from workflow_engine import list_workflows


router = APIRouter(prefix="/api/v1/search", tags=["search"])


def _contains(haystack: str, query: str) -> bool:
    return query in str(haystack or "").lower()


def _search_lobsters(q: str, limit: int) -> list[dict[str, Any]]:
    items = []
    for lobster in get_lifecycle_manager().list_lobsters():
        corpus = " ".join([
            str(lobster.get("display_name") or ""),
            str(lobster.get("zh_name") or ""),
            str(lobster.get("role") or ""),
            str(lobster.get("description") or ""),
            " ".join(str(skill) for skill in lobster.get("skills", [])),
        ]).lower()
        if not _contains(corpus, q):
            continue
        items.append(
            {
                "id": lobster["id"],
                "display_name": lobster.get("zh_name") or lobster.get("display_name") or lobster["id"],
                "description": lobster.get("description") or lobster.get("role") or "",
                "lifecycle": lobster.get("lifecycle", "production"),
                "status": lobster.get("status", "idle"),
                "href": f"/lobsters/{lobster['id']}",
            }
        )
    return items[:limit]


def _search_workflows(q: str, limit: int) -> list[dict[str, Any]]:
    items = []
    for workflow in list_workflows():
        corpus = " ".join([
            str(workflow.get("id") or ""),
            str(workflow.get("name") or ""),
            str(workflow.get("description") or ""),
        ]).lower()
        if not _contains(corpus, q):
            continue
        items.append(
            {
                "id": workflow.get("id"),
                "name": workflow.get("name"),
                "description": workflow.get("description", ""),
                "step_count": int(workflow.get("step_count", 0) or 0),
                "status": "active",
                "href": "/operations/workflows",
            }
        )
    return items[:limit]


def _search_channels(q: str, tenant_id: str, limit: int) -> list[dict[str, Any]]:
    rows = []
    snapshot = channel_account_manager.describe()
    for channel, block in snapshot.items():
        for account in block.get("accounts", []):
            if account.get("tenant") and account.get("tenant") != tenant_id:
                continue
            corpus = " ".join([channel, str(account.get("id") or ""), str(account.get("name") or "")]).lower()
            if not _contains(corpus, q):
                continue
            rows.append(
                {
                    "id": f"{channel}:{account.get('id')}",
                    "account_name": account.get("name") or account.get("id"),
                    "platform": channel,
                    "status": "active" if account.get("enabled") else "paused",
                    "href": "/operations/channels",
                }
            )
    return rows[:limit]


def _search_audits(q: str, tenant_id: str, limit: int) -> list[dict[str, Any]]:
    items = []
    for event in get_audit_service().query(tenant_id, limit=max(limit * 3, 20)):
        corpus = " ".join([
            str(event.get("event_type") or ""),
            str(event.get("resource_id") or ""),
            json.dumps(event.get("details") or {}, ensure_ascii=False),
        ]).lower()
        if not _contains(corpus, q):
            continue
        items.append(
            {
                "id": event.get("id"),
                "title": str(event.get("event_type") or ""),
                "description": str(event.get("resource_id") or ""),
                "severity": str(event.get("severity") or "INFO"),
                "href": "/settings/audit",
            }
        )
    return items[:limit]


def _search_tenants(q: str, ctx: TenantContext, limit: int) -> list[dict[str, Any]]:
    tenant_ids = set(get_audit_service().list_tenant_ids())
    tenant_ids.add(ctx.tenant_id)
    if "admin" not in ctx.roles and "owner" not in ctx.roles:
        tenant_ids = {ctx.tenant_id}
    manager = get_white_label_manager()
    rows = []
    for tenant_id in sorted(tenant_ids):
        config = manager.get_config(tenant_id)
        corpus = " ".join([tenant_id, config.brand_name or "", config.custom_domain or ""]).lower()
        if not _contains(corpus, q):
            continue
        rows.append(
            {
                "id": tenant_id,
                "name": config.brand_name or tenant_id,
                "plan": config.custom_domain or "default",
                "href": "/settings/tenants",
            }
        )
    return rows[:limit]


@router.get("")
async def global_search(
    q: str = Query(..., min_length=2, max_length=100),
    types: str = Query(default="lobster,workflow,channel,audit,tenant"),
    limit: int = Query(default=5, ge=1, le=20),
    ctx: TenantContext = Depends(get_tenant_context),
):
    query = q.strip().lower()
    type_list = {item.strip() for item in types.split(",") if item.strip()}
    results = {
        "lobsters": _search_lobsters(query, limit) if "lobster" in type_list else [],
        "workflows": _search_workflows(query, limit) if "workflow" in type_list else [],
        "channels": _search_channels(query, ctx.tenant_id, limit) if "channel" in type_list else [],
        "audits": _search_audits(query, ctx.tenant_id, limit) if "audit" in type_list else [],
        "tenants": _search_tenants(query, ctx, limit) if "tenant" in type_list else [],
    }
    return {"ok": True, "query": q, **results}
