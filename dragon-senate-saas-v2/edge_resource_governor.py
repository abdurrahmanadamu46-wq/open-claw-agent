from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any


def _db_path() -> str:
    return os.getenv("EDGE_RESOURCE_DB_PATH", "./data/edge_resource_governor.sqlite").strip()


def _safe_slug(raw: str, *, fallback: str) -> str:
    value = (raw or "").strip().lower()
    clean: list[str] = []
    for ch in value:
        if ch.isalnum() or ch in {"_", "-", ":"}:
            clean.append(ch)
    out = "".join(clean).strip("_-:")
    return out[:128] or fallback


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(raw: str | None) -> datetime | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


_LOCK = threading.RLock()


def _ensure_parent(path: str) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)


@contextmanager
def _conn() -> sqlite3.Connection:
    path = _db_path()
    _ensure_parent(path)
    conn = sqlite3.connect(path, timeout=15, isolation_level=None)
    try:
        conn.row_factory = sqlite3.Row
        yield conn
    finally:
        conn.close()


def ensure_schema() -> None:
    with _LOCK, _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS edge_consent_records (
                edge_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                consent_version TEXT NOT NULL,
                ip_share_enabled INTEGER NOT NULL DEFAULT 0,
                compute_share_enabled INTEGER NOT NULL DEFAULT 0,
                otp_relay_enabled INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL,
                accepted_at TEXT,
                revoked_at TEXT,
                operator TEXT,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_edge_consent_user_tenant ON edge_consent_records(user_id, tenant_id, status, updated_at)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS edge_resource_lease_logs (
                lease_id TEXT PRIMARY KEY,
                edge_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                purpose_code TEXT NOT NULL,
                requester TEXT,
                approved_by TEXT,
                trace_id TEXT,
                task_id TEXT,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                duration_sec INTEGER NOT NULL DEFAULT 0,
                reason TEXT,
                metadata_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_edge_lease_edge_time ON edge_resource_lease_logs(edge_id, started_at DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_edge_lease_user_time ON edge_resource_lease_logs(user_id, tenant_id, started_at DESC)"
        )


def _coerce_bool(raw: Any, default: bool = False) -> bool:
    if isinstance(raw, bool):
        return raw
    if raw is None:
        return default
    text = str(raw).strip().lower()
    return text in {"1", "true", "yes", "on"}


def _upsert_row(conn: sqlite3.Connection, row: dict[str, Any]) -> dict[str, Any]:
    conn.execute(
        """
        INSERT INTO edge_consent_records(
            edge_id, user_id, tenant_id, consent_version,
            ip_share_enabled, compute_share_enabled, otp_relay_enabled,
            status, accepted_at, revoked_at, operator, notes, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(edge_id) DO UPDATE SET
            user_id=excluded.user_id,
            tenant_id=excluded.tenant_id,
            consent_version=excluded.consent_version,
            ip_share_enabled=excluded.ip_share_enabled,
            compute_share_enabled=excluded.compute_share_enabled,
            otp_relay_enabled=excluded.otp_relay_enabled,
            status=excluded.status,
            accepted_at=excluded.accepted_at,
            revoked_at=excluded.revoked_at,
            operator=excluded.operator,
            notes=excluded.notes,
            updated_at=excluded.updated_at
        """,
        (
            row["edge_id"],
            row["user_id"],
            row["tenant_id"],
            row["consent_version"],
            row["ip_share_enabled"],
            row["compute_share_enabled"],
            row["otp_relay_enabled"],
            row["status"],
            row["accepted_at"],
            row["revoked_at"],
            row["operator"],
            row["notes"],
            row["created_at"],
            row["updated_at"],
        ),
    )
    db_row = conn.execute("SELECT * FROM edge_consent_records WHERE edge_id = ?", (row["edge_id"],)).fetchone()
    assert db_row is not None
    return dict(db_row)


def upsert_consent(
    *,
    edge_id: str,
    user_id: str,
    tenant_id: str,
    consent_version: str = "v1",
    ip_share_enabled: bool = False,
    compute_share_enabled: bool = False,
    otp_relay_enabled: bool = True,
    accepted: bool = False,
    operator: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    safe_edge = _safe_slug(edge_id, fallback="edge")
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    safe_version = str(consent_version or "v1").strip()[:32] or "v1"
    now = _utc_now_iso()
    accepted_at = now if accepted else None
    status = "active" if accepted else "pending"

    with _LOCK, _conn() as conn:
        existing = conn.execute("SELECT * FROM edge_consent_records WHERE edge_id = ?", (safe_edge,)).fetchone()
        created_at = str(existing["created_at"]) if existing is not None else now
        row = {
            "edge_id": safe_edge,
            "user_id": safe_user,
            "tenant_id": safe_tenant,
            "consent_version": safe_version,
            "ip_share_enabled": 1 if _coerce_bool(ip_share_enabled) else 0,
            "compute_share_enabled": 1 if _coerce_bool(compute_share_enabled) else 0,
            "otp_relay_enabled": 1 if _coerce_bool(otp_relay_enabled, True) else 0,
            "status": status,
            "accepted_at": accepted_at or (str(existing["accepted_at"]) if existing is not None else None),
            "revoked_at": None if accepted else (str(existing["revoked_at"]) if existing is not None else None),
            "operator": (operator or "").strip()[:128] or None,
            "notes": (notes or "").strip()[:500] or None,
            "created_at": created_at,
            "updated_at": now,
        }
        return _upsert_row(conn, row)


def get_consent(edge_id: str) -> dict[str, Any] | None:
    ensure_schema()
    safe_edge = _safe_slug(edge_id, fallback="edge")
    with _LOCK, _conn() as conn:
        row = conn.execute("SELECT * FROM edge_consent_records WHERE edge_id = ?", (safe_edge,)).fetchone()
        return dict(row) if row is not None else None


def revoke_consent(
    *,
    edge_id: str,
    operator: str | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    safe_edge = _safe_slug(edge_id, fallback="edge")
    now = _utc_now_iso()
    with _LOCK, _conn() as conn:
        row = conn.execute("SELECT * FROM edge_consent_records WHERE edge_id = ?", (safe_edge,)).fetchone()
        if row is None:
            return {"ok": False, "code": "not_found", "message": "consent record not found"}
        conn.execute(
            """
            UPDATE edge_consent_records
            SET status = 'revoked',
                revoked_at = ?,
                updated_at = ?,
                operator = ?,
                notes = ?
            WHERE edge_id = ?
            """,
            (now, now, (operator or "").strip()[:128] or None, (reason or "").strip()[:500] or None, safe_edge),
        )
        updated = conn.execute("SELECT * FROM edge_consent_records WHERE edge_id = ?", (safe_edge,)).fetchone()
        return {"ok": True, "consent": dict(updated) if updated is not None else None}


def can_use_resource(edge_id: str, resource_type: str) -> tuple[bool, str, dict[str, Any] | None]:
    safe_edge = _safe_slug(edge_id, fallback="edge")
    safe_type = _safe_slug(resource_type, fallback="unknown")
    consent = get_consent(safe_edge)
    if consent is None:
        return False, "consent_not_found", None
    if str(consent.get("status") or "").strip().lower() != "active":
        return False, "consent_not_active", consent
    if safe_type == "ip_proxy" and int(consent.get("ip_share_enabled") or 0) != 1:
        return False, "ip_share_disabled", consent
    if safe_type == "compute" and int(consent.get("compute_share_enabled") or 0) != 1:
        return False, "compute_share_disabled", consent
    return True, "ok", consent


def start_lease(
    *,
    edge_id: str,
    user_id: str,
    tenant_id: str,
    resource_type: str,
    purpose_code: str,
    requester: str | None = None,
    approved_by: str | None = None,
    trace_id: str | None = None,
    task_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_schema()
    safe_edge = _safe_slug(edge_id, fallback="edge")
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    safe_type = _safe_slug(resource_type, fallback="unknown")
    safe_purpose = _safe_slug(purpose_code, fallback="generic")
    ok, reason, consent = can_use_resource(safe_edge, safe_type)
    now = _utc_now_iso()
    lease_id = f"lease_{uuid.uuid4().hex[:24]}"
    payload = {
        "lease_id": lease_id,
        "edge_id": safe_edge,
        "user_id": safe_user,
        "tenant_id": safe_tenant,
        "resource_type": safe_type,
        "purpose_code": safe_purpose,
        "requester": (requester or "").strip()[:128] or None,
        "approved_by": (approved_by or "").strip()[:128] or None,
        "trace_id": (trace_id or "").strip()[:128] or None,
        "task_id": (task_id or "").strip()[:128] or None,
        "status": "started" if ok else "denied",
        "started_at": now,
        "ended_at": now if not ok else None,
        "duration_sec": 0,
        "reason": None if ok else reason,
        "metadata_json": json.dumps(metadata or {}, ensure_ascii=False),
        "created_at": now,
        "updated_at": now,
    }
    with _LOCK, _conn() as conn:
        conn.execute(
            """
            INSERT INTO edge_resource_lease_logs(
                lease_id, edge_id, user_id, tenant_id, resource_type, purpose_code,
                requester, approved_by, trace_id, task_id, status, started_at, ended_at,
                duration_sec, reason, metadata_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["lease_id"],
                payload["edge_id"],
                payload["user_id"],
                payload["tenant_id"],
                payload["resource_type"],
                payload["purpose_code"],
                payload["requester"],
                payload["approved_by"],
                payload["trace_id"],
                payload["task_id"],
                payload["status"],
                payload["started_at"],
                payload["ended_at"],
                payload["duration_sec"],
                payload["reason"],
                payload["metadata_json"],
                payload["created_at"],
                payload["updated_at"],
            ),
        )
    return {"ok": ok, "reason": reason, "lease": payload, "consent": consent}


def end_lease(
    *,
    lease_id: str,
    status: str = "ended",
    reason: str | None = None,
    operator: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    safe_lease = str(lease_id or "").strip()[:64]
    safe_status = _safe_slug(status, fallback="ended")
    now = _utc_now_iso()
    with _LOCK, _conn() as conn:
        row = conn.execute("SELECT * FROM edge_resource_lease_logs WHERE lease_id = ?", (safe_lease,)).fetchone()
        if row is None:
            return {"ok": False, "code": "not_found", "message": "lease not found"}
        if str(row["status"]) in {"ended", "denied"}:
            return {"ok": True, "already_closed": True, "lease": dict(row)}
        started = _parse_iso(str(row["started_at"]))
        ended = _parse_iso(now) or datetime.now(timezone.utc)
        duration_sec = 0
        if started is not None:
            duration_sec = max(0, int((ended - started).total_seconds()))
        meta = {}
        try:
            meta = json.loads(str(row["metadata_json"] or "{}"))
        except json.JSONDecodeError:
            meta = {}
        if operator:
            meta["operator"] = operator
        conn.execute(
            """
            UPDATE edge_resource_lease_logs
            SET status = ?, ended_at = ?, duration_sec = ?, reason = ?, metadata_json = ?, updated_at = ?
            WHERE lease_id = ?
            """,
            (
                safe_status,
                now,
                duration_sec,
                (reason or "").strip()[:300] or None,
                json.dumps(meta, ensure_ascii=False),
                now,
                safe_lease,
            ),
        )
        updated = conn.execute("SELECT * FROM edge_resource_lease_logs WHERE lease_id = ?", (safe_lease,)).fetchone()
        return {"ok": True, "lease": dict(updated) if updated is not None else None}


def list_leases(
    *,
    tenant_id: str,
    user_id: str | None = None,
    edge_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    ensure_schema()
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    safe_limit = max(1, min(int(limit), 500))
    where = ["tenant_id = ?"]
    params: list[Any] = [safe_tenant]
    if user_id:
        where.append("user_id = ?")
        params.append(_safe_slug(user_id, fallback="user"))
    if edge_id:
        where.append("edge_id = ?")
        params.append(_safe_slug(edge_id, fallback="edge"))
    params.append(safe_limit)
    sql = f"""
        SELECT * FROM edge_resource_lease_logs
        WHERE {" AND ".join(where)}
        ORDER BY started_at DESC
        LIMIT ?
    """
    with _LOCK, _conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(row) for row in rows]


def summary(
    *,
    tenant_id: str,
    user_id: str,
) -> dict[str, Any]:
    ensure_schema()
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    safe_user = _safe_slug(user_id, fallback="user")
    with _LOCK, _conn() as conn:
        consent_rows = conn.execute(
            "SELECT * FROM edge_consent_records WHERE tenant_id = ? AND user_id = ?",
            (safe_tenant, safe_user),
        ).fetchall()
        lease_rows = conn.execute(
            "SELECT * FROM edge_resource_lease_logs WHERE tenant_id = ? AND user_id = ? ORDER BY started_at DESC LIMIT 500",
            (safe_tenant, safe_user),
        ).fetchall()
    active_nodes = sum(1 for row in consent_rows if str(row["status"]) == "active")
    revoked_nodes = sum(1 for row in consent_rows if str(row["status"]) == "revoked")
    lease_total = len(lease_rows)
    denied_total = sum(1 for row in lease_rows if str(row["status"]) == "denied")
    ended_total = sum(1 for row in lease_rows if str(row["status"]) == "ended")
    ip_lease_total = sum(1 for row in lease_rows if str(row["resource_type"]) == "ip_proxy")
    compute_lease_total = sum(1 for row in lease_rows if str(row["resource_type"]) == "compute")
    duration_total = sum(int(row["duration_sec"] or 0) for row in lease_rows)
    return {
        "tenant_id": safe_tenant,
        "user_id": safe_user,
        "consent_total": len(consent_rows),
        "active_nodes": active_nodes,
        "revoked_nodes": revoked_nodes,
        "lease_total": lease_total,
        "lease_ended_total": ended_total,
        "lease_denied_total": denied_total,
        "lease_ip_total": ip_lease_total,
        "lease_compute_total": compute_lease_total,
        "lease_duration_sec_total": duration_total,
        "average_lease_duration_sec": int(duration_total / ended_total) if ended_total > 0 else 0,
    }
