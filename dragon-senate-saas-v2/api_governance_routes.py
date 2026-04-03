"""
api_governance_routes.py — 统一治理 API 路由
=============================================
灵感来源：
  boxyhq/saas-starter-kit pages/api/* + components/*
  open-saas template/app/src/admin/ + analytics/
  chakra-ui → 前端组件对应的 API 契约

挂载方式（app.py）：
  from api_governance_routes import router as gov_router
  app.include_router(gov_router, prefix="")

端点清单：

  # 治理 & 能力矩阵
  GET  /api/tenant/{tid}/capabilities       → CapabilityMatrix（前端直接消费）
  GET  /api/tenant/{tid}/policy-limits      → PolicyLimits
  POST /api/tenant/{tid}/remote-override    → 云端配置覆盖（管理员）

  # RBAC 权限
  GET  /api/rbac/matrix                     → 完整角色权限矩阵
  GET  /api/rbac/roles                      → 可用角色列表

  # 技能市场
  GET  /api/skills                          → 技能列表（带 source/governance_tier 过滤）
  GET  /api/skills/{lobster_id}             → 指定龙虾的技能列表
  POST /api/skills/{skill_id}/toggle        → 启用/禁用技能（admin+）

  # 计费 & 订阅
  GET  /api/tenant/{tid}/billing            → 账单摘要
  GET  /api/plans                           → 计划列表
  POST /api/billing/webhook                 → 支付平台 Webhook 回调
  POST /api/tenant/{tid}/check-quota        → 检查用量配额

  # Webhook 端点
  GET  /api/tenant/{tid}/webhooks           → Webhook 端点列表
  POST /api/tenant/{tid}/webhooks           → 创建 Webhook 端点
  DELETE /api/tenant/{tid}/webhooks/{id}   → 删除 Webhook 端点
  GET  /api/tenant/{tid}/events             → 事件日志

  # 审计日志
  GET  /api/tenant/{tid}/audit-log          → 审计日志查询
  GET  /api/tenant/{tid}/metrics            → Metrics 汇总

  # 团队记忆
  GET  /api/tenant/{tid}/memory             → 记忆统计
  GET  /api/tenant/{tid}/memory/entries     → 记忆条目查询
  DELETE /api/tenant/{tid}/memory/{eid}    → 删除记忆条目

  # 边缘节点
  GET  /api/edges                           → 在线边缘节点列表
  POST /api/edges/{eid}/wake               → 唤醒边缘节点
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter(tags=["governance"])


# ════════════════════════════════════════════════════════════════════
# 治理 & 能力矩阵
# ════════════════════════════════════════════════════════════════════

@router.get("/api/tenant/{tenant_id}/capabilities")
async def get_capabilities(tenant_id: str, request: Request):
    """
    获取租户能力矩阵（前端 Capability Gate 直接消费）。
    支持 ETag 缓存。
    """
    from platform_governance import get_governance_service
    from saas_billing import get_billing_service

    billing = get_billing_service()
    tier = billing.get_tenant_tier(tenant_id)

    gov = get_governance_service()
    matrix = gov.get_capability_matrix(tenant_id, tier)

    # ETag 支持
    if_none_match = request.headers.get("If-None-Match", "")
    if if_none_match == matrix.etag:
        from fastapi.responses import Response
        return Response(status_code=304)

    from fastapi.responses import JSONResponse
    return JSONResponse(
        content={"ok": True, **matrix.to_dict()},
        headers={"ETag": matrix.etag, "Cache-Control": "max-age=30"},
    )


@router.get("/api/tenant/{tenant_id}/policy-limits")
async def get_policy_limits(tenant_id: str):
    from platform_governance import PolicyLimits
    from saas_billing import get_billing_service
    tier = get_billing_service().get_tenant_tier(tenant_id)
    limits = PolicyLimits.for_tier(tier)
    return {"ok": True, "tenant_id": tenant_id, "tenant_tier": tier, **limits.to_dict()}


@router.post("/api/tenant/{tenant_id}/remote-override")
async def apply_remote_override(tenant_id: str, request: Request):
    """云端推送配置覆盖（仅平台管理员调用）"""
    body = await request.json()
    overrides = body.get("overrides", {})
    if not overrides:
        raise HTTPException(400, "overrides 不能为空")

    from platform_governance import get_governance_service
    gov = get_governance_service()
    gov.apply_remote_override(tenant_id, overrides)

    return {"ok": True, "tenant_id": tenant_id, "applied_keys": list(overrides.keys())}


# ════════════════════════════════════════════════════════════════════
# RBAC 权限
# ════════════════════════════════════════════════════════════════════

@router.get("/api/rbac/matrix")
async def get_rbac_matrix():
    """完整角色权限矩阵（供前端 Settings/Roles 页面）"""
    from rbac_permission import get_rbac_service
    rbac = get_rbac_service()
    return {"ok": True, "matrix": rbac.get_permissions_matrix()}


@router.get("/api/rbac/roles")
async def get_roles():
    """可用角色列表（供邀请/分配页面）"""
    from rbac_permission import get_rbac_service
    rbac = get_rbac_service()
    return {"ok": True, "roles": rbac.get_available_roles()}


@router.get("/api/rbac/check")
async def check_permission(
    role: str = Query(...),
    resource: str = Query(...),
    action: str = Query(...),
):
    """检查单个权限（调试用）"""
    from rbac_permission import get_rbac_service
    rbac = get_rbac_service()
    allowed = rbac.can(role, resource, action)
    return {"ok": True, "role": role, "resource": resource, "action": action, "allowed": allowed}


# ════════════════════════════════════════════════════════════════════
# 技能市场
# ════════════════════════════════════════════════════════════════════

@router.get("/api/skills")
async def list_skills(
    source: str | None = Query(None),
    governance_tier: str | None = Query(None),
    category: str | None = Query(None),
    enabled_only: bool = Query(True),
):
    """技能列表（带过滤，供前端技能市场页）"""
    from skill_frontmatter import get_skill_frontmatter_registry
    reg = get_skill_frontmatter_registry()
    skills = reg.list_all(
        source=source,
        governance_tier=governance_tier,
        category=category,
        enabled_only=enabled_only,
    )
    return {
        "ok": True,
        "total": len(skills),
        "skills": [s.to_dict() for s in skills],
    }


@router.get("/api/skills/{lobster_id}")
async def list_skills_for_lobster(lobster_id: str):
    """指定龙虾的技能列表（含元数据）"""
    from skill_frontmatter import get_skill_frontmatter_registry
    reg = get_skill_frontmatter_registry()
    skills = reg.list_for_lobster(lobster_id)
    return {
        "ok": True,
        "lobster_id": lobster_id,
        "skills": [s.to_dict() for s in skills],
        "commander_routing_hint": reg.get_commander_routing_summary([s.id for s in skills]),
    }


@router.post("/api/skills/{skill_id}/toggle")
async def toggle_skill(skill_id: str, request: Request):
    """启用/禁用技能"""
    body = await request.json()
    enabled = bool(body.get("enabled", True))

    from skill_frontmatter import get_skill_frontmatter_registry
    reg = get_skill_frontmatter_registry()
    skill = reg.get(skill_id)
    if not skill:
        raise HTTPException(404, f"技能 {skill_id} 不存在")

    skill.enabled = enabled
    return {"ok": True, "skill_id": skill_id, "enabled": enabled}


# ════════════════════════════════════════════════════════════════════
# 计费 & 订阅
# ════════════════════════════════════════════════════════════════════

@router.get("/api/tenant/{tenant_id}/billing")
async def get_billing(tenant_id: str):
    """账单摘要（供前端 Billing 页）"""
    from saas_billing import get_billing_service
    billing = get_billing_service()
    return {"ok": True, **billing.get_billing_summary(tenant_id)}


@router.get("/api/plans")
async def get_plans(billing_period: str | None = Query(None)):
    """计划列表（供前端 Pricing 页）"""
    from saas_billing import list_plans
    return {"ok": True, "plans": list_plans(billing_period)}


@router.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    """
    支付平台 Webhook 回调入口（Stripe/微信/支付宝）。
    仿 open-saas payment/webhook.ts
    """
    body = await request.json()
    event_type = body.get("type", body.get("event_type", ""))
    data = body.get("data", body)

    from saas_billing import get_billing_service
    billing = get_billing_service()
    ok = billing.handle_webhook(event_type, data)

    if ok:
        # 触发平台事件
        tenant_id = data.get("tenant_id", "")
        if tenant_id and "subscription" in event_type:
            from event_subjects import EventSubjects
            from webhook_event_bus import PlatformEvent, get_event_bus
            bus = get_event_bus()
            await bus.emit(PlatformEvent(
                event_type="billing.subscription.updated",
                subject=EventSubjects.format(
                    EventSubjects.TENANT_BILLING_SUBSCRIPTION_UPDATED,
                    tenant_id=tenant_id,
                ),
                tenant_id=tenant_id,
                payload={"event_type": event_type},
            ))

    return {"ok": ok, "received": event_type}


@router.post("/api/tenant/{tenant_id}/check-quota")
async def check_quota(tenant_id: str, request: Request):
    """检查用量配额（龙虾运行前调用）"""
    body = await request.json()
    metric = body.get("metric", "tokens")
    from saas_billing import get_billing_service
    billing = get_billing_service()
    within, message = billing.check_quota(tenant_id, metric)
    return {"ok": True, "within_limit": within, "message": message, "metric": metric}


# ════════════════════════════════════════════════════════════════════
# Webhook 端点管理
# ════════════════════════════════════════════════════════════════════

@router.get("/api/tenant/{tenant_id}/webhooks")
async def list_webhooks(tenant_id: str):
    from webhook_event_bus import get_event_bus
    bus = get_event_bus()
    return {"ok": True, "webhooks": bus.list_endpoints(tenant_id)}


@router.post("/api/tenant/{tenant_id}/webhooks")
async def create_webhook(tenant_id: str, request: Request):
    body = await request.json()
    url = body.get("url", "")
    if not url or not url.startswith("http"):
        raise HTTPException(400, "需要有效的 URL")

    from webhook_event_bus import WebhookEndpoint, get_event_bus
    ep = WebhookEndpoint(
        tenant_id=tenant_id,
        url=url,
        description=body.get("description", ""),
        event_types=list(body.get("event_types", [])),
    )
    bus = get_event_bus()
    bus.register_endpoint(ep)
    return {"ok": True, "endpoint": ep.to_dict()}


@router.delete("/api/tenant/{tenant_id}/webhooks/{endpoint_id}")
async def delete_webhook(tenant_id: str, endpoint_id: str):
    from webhook_event_bus import get_event_bus
    bus = get_event_bus()
    bus.delete_endpoint(endpoint_id)
    return {"ok": True, "deleted": endpoint_id}


@router.get("/api/tenant/{tenant_id}/events")
async def get_events(tenant_id: str, limit: int = Query(50, le=200)):
    """最近事件日志（供前端 Activity 页）"""
    from webhook_event_bus import get_event_bus
    bus = get_event_bus()
    return {"ok": True, "events": bus.get_recent_events(tenant_id, limit)}


# ════════════════════════════════════════════════════════════════════
# 审计日志
# ════════════════════════════════════════════════════════════════════

@router.get("/api/tenant/{tenant_id}/audit-log")
async def get_audit_log(
    tenant_id: str,
    action: str | None = Query(None),
    actor_id: str | None = Query(None),
    since_hours: float = Query(24.0),
    limit: int = Query(100, le=500),
):
    """审计日志查询（仿 boxyhq retraced viewer）"""
    from tenant_audit_log import get_audit_service
    audit = get_audit_service()
    since = time.time() - since_hours * 3600
    events = audit.query(tenant_id, action=action, actor_id=actor_id, since=since, limit=limit)
    return {"ok": True, "total": len(events), "events": events}


@router.get("/api/tenant/{tenant_id}/metrics")
async def get_metrics(tenant_id: str):
    """Metrics 汇总（仿 boxyhq OTEL metrics）"""
    from tenant_audit_log import get_audit_service
    audit = get_audit_service()
    return {"ok": True, "tenant_id": tenant_id, **audit.get_metrics_summary()}


# ════════════════════════════════════════════════════════════════════
# 团队记忆
# ════════════════════════════════════════════════════════════════════

@router.get("/api/tenant/{tenant_id}/memory")
async def get_memory_stats(tenant_id: str):
    """记忆统计（供前端 Memory 页）"""
    from tenant_memory_sync import get_tenant_memory_service
    svc = get_tenant_memory_service()
    return {"ok": True, **svc.get_stats(tenant_id)}


@router.get("/api/tenant/{tenant_id}/memory/entries")
async def get_memory_entries(
    tenant_id: str,
    scope: str | None = Query(None),
    category: str | None = Query(None),
    query: str | None = Query(None),
    limit: int = Query(20, le=100),
):
    """记忆条目查询"""
    from tenant_memory_sync import get_tenant_memory_service
    svc = get_tenant_memory_service()
    entries = svc.recall(
        tenant_id=tenant_id,
        scope=scope,
        category=category,
        query=query,
        limit=limit,
    )
    return {"ok": True, "total": len(entries), "entries": [e.to_dict() for e in entries]}


@router.delete("/api/tenant/{tenant_id}/memory/{entry_id}")
async def delete_memory_entry(tenant_id: str, entry_id: str):
    """软删除记忆条目"""
    from tenant_memory_sync import get_tenant_memory_service
    svc = get_tenant_memory_service()
    ok = await svc.delete(entry_id)
    return {"ok": ok, "entry_id": entry_id}


# ════════════════════════════════════════════════════════════════════
# 边缘节点管理
# ════════════════════════════════════════════════════════════════════

@router.get("/api/edges")
async def list_edges(tenant_id: str | None = Query(None)):
    """在线边缘节点列表"""
    from bridge_protocol import get_bridge_manager
    bridge = get_bridge_manager()
    edges = bridge.capacity_wake.list_online_edges(tenant_id)
    return {"ok": True, "total": len(edges), "edges": edges}


@router.post("/api/edges/{edge_id}/wake")
async def wake_edge(edge_id: str, request: Request):
    """唤醒指定边缘节点"""
    body = await request.json()
    tenant_id = body.get("tenant_id", "")
    task_id = body.get("task_id", "ping")

    from bridge_protocol import CapacityWakeSignal, get_bridge_manager
    bridge = get_bridge_manager()
    signal = CapacityWakeSignal(
        edge_id=edge_id,
        tenant_id=tenant_id,
        task_id=task_id,
        priority=int(body.get("priority", 0)),
    )
    ok = await bridge.capacity_wake.wake(signal)
    return {"ok": ok, "edge_id": edge_id, "signal_id": signal.signal_id}


@router.get("/api/edges/sessions")
async def list_bridge_sessions(
    tenant_id: str | None = Query(None),
    status: str | None = Query(None),
):
    """桥接会话列表"""
    from bridge_protocol import get_bridge_manager
    bridge = get_bridge_manager()
    sessions = bridge.list_sessions(tenant_id=tenant_id, status=status)
    return {"ok": True, "total": len(sessions), "sessions": [s.to_dict() for s in sessions]}


@router.post("/api/edge/{edge_node_id}/schedule/sync")
async def sync_edge_schedule(edge_node_id: str, request: Request):
    """Queue a persisted SOP schedule package for the target edge node."""
    body = await request.json()
    schedule = body.get("schedule") if isinstance(body.get("schedule"), dict) else body
    if not isinstance(schedule, dict) or not str(schedule.get("job_id") or "").strip():
        raise HTTPException(400, "schedule.job_id 不能为空")
    request.app.state.edge_outbox.setdefault(edge_node_id, []).append(
        {
            "type": "sop_schedule_sync",
            "schedule": schedule,
            "created_at": time.time(),
        }
    )
    return {"ok": True, "status": "queued", "edge_node_id": edge_node_id, "job_id": str(schedule.get("job_id"))}


@router.post("/api/edge/{edge_node_id}/schedule/remove")
async def remove_edge_schedule(edge_node_id: str, request: Request):
    """Queue a schedule removal package for the target edge node."""
    body = await request.json()
    job_id = str(body.get("job_id") or "").strip()
    if not job_id:
        raise HTTPException(400, "job_id 不能为空")
    request.app.state.edge_outbox.setdefault(edge_node_id, []).append(
        {
            "type": "sop_schedule_remove",
            "job_id": job_id,
            "created_at": time.time(),
        }
    )
    return {"ok": True, "status": "queued", "edge_node_id": edge_node_id, "job_id": job_id}


@router.get("/api/edge/{edge_node_id}/schedule/status")
async def get_edge_schedule_status(edge_node_id: str, request: Request):
    """Request edge schedule status on next poll and return queue summary."""
    request.app.state.edge_outbox.setdefault(edge_node_id, []).append(
        {
            "type": "scheduler_status_request",
            "session_id": f"sop_status_{int(time.time())}",
            "created_at": time.time(),
        }
    )
    pending = len(request.app.state.edge_outbox.get(edge_node_id, []))
    return {"ok": True, "status": "queued", "edge_node_id": edge_node_id, "pending_outbox": pending}
