from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Query, Request

from channel_account_manager import ChannelAccount, channel_account_manager
from lifecycle_manager import get_lifecycle_manager
from lobster_config_center import get_lobster_config_center
from workflow_engine import WORKFLOWS_DIR, list_workflows
from workflow_admin import load_workflow_document, save_workflow_document

admin_router = APIRouter(prefix="/api/admin", tags=["admin-crud"])

_DB_PATH = Path(__file__).resolve().parent / "data" / "admin_control_panel.sqlite"
_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
_SOP_TEMPLATES_DIR = Path(__file__).resolve().parent / "sop_templates"
_SOP_TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_schema() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS admin_accounts (
                id TEXT PRIMARY KEY,
                channel TEXT NOT NULL,
                tenant_id TEXT NOT NULL DEFAULT 'tenant_main',
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                credentials_json TEXT NOT NULL DEFAULT '{}',
                options_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS admin_tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                plan_code TEXT NOT NULL DEFAULT 'free',
                seat_count INTEGER NOT NULL DEFAULT 1,
                quota INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        row = conn.execute("SELECT id FROM admin_tenants WHERE id = 'tenant_main'").fetchone()
        if row is None:
            now = _utc_now()
            conn.execute(
                """
                INSERT INTO admin_tenants(id, name, plan_code, seat_count, quota, status, notes, created_at, updated_at)
                VALUES ('tenant_main', '默认租户', 'free', 1, 10, 'active', '', ?, ?)
                """,
                (now, now),
            )
        conn.commit()


_ensure_schema()


@dataclass(slots=True)
class AdminTenantRecord:
    id: str
    name: str
    plan_code: str
    seat_count: int
    quota: int
    status: str
    notes: str
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _paginate(items: list[dict[str, Any]], *, page: int, page_size: int) -> dict[str, Any]:
    safe_page = max(1, int(page or 1))
    safe_page_size = max(1, min(int(page_size or 10), 200))
    start = (safe_page - 1) * safe_page_size
    end = start + safe_page_size
    return {"items": items[start:end], "total": len(items), "page": safe_page, "page_size": safe_page_size}


def _list_admin_accounts() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM admin_accounts ORDER BY updated_at DESC").fetchall()
    return [
        {
            "id": str(row["id"]),
            "channel": str(row["channel"]),
            "tenant_id": str(row["tenant_id"]),
            "name": str(row["name"]),
            "enabled": bool(int(row["enabled"] or 0)),
            "credentials": json.loads(str(row["credentials_json"] or "{}")),
            "options": json.loads(str(row["options_json"] or "{}")),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
        }
        for row in rows
    ]


def _upsert_admin_account(payload: dict[str, Any], account_id: str | None = None) -> dict[str, Any]:
    channel = str(payload.get("channel") or "").strip().lower()
    if not channel:
        raise HTTPException(status_code=400, detail="channel is required")
    row_id = str(account_id or payload.get("id") or f"acc_{uuid.uuid4().hex[:8]}").strip()
    now = _utc_now()
    record = {
        "id": row_id,
        "channel": channel,
        "tenant_id": str(payload.get("tenant_id") or "tenant_main").strip() or "tenant_main",
        "name": str(payload.get("name") or row_id).strip() or row_id,
        "enabled": bool(payload.get("enabled", True)),
        "credentials": payload.get("credentials") if isinstance(payload.get("credentials"), dict) else {},
        "options": payload.get("options") if isinstance(payload.get("options"), dict) else {},
        "created_at": now,
        "updated_at": now,
    }
    with _connect() as conn:
        existing = conn.execute("SELECT created_at FROM admin_accounts WHERE id = ?", (row_id,)).fetchone()
        conn.execute(
            """
            INSERT INTO admin_accounts(id, channel, tenant_id, name, enabled, credentials_json, options_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                channel=excluded.channel,
                tenant_id=excluded.tenant_id,
                name=excluded.name,
                enabled=excluded.enabled,
                credentials_json=excluded.credentials_json,
                options_json=excluded.options_json,
                updated_at=excluded.updated_at
            """,
            (
                record["id"],
                record["channel"],
                record["tenant_id"],
                record["name"],
                1 if record["enabled"] else 0,
                json.dumps(record["credentials"], ensure_ascii=False),
                json.dumps(record["options"], ensure_ascii=False),
                str(existing["created_at"]) if existing else record["created_at"],
                record["updated_at"],
            ),
        )
        conn.commit()
    channel_account_manager.register_account(
        ChannelAccount(
            account_id=record["id"],
            channel=record["channel"],
            tenant_id=record["tenant_id"],
            name=record["name"],
            enabled=record["enabled"],
            credentials=record["credentials"],
            options=record["options"],
        )
    )
    return record


def _delete_admin_account(account_id: str) -> bool:
    existing = next((item for item in _list_admin_accounts() if item["id"] == account_id), None)
    with _connect() as conn:
        cur = conn.execute("DELETE FROM admin_accounts WHERE id = ?", (account_id,))
        conn.commit()
    if existing:
        channel_account_manager.unregister_account(existing["channel"], account_id)
    return int(cur.rowcount or 0) > 0


def _list_admin_tenants() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM admin_tenants ORDER BY updated_at DESC").fetchall()
    return [AdminTenantRecord(**dict(row)).to_dict() for row in rows]


def _upsert_admin_tenant(payload: dict[str, Any], tenant_id: str | None = None) -> dict[str, Any]:
    row_id = str(tenant_id or payload.get("id") or f"tenant_{uuid.uuid4().hex[:8]}").strip()
    if not row_id:
        raise HTTPException(status_code=400, detail="tenant id is required")
    now = _utc_now()
    with _connect() as conn:
        existing = conn.execute("SELECT created_at FROM admin_tenants WHERE id = ?", (row_id,)).fetchone()
        conn.execute(
            """
            INSERT INTO admin_tenants(id, name, plan_code, seat_count, quota, status, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                plan_code=excluded.plan_code,
                seat_count=excluded.seat_count,
                quota=excluded.quota,
                status=excluded.status,
                notes=excluded.notes,
                updated_at=excluded.updated_at
            """,
            (
                row_id,
                str(payload.get("name") or row_id).strip() or row_id,
                str(payload.get("plan_code") or "free").strip() or "free",
                max(1, int(payload.get("seat_count") or 1)),
                max(0, int(payload.get("quota") or 0)),
                str(payload.get("status") or "active").strip() or "active",
                str(payload.get("notes") or "").strip(),
                str(existing["created_at"]) if existing else now,
                now,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM admin_tenants WHERE id = ?", (row_id,)).fetchone()
    return AdminTenantRecord(**dict(row)).to_dict()


def _delete_admin_tenant(tenant_id: str) -> bool:
    if tenant_id == "tenant_main":
        raise HTTPException(status_code=400, detail="tenant_main cannot be deleted")
    with _connect() as conn:
        cur = conn.execute("DELETE FROM admin_tenants WHERE id = ?", (tenant_id,))
        conn.commit()
    return int(cur.rowcount or 0) > 0


def _list_sop_templates() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for path in sorted(_SOP_TEMPLATES_DIR.glob("*.yaml")):
        payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        steps = payload.get("steps") if isinstance(payload.get("steps"), list) else []
        items.append(
            {
                "id": path.stem,
                "name": str(payload.get("name") or path.stem),
                "platform": str(payload.get("platform") or ""),
                "version": str(payload.get("version") or "v1"),
                "step_count": len(steps),
                "yaml_content": path.read_text(encoding="utf-8"),
                "updated_at": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
            }
        )
    return items


def _upsert_sop_template(template_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    row_id = str(template_id or payload.get("id") or f"sop_{uuid.uuid4().hex[:8]}").strip()
    yaml_content = str(payload.get("yaml_content") or "").strip()
    if not yaml_content:
        yaml_payload = {
            "name": str(payload.get("name") or row_id),
            "platform": str(payload.get("platform") or ""),
            "version": str(payload.get("version") or "v1"),
            "steps": payload.get("steps") if isinstance(payload.get("steps"), list) else [],
        }
        yaml_content = yaml.safe_dump(yaml_payload, allow_unicode=True, sort_keys=False)
    else:
        yaml.safe_load(yaml_content)
    path = _SOP_TEMPLATES_DIR / f"{row_id}.yaml"
    path.write_text(yaml_content, encoding="utf-8")
    return next(item for item in _list_sop_templates() if item["id"] == row_id)


def _delete_sop_template(template_id: str) -> bool:
    path = _SOP_TEMPLATES_DIR / f"{template_id}.yaml"
    if not path.exists():
        return False
    path.unlink()
    return True


def _edge_registry_rows(request: Request) -> list[dict[str, Any]]:
    registry = getattr(request.app.state, "edge_registry", {}) if hasattr(request.app, "state") else {}
    rows = [dict(item) for item in registry.values()] if isinstance(registry, dict) else []
    rows.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    return rows


@admin_router.get("/resources")
async def admin_resources():
    return {
        "ok": True,
        "resources": [
            {"name": "lobsters", "label": "🦞 龙虾管理", "operations": ["list", "show", "edit"]},
            {"name": "accounts", "label": "📱 账号管理", "operations": ["list", "create", "edit", "delete"]},
            {"name": "sop-templates", "label": "📋 SOP模板", "operations": ["list", "create", "edit", "delete"]},
            {"name": "edge-nodes", "label": "🖥️ 边缘节点", "operations": ["list", "show"]},
            {"name": "tenants", "label": "🏢 租户管理", "operations": ["list", "create", "edit", "delete"]},
            {"name": "workflows", "label": "🧭 工作流", "operations": ["list", "show", "edit"]},
            {"name": "alert-rules", "label": "🚨 告警规则", "operations": ["list"]},
        ],
    }


@admin_router.get("/lobsters")
async def admin_list_lobsters(
    tenant_id: str = Query(default="tenant_main"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=200),
):
    items = get_lobster_config_center().list_all_lobsters(tenant_id)
    return _paginate(items, page=page, page_size=page_size)


@admin_router.get("/lobsters/{lobster_id}")
async def admin_get_lobster(lobster_id: str, tenant_id: str = Query(default="tenant_main")):
    try:
        return get_lobster_config_center().get_lobster_config(lobster_id, tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="lobster_not_found") from exc


@admin_router.put("/lobsters/{lobster_id}")
async def admin_update_lobster(lobster_id: str, request: Request, tenant_id: str = Query(default="tenant_main")):
    body = await request.json()
    return get_lobster_config_center().update_lobster_config(lobster_id, tenant_id, body, updated_by="admin_control_panel")


@admin_router.get("/accounts")
async def admin_list_accounts(page: int = Query(default=1, ge=1), page_size: int = Query(default=10, ge=1, le=200)):
    return _paginate(_list_admin_accounts(), page=page, page_size=page_size)


@admin_router.get("/accounts/{account_id}")
async def admin_get_account(account_id: str):
    row = next((item for item in _list_admin_accounts() if item["id"] == account_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="account_not_found")
    return row


@admin_router.post("/accounts")
async def admin_create_account(request: Request):
    body = await request.json()
    return _upsert_admin_account(body)


@admin_router.put("/accounts/{account_id}")
async def admin_update_account(account_id: str, request: Request):
    body = await request.json()
    return _upsert_admin_account(body, account_id=account_id)


@admin_router.delete("/accounts/{account_id}")
async def admin_delete_account(account_id: str):
    deleted = _delete_admin_account(account_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="account_not_found")
    return {"ok": True, "deleted": account_id}


@admin_router.get("/sop-templates")
async def admin_list_sop_templates(page: int = Query(default=1, ge=1), page_size: int = Query(default=10, ge=1, le=200)):
    return _paginate(_list_sop_templates(), page=page, page_size=page_size)


@admin_router.get("/sop-templates/{template_id}")
async def admin_get_sop_template(template_id: str):
    row = next((item for item in _list_sop_templates() if item["id"] == template_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="sop_template_not_found")
    return row


@admin_router.post("/sop-templates")
async def admin_create_sop_template(request: Request):
    body = await request.json()
    return _upsert_sop_template(None, body)


@admin_router.put("/sop-templates/{template_id}")
async def admin_update_sop_template(template_id: str, request: Request):
    body = await request.json()
    return _upsert_sop_template(template_id, body)


@admin_router.delete("/sop-templates/{template_id}")
async def admin_delete_sop_template(template_id: str):
    deleted = _delete_sop_template(template_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="sop_template_not_found")
    return {"ok": True, "deleted": template_id}


@admin_router.get("/edge-nodes")
async def admin_list_edge_nodes(request: Request, page: int = Query(default=1, ge=1), page_size: int = Query(default=10, ge=1, le=200)):
    return _paginate(_edge_registry_rows(request), page=page, page_size=page_size)


@admin_router.get("/edge-nodes/{edge_id}")
async def admin_get_edge_node(edge_id: str, request: Request):
    row = next((item for item in _edge_registry_rows(request) if str(item.get("edge_id") or "") == edge_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="edge_node_not_found")
    return row


@admin_router.get("/tenants")
async def admin_list_tenants(page: int = Query(default=1, ge=1), page_size: int = Query(default=10, ge=1, le=200)):
    return _paginate(_list_admin_tenants(), page=page, page_size=page_size)


@admin_router.get("/tenants/{tenant_id}")
async def admin_get_tenant(tenant_id: str):
    row = next((item for item in _list_admin_tenants() if item["id"] == tenant_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="tenant_not_found")
    return row


@admin_router.post("/tenants")
async def admin_create_tenant(request: Request):
    body = await request.json()
    return _upsert_admin_tenant(body)


@admin_router.put("/tenants/{tenant_id}")
async def admin_update_tenant(tenant_id: str, request: Request):
    body = await request.json()
    return _upsert_admin_tenant(body, tenant_id=tenant_id)


@admin_router.delete("/tenants/{tenant_id}")
async def admin_delete_tenant(tenant_id: str):
    deleted = _delete_admin_tenant(tenant_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="tenant_not_found")
    return {"ok": True, "deleted": tenant_id}


@admin_router.get("/workflows")
async def admin_list_workflows(page: int = Query(default=1, ge=1), page_size: int = Query(default=10, ge=1, le=200)):
    return _paginate(list_workflows(), page=page, page_size=page_size)


@admin_router.get("/workflows/{workflow_id}")
async def admin_get_workflow(workflow_id: str):
    try:
        return load_workflow_document(workflow_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="workflow_not_found") from exc


@admin_router.put("/workflows/{workflow_id}")
async def admin_update_workflow(workflow_id: str, request: Request):
    body = await request.json()
    payload = body if isinstance(body, dict) else {}
    if payload.get("yaml_content"):
        yaml.safe_load(str(payload["yaml_content"]))
        path = WORKFLOWS_DIR / f"{workflow_id}.yaml"
        path.write_text(str(payload["yaml_content"]), encoding="utf-8")
        return load_workflow_document(workflow_id)
    save_workflow_document(workflow_id, payload)
    return load_workflow_document(workflow_id)


@admin_router.get("/alert-rules")
async def admin_list_alert_rules(page: int = Query(default=1, ge=1), page_size: int = Query(default=10, ge=1, le=200)):
    from alert_engine import get_alert_engine

    items = [rule.to_dict() for rule in get_alert_engine().store.list_rules("tenant_main")]
    return _paginate(items, page=page, page_size=page_size)
