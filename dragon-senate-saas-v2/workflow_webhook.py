from __future__ import annotations

import base64
import json
import secrets
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from provider_registry import _decrypt_secret, _encrypt_secret  # type: ignore[attr-defined]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    path = (Path(__file__).resolve().parent / "data" / "workflow_webhooks.sqlite").resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def generate_webhook_id() -> str:
    return "wh_" + secrets.token_urlsafe(12)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_schema() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS workflow_webhooks (
                webhook_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                http_method TEXT NOT NULL DEFAULT 'POST',
                auth_type TEXT NOT NULL DEFAULT 'none',
                auth_config_json TEXT NOT NULL DEFAULT '{}',
                response_mode TEXT NOT NULL DEFAULT 'immediate',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                last_triggered_at TEXT,
                trigger_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.commit()


def _encrypt_auth_config(config: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in (config or {}).items():
        if isinstance(value, str) and value:
            result[key] = _encrypt_secret(value)
        else:
            result[key] = value
    return result


def _decrypt_auth_config(config: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in (config or {}).items():
        if isinstance(value, str) and value:
            result[key] = _decrypt_secret(value)
        else:
            result[key] = value
    return result


@dataclass
class WorkflowWebhook:
    webhook_id: str
    workflow_id: str
    tenant_id: str
    name: str
    http_method: str = "POST"
    auth_type: str = "none"
    auth_config: dict[str, Any] | None = None
    response_mode: str = "immediate"
    is_active: bool = True
    created_at: str = _utc_now()
    last_triggered_at: str | None = None
    trigger_count: int = 0

    def to_public_dict(self, base_url: str = "") -> dict[str, Any]:
        payload = asdict(self)
        payload["auth_config"] = {
            key: ("configured" if value else "")
            for key, value in (self.auth_config or {}).items()
        }
        payload["webhook_path"] = f"/webhook/workflows/{self.webhook_id}"
        payload["webhook_url"] = (
            f"{base_url.rstrip('/')}/webhook/workflows/{self.webhook_id}"
            if base_url
            else payload["webhook_path"]
        )
        return payload


class WorkflowWebhookStore:
    def __init__(self) -> None:
        _ensure_schema()

    def list_webhooks(self, workflow_id: str, tenant_id: str) -> list[WorkflowWebhook]:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT * FROM workflow_webhooks WHERE workflow_id = ? AND tenant_id = ? ORDER BY created_at DESC",
                (workflow_id, tenant_id),
            ).fetchall()
        return [self._row_to_obj(dict(row)) for row in rows]

    def create_webhook(
        self,
        *,
        workflow_id: str,
        tenant_id: str,
        name: str,
        http_method: str,
        auth_type: str,
        auth_config: dict[str, Any],
        response_mode: str,
    ) -> WorkflowWebhook:
        webhook = WorkflowWebhook(
            webhook_id=generate_webhook_id(),
            workflow_id=workflow_id,
            tenant_id=tenant_id,
            name=name,
            http_method=http_method,
            auth_type=auth_type,
            auth_config=auth_config,
            response_mode=response_mode,
            created_at=_utc_now(),
        )
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO workflow_webhooks(
                    webhook_id, workflow_id, tenant_id, name, http_method, auth_type,
                    auth_config_json, response_mode, is_active, created_at, last_triggered_at, trigger_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    webhook.webhook_id,
                    webhook.workflow_id,
                    webhook.tenant_id,
                    webhook.name,
                    webhook.http_method,
                    webhook.auth_type,
                    json.dumps(_encrypt_auth_config(auth_config), ensure_ascii=False),
                    webhook.response_mode,
                    1 if webhook.is_active else 0,
                    webhook.created_at,
                    None,
                    0,
                ),
            )
            conn.commit()
        return webhook

    def delete_webhook(self, workflow_id: str, webhook_id: str, tenant_id: str) -> bool:
        with _connect() as conn:
            cur = conn.execute(
                "DELETE FROM workflow_webhooks WHERE workflow_id = ? AND webhook_id = ? AND tenant_id = ?",
                (workflow_id, webhook_id, tenant_id),
            )
            conn.commit()
        return bool(cur.rowcount)

    def get_active_webhook(self, webhook_id: str) -> WorkflowWebhook | None:
        with _connect() as conn:
            row = conn.execute(
                "SELECT * FROM workflow_webhooks WHERE webhook_id = ? AND is_active = 1",
                (webhook_id,),
            ).fetchone()
        return self._row_to_obj(dict(row)) if row else None

    def touch_trigger(self, webhook_id: str) -> None:
        with _connect() as conn:
            conn.execute(
                "UPDATE workflow_webhooks SET trigger_count = trigger_count + 1, last_triggered_at = ? WHERE webhook_id = ?",
                (_utc_now(), webhook_id),
            )
            conn.commit()

    def _row_to_obj(self, row: dict[str, Any]) -> WorkflowWebhook:
        auth_config = _decrypt_auth_config(json.loads(str(row.get("auth_config_json") or "{}")))
        return WorkflowWebhook(
            webhook_id=str(row["webhook_id"]),
            workflow_id=str(row["workflow_id"]),
            tenant_id=str(row["tenant_id"]),
            name=str(row["name"]),
            http_method=str(row["http_method"]),
            auth_type=str(row["auth_type"]),
            auth_config=auth_config,
            response_mode=str(row["response_mode"]),
            is_active=bool(row.get("is_active", 1)),
            created_at=str(row["created_at"]),
            last_triggered_at=row.get("last_triggered_at"),
            trigger_count=int(row.get("trigger_count") or 0),
        )


def verify_webhook_auth(webhook: WorkflowWebhook, headers: dict[str, str]) -> None:
    if webhook.auth_type == "none":
        return
    if webhook.auth_type == "header_token":
        expected = str((webhook.auth_config or {}).get("token") or "")
        actual = headers.get("x-webhook-token") or headers.get("authorization", "").removeprefix("Bearer ")
        if actual != expected:
            raise PermissionError("header_token_invalid")
        return
    if webhook.auth_type == "basic_auth":
        auth_header = headers.get("authorization", "")
        if not auth_header.startswith("Basic "):
            raise PermissionError("basic_auth_required")
        decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
        username, _, password = decoded.partition(":")
        expected_user = str((webhook.auth_config or {}).get("username") or "")
        expected_pass = str((webhook.auth_config or {}).get("password") or "")
        if username != expected_user or password != expected_pass:
            raise PermissionError("basic_auth_invalid")


_store: WorkflowWebhookStore | None = None


def get_workflow_webhook_store() -> WorkflowWebhookStore:
    global _store
    if _store is None:
        _store = WorkflowWebhookStore()
    return _store
