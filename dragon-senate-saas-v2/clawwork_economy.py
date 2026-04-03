from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any


def _db_path() -> str:
    return os.getenv("CLAWWORK_DB_PATH", "./data/clawwork_economy.sqlite").strip()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


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
            CREATE TABLE IF NOT EXISTS clawwork_wallets (
                user_id TEXT PRIMARY KEY,
                balance_cny REAL NOT NULL DEFAULT 0.0,
                earned_cny REAL NOT NULL DEFAULT 0.0,
                spent_cny REAL NOT NULL DEFAULT 0.0,
                runs INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS clawwork_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                user_id TEXT NOT NULL,
                route TEXT NOT NULL,
                prompt_tokens INTEGER NOT NULL DEFAULT 0,
                completion_tokens INTEGER NOT NULL DEFAULT 0,
                earned_cny REAL NOT NULL DEFAULT 0.0,
                spent_cny REAL NOT NULL DEFAULT 0.0,
                success INTEGER NOT NULL DEFAULT 1,
                note TEXT
            )
            """
        )


def _get_or_create_wallet(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    now = datetime.now(timezone.utc).isoformat()
    row = conn.execute("SELECT * FROM clawwork_wallets WHERE user_id = ?", (user_id,)).fetchone()
    if row is not None:
        return row
    init_balance = float(os.getenv("CLAWWORK_INITIAL_BALANCE_CNY", "5.0"))
    conn.execute(
        """
        INSERT INTO clawwork_wallets(user_id, balance_cny, earned_cny, spent_cny, runs, updated_at)
        VALUES (?, ?, 0.0, 0.0, 0, ?)
        """,
        (user_id, init_balance, now),
    )
    row = conn.execute("SELECT * FROM clawwork_wallets WHERE user_id = ?", (user_id,)).fetchone()
    assert row is not None
    return row


def wallet_snapshot(user_id: str) -> dict[str, Any]:
    ensure_schema()
    with _LOCK, _conn() as conn:
        row = _get_or_create_wallet(conn, user_id)
        return dict(row)


def can_use_cloud(user_id: str, estimated_cost_cny: float) -> tuple[bool, dict[str, Any]]:
    if not _env_bool("CLAWWORK_ECONOMY_ENABLED", False):
        return True, {"reason": "economy_disabled", "balance_cny": None}
    ensure_schema()
    min_balance = float(os.getenv("CLAWWORK_MIN_BALANCE_CNY", "0.5"))
    with _LOCK, _conn() as conn:
        row = _get_or_create_wallet(conn, user_id)
        balance = float(row["balance_cny"])
        allowed = (balance - estimated_cost_cny) >= min_balance
        return allowed, {
            "reason": "ok" if allowed else "insufficient_balance",
            "balance_cny": round(balance, 6),
            "estimated_cost_cny": round(float(estimated_cost_cny), 6),
            "min_balance_cny": round(min_balance, 6),
        }


def settle_usage(
    *,
    user_id: str,
    route: str,
    prompt_tokens: int,
    completion_tokens: int,
    success: bool,
    cloud_input_price_per_mtok: float,
    cloud_output_price_per_mtok: float,
) -> dict[str, Any]:
    ensure_schema()
    reward_per_success = float(os.getenv("CLAWWORK_REWARD_PER_SUCCESS_CNY", "0.03"))
    local_cost_per_mtok = float(os.getenv("CLAWWORK_LOCAL_COST_PER_MTOK_CNY", "0.02"))
    route_norm = str(route or "local").lower()

    if route_norm == "cloud":
        spent = (
            (max(0, int(prompt_tokens)) / 1_000_000) * max(0.0, cloud_input_price_per_mtok)
            + (max(0, int(completion_tokens)) / 1_000_000) * max(0.0, cloud_output_price_per_mtok)
        )
    else:
        spent = (
            (max(0, int(prompt_tokens + completion_tokens)) / 1_000_000)
            * max(0.0, local_cost_per_mtok)
        )
    earned = reward_per_success if success else 0.0

    now = datetime.now(timezone.utc).isoformat()
    with _LOCK, _conn() as conn:
        row = _get_or_create_wallet(conn, user_id)
        balance = float(row["balance_cny"]) + earned - spent
        spent_total = float(row["spent_cny"]) + spent
        earned_total = float(row["earned_cny"]) + earned
        runs = int(row["runs"]) + 1
        conn.execute(
            """
            UPDATE clawwork_wallets
            SET balance_cny = ?, earned_cny = ?, spent_cny = ?, runs = ?, updated_at = ?
            WHERE user_id = ?
            """,
            (balance, earned_total, spent_total, runs, now, user_id),
        )
        conn.execute(
            """
            INSERT INTO clawwork_events(
                ts, user_id, route, prompt_tokens, completion_tokens, earned_cny, spent_cny, success, note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now,
                user_id,
                route_norm,
                int(prompt_tokens),
                int(completion_tokens),
                float(earned),
                float(spent),
                1 if success else 0,
                "llm_usage_settlement",
            ),
        )

    return {
        "user_id": user_id,
        "route": route_norm,
        "earned_cny": round(earned, 8),
        "spent_cny": round(spent, 8),
        "balance_cny": round(balance, 8),
        "runs": runs,
    }


def credit_wallet(user_id: str, amount_cny: float, note: str = "manual_credit") -> dict[str, Any]:
    ensure_schema()
    amount = max(0.0, float(amount_cny))
    now = datetime.now(timezone.utc).isoformat()
    with _LOCK, _conn() as conn:
        row = _get_or_create_wallet(conn, user_id)
        balance = float(row["balance_cny"]) + amount
        earned_total = float(row["earned_cny"]) + amount
        conn.execute(
            """
            UPDATE clawwork_wallets
            SET balance_cny = ?, earned_cny = ?, updated_at = ?
            WHERE user_id = ?
            """,
            (balance, earned_total, now, user_id),
        )
        conn.execute(
            """
            INSERT INTO clawwork_events(
                ts, user_id, route, prompt_tokens, completion_tokens, earned_cny, spent_cny, success, note
            )
            VALUES (?, ?, ?, 0, 0, ?, 0, 1, ?)
            """,
            (now, user_id, "credit", amount, note[:200]),
        )
    return wallet_snapshot(user_id)


def status(user_id: str | None = None) -> dict[str, Any]:
    ensure_schema()
    if user_id:
        return {
            "enabled": _env_bool("CLAWWORK_ECONOMY_ENABLED", False),
            "db_path": _db_path(),
            "wallet": wallet_snapshot(user_id),
        }
    with _LOCK, _conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM clawwork_wallets").fetchone()
        return {
            "enabled": _env_bool("CLAWWORK_ECONOMY_ENABLED", False),
            "db_path": _db_path(),
            "wallet_count": int((total or {"c": 0})["c"]),
        }


def daily_report(*, user_id: str | None = None, days: int = 7) -> dict[str, Any]:
    ensure_schema()
    days = max(1, min(int(days), 90))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    where = ["ts >= ?"]
    params: list[Any] = [since]
    if user_id:
        where.append("user_id = ?")
        params.append(user_id)
    where_sql = " AND ".join(where)

    with _LOCK, _conn() as conn:
        summary_row = conn.execute(
            f"""
            SELECT
              COUNT(*) AS total_events,
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_events,
              COALESCE(SUM(earned_cny), 0.0) AS earned_cny,
              COALESCE(SUM(spent_cny), 0.0) AS spent_cny,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens
            FROM clawwork_events
            WHERE {where_sql}
            """,
            tuple(params),
        ).fetchone()

        trend_rows = conn.execute(
            f"""
            SELECT
              substr(ts, 1, 10) AS day,
              COUNT(*) AS events,
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_events,
              COALESCE(SUM(earned_cny), 0.0) AS earned_cny,
              COALESCE(SUM(spent_cny), 0.0) AS spent_cny
            FROM clawwork_events
            WHERE {where_sql}
            GROUP BY substr(ts, 1, 10)
            ORDER BY day DESC
            """,
            tuple(params),
        ).fetchall()

        route_rows = conn.execute(
            f"""
            SELECT
              route,
              COUNT(*) AS events,
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_events,
              COALESCE(SUM(earned_cny), 0.0) AS earned_cny,
              COALESCE(SUM(spent_cny), 0.0) AS spent_cny
            FROM clawwork_events
            WHERE {where_sql}
            GROUP BY route
            ORDER BY events DESC
            """,
            tuple(params),
        ).fetchall()

    total_events = int((summary_row or {"total_events": 0})["total_events"] or 0)
    success_events = int((summary_row or {"success_events": 0})["success_events"] or 0)
    earned_cny = float((summary_row or {"earned_cny": 0.0})["earned_cny"] or 0.0)
    spent_cny = float((summary_row or {"spent_cny": 0.0})["spent_cny"] or 0.0)
    total_tokens = int((summary_row or {"total_tokens": 0})["total_tokens"] or 0)
    success_rate = round((success_events / total_events), 4) if total_events > 0 else 0.0

    trend: list[dict[str, Any]] = []
    for row in trend_rows:
        events = int(row["events"] or 0)
        success = int(row["success_events"] or 0)
        trend.append(
            {
                "day": str(row["day"] or ""),
                "events": events,
                "success_rate": round((success / events), 4) if events > 0 else 0.0,
                "earned_cny": round(float(row["earned_cny"] or 0.0), 6),
                "spent_cny": round(float(row["spent_cny"] or 0.0), 6),
            }
        )

    route_breakdown: list[dict[str, Any]] = []
    for row in route_rows:
        events = int(row["events"] or 0)
        success = int(row["success_events"] or 0)
        route_breakdown.append(
            {
                "route": str(row["route"] or "unknown"),
                "events": events,
                "success_rate": round((success / events), 4) if events > 0 else 0.0,
                "earned_cny": round(float(row["earned_cny"] or 0.0), 6),
                "spent_cny": round(float(row["spent_cny"] or 0.0), 6),
            }
        )

    return {
        "enabled": _env_bool("CLAWWORK_ECONOMY_ENABLED", False),
        "user_id": user_id,
        "days": days,
        "since": since,
        "summary": {
            "total_events": total_events,
            "success_events": success_events,
            "success_rate": success_rate,
            "earned_cny": round(earned_cny, 6),
            "spent_cny": round(spent_cny, 6),
            "net_cny": round(earned_cny - spent_cny, 6),
            "total_tokens": total_tokens,
        },
        "trend": trend,
        "route_breakdown": route_breakdown,
    }
