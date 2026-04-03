from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any


def _db_path() -> str:
    return os.getenv("EDGE_REWARDS_DB_PATH", "./data/edge_rewards.sqlite").strip()


def _safe_slug(raw: str, *, fallback: str) -> str:
    value = (raw or "").strip().lower()
    clean = []
    for ch in value:
        if ch.isalnum() or ch in {"_", "-"}:
            clean.append(ch)
    out = "".join(clean).strip("_-")
    return out[:128] or fallback


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
            CREATE TABLE IF NOT EXISTS edge_reward_wallets (
                user_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                points_balance INTEGER NOT NULL DEFAULT 0,
                points_earned_total INTEGER NOT NULL DEFAULT 0,
                online_seconds_total INTEGER NOT NULL DEFAULT 0,
                free_run_credit INTEGER NOT NULL DEFAULT 0,
                free_token_credit INTEGER NOT NULL DEFAULT 0,
                last_claim_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, tenant_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS edge_reward_edges (
                edge_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                account_id TEXT,
                status TEXT NOT NULL DEFAULT 'online',
                ip_hash TEXT,
                cpu_percent REAL NOT NULL DEFAULT 0,
                memory_percent REAL NOT NULL DEFAULT 0,
                last_heartbeat_at TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS edge_reward_claims (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                claim_type TEXT NOT NULL,
                points_cost INTEGER NOT NULL DEFAULT 0,
                free_run_credit INTEGER NOT NULL DEFAULT 0,
                free_token_credit INTEGER NOT NULL DEFAULT 0,
                note TEXT,
                created_at TEXT NOT NULL
            )
            """
        )


def _parse_iso(ts: str | None) -> datetime | None:
    text = (ts or "").strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _wallet_row(conn: sqlite3.Connection, *, user_id: str, tenant_id: str) -> sqlite3.Row:
    now = _utc_now_iso()
    row = conn.execute(
        """
        SELECT * FROM edge_reward_wallets
        WHERE user_id = ? AND tenant_id = ?
        """,
        (user_id, tenant_id),
    ).fetchone()
    if row is not None:
        return row
    conn.execute(
        """
        INSERT INTO edge_reward_wallets(
            user_id, tenant_id, points_balance, points_earned_total,
            online_seconds_total, free_run_credit, free_token_credit,
            created_at, updated_at
        )
        VALUES (?, ?, 0, 0, 0, 0, 0, ?, ?)
        """,
        (user_id, tenant_id, now, now),
    )
    row = conn.execute(
        "SELECT * FROM edge_reward_wallets WHERE user_id = ? AND tenant_id = ?",
        (user_id, tenant_id),
    ).fetchone()
    assert row is not None
    return row


def wallet_snapshot(*, user_id: str, tenant_id: str) -> dict[str, Any]:
    ensure_schema()
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    with _LOCK, _conn() as conn:
        row = _wallet_row(conn, user_id=safe_user, tenant_id=safe_tenant)
        return dict(row)


def _upsert_edge_state(
    conn: sqlite3.Connection,
    *,
    edge_id: str,
    user_id: str,
    tenant_id: str,
    account_id: str | None,
    status: str,
    ip_hash: str | None,
    cpu_percent: float,
    memory_percent: float,
    heartbeat_at: str,
) -> sqlite3.Row:
    existing = conn.execute(
        "SELECT * FROM edge_reward_edges WHERE edge_id = ?",
        (edge_id,),
    ).fetchone()
    if existing is None:
        conn.execute(
            """
            INSERT INTO edge_reward_edges(
                edge_id, user_id, tenant_id, account_id, status, ip_hash,
                cpu_percent, memory_percent, last_heartbeat_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                edge_id,
                user_id,
                tenant_id,
                account_id,
                status,
                ip_hash,
                cpu_percent,
                memory_percent,
                heartbeat_at,
                heartbeat_at,
            ),
        )
    else:
        conn.execute(
            """
            UPDATE edge_reward_edges
            SET user_id = ?, tenant_id = ?, account_id = ?, status = ?, ip_hash = ?,
                cpu_percent = ?, memory_percent = ?, last_heartbeat_at = ?, updated_at = ?
            WHERE edge_id = ?
            """,
            (
                user_id,
                tenant_id,
                account_id,
                status,
                ip_hash,
                cpu_percent,
                memory_percent,
                heartbeat_at,
                heartbeat_at,
                edge_id,
            ),
        )
    row = conn.execute("SELECT * FROM edge_reward_edges WHERE edge_id = ?", (edge_id,)).fetchone()
    assert row is not None
    return row


def report_heartbeat(
    *,
    edge_id: str,
    user_id: str,
    tenant_id: str,
    account_id: str | None = None,
    status: str = "online",
    ip_hash: str | None = None,
    cpu_percent: float = 0.0,
    memory_percent: float = 0.0,
) -> dict[str, Any]:
    ensure_schema()
    safe_edge = _safe_slug(edge_id, fallback="edge")
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    safe_status = _safe_slug(status, fallback="online")
    safe_account = (account_id or "").strip()[:128] or None
    safe_ip_hash = (ip_hash or "").strip()[:256] or None
    now_iso = _utc_now_iso()
    now_dt = _parse_iso(now_iso) or datetime.now(timezone.utc)
    max_gap = _env_int("EDGE_REWARD_MAX_HEARTBEAT_GAP_SEC", 600, min_value=60, max_value=3600)
    points_per_hour = _env_int("EDGE_REWARD_POINTS_PER_HOUR", 60, min_value=1, max_value=10000)

    with _LOCK, _conn() as conn:
        prev = conn.execute("SELECT * FROM edge_reward_edges WHERE edge_id = ?", (safe_edge,)).fetchone()
        prev_dt = _parse_iso(str(prev["last_heartbeat_at"])) if prev is not None else None
        delta_sec = 0
        if prev_dt is not None:
            delta_sec = int((now_dt - prev_dt).total_seconds())
            if delta_sec < 0:
                delta_sec = 0
            delta_sec = min(delta_sec, max_gap)
        wallet = _wallet_row(conn, user_id=safe_user, tenant_id=safe_tenant)
        points_gain = int((delta_sec * points_per_hour) / 3600)
        if points_gain < 0:
            points_gain = 0
        conn.execute(
            """
            UPDATE edge_reward_wallets
            SET points_balance = points_balance + ?,
                points_earned_total = points_earned_total + ?,
                online_seconds_total = online_seconds_total + ?,
                updated_at = ?
            WHERE user_id = ? AND tenant_id = ?
            """,
            (points_gain, points_gain, delta_sec, now_iso, safe_user, safe_tenant),
        )
        wallet_after = _wallet_row(conn, user_id=safe_user, tenant_id=safe_tenant)
        edge_row = _upsert_edge_state(
            conn,
            edge_id=safe_edge,
            user_id=safe_user,
            tenant_id=safe_tenant,
            account_id=safe_account,
            status=safe_status,
            ip_hash=safe_ip_hash,
            cpu_percent=float(cpu_percent or 0.0),
            memory_percent=float(memory_percent or 0.0),
            heartbeat_at=now_iso,
        )
        return {
            "edge": dict(edge_row),
            "wallet_before": dict(wallet),
            "wallet_after": dict(wallet_after),
            "delta_online_seconds": delta_sec,
            "points_gain": points_gain,
        }


def claim_free_pack(
    *,
    user_id: str,
    tenant_id: str,
    claim_type: str = "free_pack",
    note: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    safe_claim = _safe_slug(claim_type, fallback="free_pack")
    points_cost = _env_int("EDGE_REWARD_FREE_PACK_POINTS_COST", 180, min_value=1, max_value=100000)
    token_credit = _env_int("EDGE_REWARD_FREE_PACK_TOKEN_CREDIT", 80000, min_value=1, max_value=10_000_000)
    run_credit = _env_int("EDGE_REWARD_FREE_PACK_RUN_CREDIT", 20, min_value=1, max_value=10000)
    max_claim_per_day = _env_int("EDGE_REWARD_FREE_PACK_MAX_PER_DAY", 2, min_value=1, max_value=50)

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    since_iso = (now - timedelta(days=1)).isoformat()
    with _LOCK, _conn() as conn:
        wallet = _wallet_row(conn, user_id=safe_user, tenant_id=safe_tenant)
        count_row = conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM edge_reward_claims
            WHERE user_id = ? AND tenant_id = ? AND claim_type = ? AND created_at >= ?
            """,
            (safe_user, safe_tenant, safe_claim, since_iso),
        ).fetchone()
        claim_count_24h = int((count_row or {"c": 0})["c"] or 0)
        points_balance = int(wallet["points_balance"] or 0)
        if claim_count_24h >= max_claim_per_day:
            return {
                "ok": False,
                "code": "daily_claim_limit_reached",
                "message": "浠婃棩鍏戞崲娆℃暟宸茶揪涓婇檺",
                "wallet": dict(wallet),
                "claim_count_24h": claim_count_24h,
            }
        if points_balance < points_cost:
            return {
                "ok": False,
                "code": "insufficient_points",
                "message": "铏剧伯绉垎涓嶈冻",
                "wallet": dict(wallet),
                "required_points": points_cost,
            }

        conn.execute(
            """
            UPDATE edge_reward_wallets
            SET points_balance = points_balance - ?,
                free_run_credit = free_run_credit + ?,
                free_token_credit = free_token_credit + ?,
                last_claim_at = ?,
                updated_at = ?
            WHERE user_id = ? AND tenant_id = ?
            """,
            (points_cost, run_credit, token_credit, now_iso, now_iso, safe_user, safe_tenant),
        )
        conn.execute(
            """
            INSERT INTO edge_reward_claims(
                user_id, tenant_id, claim_type, points_cost, free_run_credit, free_token_credit, note, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                safe_user,
                safe_tenant,
                safe_claim,
                points_cost,
                run_credit,
                token_credit,
                (note or "").strip()[:200] or None,
                now_iso,
            ),
        )
        wallet_after = _wallet_row(conn, user_id=safe_user, tenant_id=safe_tenant)
        return {
            "ok": True,
            "code": "claimed",
            "message": "鍏戞崲鎴愬姛锛屽厤璐归搴﹀凡鍒拌处",
            "claim": {
                "claim_type": safe_claim,
                "points_cost": points_cost,
                "free_run_credit": run_credit,
                "free_token_credit": token_credit,
                "created_at": now_iso,
            },
            "wallet": dict(wallet_after),
            "claim_count_24h": claim_count_24h + 1,
        }


def consume_free_credits(
    *,
    user_id: str,
    tenant_id: str,
    estimated_runs: int = 0,
    estimated_tokens: int = 0,
    note: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    need_runs = max(0, int(estimated_runs))
    need_tokens = max(0, int(estimated_tokens))
    with _LOCK, _conn() as conn:
        wallet = _wallet_row(conn, user_id=safe_user, tenant_id=safe_tenant)
        runs_balance = int(wallet["free_run_credit"] or 0)
        tokens_balance = int(wallet["free_token_credit"] or 0)
        if runs_balance < need_runs or tokens_balance < need_tokens:
            return {
                "ok": False,
                "code": "insufficient_free_credits",
                "wallet": dict(wallet),
                "required": {"runs": need_runs, "tokens": need_tokens},
            }
        now_iso = _utc_now_iso()
        conn.execute(
            """
            UPDATE edge_reward_wallets
            SET free_run_credit = free_run_credit - ?,
                free_token_credit = free_token_credit - ?,
                updated_at = ?
            WHERE user_id = ? AND tenant_id = ?
            """,
            (need_runs, need_tokens, now_iso, safe_user, safe_tenant),
        )
        wallet_after = _wallet_row(conn, user_id=safe_user, tenant_id=safe_tenant)
        if need_runs > 0 or need_tokens > 0:
            conn.execute(
                """
                INSERT INTO edge_reward_claims(
                    user_id, tenant_id, claim_type, points_cost, free_run_credit, free_token_credit, note, created_at
                )
                VALUES (?, ?, 'free_credit_consume', 0, ?, ?, ?, ?)
                """,
                (
                    safe_user,
                    safe_tenant,
                    -need_runs,
                    -need_tokens,
                    (note or "").strip()[:200] or "billing_guard_fallback",
                    now_iso,
                ),
            )
        return {
            "ok": True,
            "code": "consumed",
            "consumed": {"runs": need_runs, "tokens": need_tokens},
            "wallet": dict(wallet_after),
        }


def list_claims(
    *,
    user_id: str,
    tenant_id: str,
    limit: int = 50,
) -> list[dict[str, Any]]:
    ensure_schema()
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    safe_limit = max(1, min(int(limit), 500))
    with _LOCK, _conn() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM edge_reward_claims
            WHERE user_id = ? AND tenant_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (safe_user, safe_tenant, safe_limit),
        ).fetchall()
        return [dict(row) for row in rows]

