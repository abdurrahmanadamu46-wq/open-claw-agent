from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any


def _db_path() -> str:
    return os.getenv("OTP_RELAY_DB_PATH", "./data/otp_relay.sqlite").strip()


def _safe_slug(raw: str, *, fallback: str) -> str:
    value = (raw or "").strip().lower()
    clean = []
    for ch in value:
        if ch.isalnum() or ch in {"_", "-", ":"}:
            clean.append(ch)
    out = "".join(clean).strip("_-:")
    return out[:128] or fallback


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).isoformat()


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


def _hash_code(code: str) -> str:
    salt = os.getenv("OTP_RELAY_HASH_SALT", "dragon-otp").strip() or "dragon-otp"
    raw = f"{salt}:{code.strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _env_int(name: str, default: int, *, min_value: int | None = None, max_value: int | None = None) -> int:
    raw = os.getenv(name, "").strip()
    try:
        value = int(raw) if raw else int(default)
    except ValueError:
        value = int(default)
    if min_value is not None:
        value = max(min_value, value)
    if max_value is not None:
        value = min(max_value, value)
    return value


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
            CREATE TABLE IF NOT EXISTS otp_requests (
                request_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                edge_id TEXT NOT NULL,
                account_id TEXT,
                platform TEXT NOT NULL,
                purpose TEXT NOT NULL,
                status TEXT NOT NULL,
                masked_target TEXT,
                message TEXT,
                trace_id TEXT,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                submitted_at TEXT,
                consumed_at TEXT,
                canceled_at TEXT,
                code_hash TEXT,
                code_last4 TEXT,
                operator TEXT,
                max_attempts INTEGER NOT NULL DEFAULT 3,
                attempt_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_otp_user_status ON otp_requests(user_id, tenant_id, status, created_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_otp_edge_status ON otp_requests(edge_id, status, created_at)"
        )


def create_request(
    *,
    tenant_id: str,
    user_id: str,
    edge_id: str,
    account_id: str | None,
    platform: str,
    purpose: str,
    masked_target: str | None = None,
    message: str | None = None,
    trace_id: str | None = None,
    ttl_sec: int | None = None,
    max_attempts: int | None = None,
) -> dict[str, Any]:
    ensure_schema()
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    safe_user = _safe_slug(user_id, fallback="user")
    safe_edge = _safe_slug(edge_id, fallback="edge")
    safe_platform = _safe_slug(platform, fallback="unknown")
    safe_purpose = _safe_slug(purpose, fallback="login")
    request_id = f"otp_{uuid.uuid4().hex[:20]}"
    now = _now()
    ttl = ttl_sec if ttl_sec is not None else _env_int("OTP_RELAY_TTL_SEC", 300, min_value=60, max_value=1800)
    attempts = max_attempts if max_attempts is not None else _env_int("OTP_RELAY_MAX_ATTEMPTS", 3, min_value=1, max_value=10)
    expires = now + timedelta(seconds=ttl)
    row = {
        "request_id": request_id,
        "tenant_id": safe_tenant,
        "user_id": safe_user,
        "edge_id": safe_edge,
        "account_id": (account_id or "").strip()[:128] or None,
        "platform": safe_platform,
        "purpose": safe_purpose,
        "status": "pending",
        "masked_target": (masked_target or "").strip()[:128] or None,
        "message": (message or "").strip()[:500] or None,
        "trace_id": (trace_id or "").strip()[:128] or None,
        "created_at": _iso(now),
        "expires_at": _iso(expires),
        "updated_at": _iso(now),
        "max_attempts": attempts,
    }
    with _LOCK, _conn() as conn:
        conn.execute(
            """
            INSERT INTO otp_requests(
                request_id, tenant_id, user_id, edge_id, account_id, platform, purpose, status,
                masked_target, message, trace_id, created_at, expires_at, updated_at, max_attempts, attempt_count
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (
                row["request_id"],
                row["tenant_id"],
                row["user_id"],
                row["edge_id"],
                row["account_id"],
                row["platform"],
                row["purpose"],
                row["status"],
                row["masked_target"],
                row["message"],
                row["trace_id"],
                row["created_at"],
                row["expires_at"],
                row["updated_at"],
                row["max_attempts"],
            ),
        )
    return row


def get_request(request_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with _LOCK, _conn() as conn:
        row = conn.execute("SELECT * FROM otp_requests WHERE request_id = ?", (request_id,)).fetchone()
        return dict(row) if row is not None else None


def _is_expired(row: dict[str, Any]) -> bool:
    expires = _parse_iso(str(row.get("expires_at") or ""))
    if expires is None:
        return True
    return _now() > expires


def list_requests(
    *,
    user_id: str,
    tenant_id: str,
    status_filter: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    ensure_schema()
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    safe_limit = max(1, min(int(limit), 300))
    params: list[Any] = [safe_user, safe_tenant]
    where = ["user_id = ?", "tenant_id = ?"]
    if status_filter:
        where.append("status = ?")
        params.append(_safe_slug(status_filter, fallback="pending"))
    sql = f"""
        SELECT * FROM otp_requests
        WHERE {" AND ".join(where)}
        ORDER BY created_at DESC
        LIMIT ?
    """
    params.append(safe_limit)
    with _LOCK, _conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
        data = [dict(row) for row in rows]
    for row in data:
        if row.get("status") == "pending" and _is_expired(row):
            row["status"] = "expired"
    return data


def submit_code(
    *,
    request_id: str,
    user_id: str,
    tenant_id: str,
    code: str,
    operator: str | None = None,
    allow_admin_cross_user: bool = False,
) -> dict[str, Any]:
    ensure_schema()
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    clean_code = (code or "").strip()
    if len(clean_code) < 4:
        return {"ok": False, "code": "invalid_code", "message": "楠岃瘉鐮佹牸寮忎笉姝ｇ‘"}

    with _LOCK, _conn() as conn:
        row_raw = conn.execute("SELECT * FROM otp_requests WHERE request_id = ?", (request_id,)).fetchone()
        if row_raw is None:
            return {"ok": False, "code": "not_found", "message": "楠岃瘉鐮佽姹備笉瀛樺湪"}
        row = dict(row_raw)
        if row.get("status") not in {"pending", "submitted"}:
            return {"ok": False, "code": "invalid_status", "message": f"褰撳墠鐘舵€佷笉鍏佽鎻愪氦: {row.get('status')}"}
        if _is_expired(row):
            conn.execute(
                "UPDATE otp_requests SET status = 'expired', updated_at = ? WHERE request_id = ?",
                (_iso(), request_id),
            )
            return {"ok": False, "code": "expired", "message": "楠岃瘉鐮佽姹傚凡杩囨湡"}
        owner_mismatch = row.get("user_id") != safe_user or row.get("tenant_id") != safe_tenant
        if owner_mismatch and not allow_admin_cross_user:
            return {"ok": False, "code": "forbidden", "message": "鏃犳潈鎻愪氦姝ら獙璇佺爜"}

        attempt_count = int(row.get("attempt_count") or 0) + 1
        max_attempts = int(row.get("max_attempts") or 3)
        if attempt_count > max_attempts:
            conn.execute(
                """
                UPDATE otp_requests
                SET status = 'canceled', attempt_count = ?, updated_at = ?, canceled_at = ?
                WHERE request_id = ?
                """,
                (attempt_count, _iso(), _iso(), request_id),
            )
            return {"ok": False, "code": "too_many_attempts", "message": "验证码提交次数超限"}

        now = _iso()
        conn.execute(
            """
            UPDATE otp_requests
            SET status = 'submitted',
                code_hash = ?,
                code_last4 = ?,
                operator = ?,
                attempt_count = ?,
                submitted_at = ?,
                updated_at = ?
            WHERE request_id = ?
            """,
            (
                _hash_code(clean_code),
                clean_code[-4:],
                (operator or safe_user)[:128],
                attempt_count,
                now,
                now,
                request_id,
            ),
        )
        updated = conn.execute("SELECT * FROM otp_requests WHERE request_id = ?", (request_id,)).fetchone()
        assert updated is not None
        row_out = dict(updated)
        return {
            "ok": True,
            "code": "submitted",
            "message": "楠岃瘉鐮佸凡鎻愪氦骞跺緟杈圭紭鑺傜偣娑堣垂",
            "request": row_out,
            "otp_plain": clean_code,
        }


def mark_consumed(
    *,
    request_id: str,
    edge_id: str,
    status: str = "consumed",
    reason: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    safe_edge = _safe_slug(edge_id, fallback="edge")
    safe_status = _safe_slug(status, fallback="consumed")
    if safe_status not in {"consumed", "failed", "canceled"}:
        safe_status = "consumed"
    with _LOCK, _conn() as conn:
        row_raw = conn.execute("SELECT * FROM otp_requests WHERE request_id = ?", (request_id,)).fetchone()
        if row_raw is None:
            return {"ok": False, "code": "not_found", "message": "楠岃瘉鐮佽姹備笉瀛樺湪"}
        row = dict(row_raw)
        if row.get("edge_id") != safe_edge:
            return {"ok": False, "code": "edge_mismatch", "message": "边缘节点不匹配"}
        now = _iso()
        if safe_status == "canceled":
            conn.execute(
                """
                UPDATE otp_requests
                SET status = 'canceled', canceled_at = ?, updated_at = ?, message = COALESCE(message, ?) || ?
                WHERE request_id = ?
                """,
                (now, now, "", f"\n[consume-note]{(reason or '').strip()[:120]}", request_id),
            )
        elif safe_status == "failed":
            conn.execute(
                """
                UPDATE otp_requests
                SET status = 'failed', consumed_at = ?, updated_at = ?, message = COALESCE(message, ?) || ?
                WHERE request_id = ?
                """,
                (now, now, "", f"\n[consume-note]{(reason or '').strip()[:120]}", request_id),
            )
        else:
            conn.execute(
                """
                UPDATE otp_requests
                SET status = 'consumed', consumed_at = ?, updated_at = ?
                WHERE request_id = ?
                """,
                (now, now, request_id),
            )
        updated = conn.execute("SELECT * FROM otp_requests WHERE request_id = ?", (request_id,)).fetchone()
        assert updated is not None
        return {"ok": True, "code": "updated", "request": dict(updated)}


def cancel_request(
    *,
    request_id: str,
    user_id: str,
    tenant_id: str,
    operator: str | None = None,
    allow_admin_cross_user: bool = False,
) -> dict[str, Any]:
    ensure_schema()
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    with _LOCK, _conn() as conn:
        row_raw = conn.execute("SELECT * FROM otp_requests WHERE request_id = ?", (request_id,)).fetchone()
        if row_raw is None:
            return {"ok": False, "code": "not_found", "message": "楠岃瘉鐮佽姹備笉瀛樺湪"}
        row = dict(row_raw)
        owner_mismatch = row.get("user_id") != safe_user or row.get("tenant_id") != safe_tenant
        if owner_mismatch and not allow_admin_cross_user:
            return {"ok": False, "code": "forbidden", "message": "鏃犳潈鍙栨秷姝ら獙璇佺爜璇锋眰"}
        if row.get("status") in {"consumed", "canceled", "failed", "expired"}:
            return {"ok": False, "code": "already_finalized", "message": f"褰撳墠鐘舵€佷笉鍙彇娑? {row.get('status')}"}
        now = _iso()
        conn.execute(
            """
            UPDATE otp_requests
            SET status = 'canceled', canceled_at = ?, updated_at = ?, operator = ?
            WHERE request_id = ?
            """,
            (now, now, (operator or safe_user)[:128], request_id),
        )
        updated = conn.execute("SELECT * FROM otp_requests WHERE request_id = ?", (request_id,)).fetchone()
        assert updated is not None
        return {"ok": True, "code": "canceled", "request": dict(updated)}

