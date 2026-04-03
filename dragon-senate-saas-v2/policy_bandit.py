from __future__ import annotations

import json
import os
import random
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any


_LOCK = threading.RLock()
STORYBOARD_ARMS = [5, 7, 15]
TONE_ARMS = ["friendly_trustworthy", "expert_confident", "warm_storytelling"]
DEFAULT_TEMPLATE_SCOPE = "workflow_template:general"


def _db_path() -> str:
    return os.getenv("POLICY_BANDIT_DB_PATH", "./data/policy_bandit.sqlite").strip()


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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _clamp_01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _weights() -> dict[str, float]:
    conv = float(os.getenv("POLICY_BANDIT_WEIGHT_CONVERSION", "0.60"))
    replay = float(os.getenv("POLICY_BANDIT_WEIGHT_REPLAY_SUCCESS", "0.30"))
    complaint = float(os.getenv("POLICY_BANDIT_WEIGHT_COMPLAINT", "0.10"))
    total = conv + replay + complaint
    if total <= 0:
        conv, replay, complaint = 0.60, 0.30, 0.10
    return {"conversion": conv, "replay_success": replay, "complaint": complaint}


def _ensure_columns(conn: sqlite3.Connection) -> None:
    rows = conn.execute("PRAGMA table_info(policy_bandit_arms)").fetchall()
    cols = {str(row["name"]) for row in rows}
    statements = [
        ("conversion_sum", "REAL NOT NULL DEFAULT 0.0"),
        ("replay_success_sum", "REAL NOT NULL DEFAULT 0.0"),
        ("complaint_sum", "REAL NOT NULL DEFAULT 0.0"),
        ("last_conversion", "REAL NOT NULL DEFAULT 0.0"),
        ("last_replay_success", "REAL NOT NULL DEFAULT 0.0"),
        ("last_complaint", "REAL NOT NULL DEFAULT 0.0"),
    ]
    for col, col_type in statements:
        if col in cols:
            continue
        conn.execute(f"ALTER TABLE policy_bandit_arms ADD COLUMN {col} {col_type}")


def _ensure_update_columns(conn: sqlite3.Connection) -> None:
    rows = conn.execute("PRAGMA table_info(policy_bandit_updates)").fetchall()
    cols = {str(row["name"]) for row in rows}
    statements = [
        ("template_scope", "TEXT NOT NULL DEFAULT ''"),
        ("template_arm", "TEXT NOT NULL DEFAULT ''"),
    ]
    for col, col_type in statements:
        if col in cols:
            continue
        conn.execute(f"ALTER TABLE policy_bandit_updates ADD COLUMN {col} {col_type}")


def ensure_schema() -> None:
    with _LOCK, _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS policy_bandit_arms (
                user_id TEXT NOT NULL,
                arm_type TEXT NOT NULL,
                arm_value TEXT NOT NULL,
                pulls INTEGER NOT NULL DEFAULT 0,
                reward_sum REAL NOT NULL DEFAULT 0.0,
                last_reward REAL NOT NULL DEFAULT 0.0,
                conversion_sum REAL NOT NULL DEFAULT 0.0,
                replay_success_sum REAL NOT NULL DEFAULT 0.0,
                complaint_sum REAL NOT NULL DEFAULT 0.0,
                last_conversion REAL NOT NULL DEFAULT 0.0,
                last_replay_success REAL NOT NULL DEFAULT 0.0,
                last_complaint REAL NOT NULL DEFAULT 0.0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(user_id, arm_type, arm_value)
            )
            """
        )
        _ensure_columns(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS policy_bandit_updates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                storyboard_count INTEGER NOT NULL,
                tone TEXT NOT NULL,
                template_scope TEXT NOT NULL DEFAULT '',
                template_arm TEXT NOT NULL DEFAULT '',
                reward REAL NOT NULL,
                conversion_rate REAL NOT NULL,
                replay_success_rate REAL NOT NULL,
                complaint_rate REAL NOT NULL,
                weights_json TEXT NOT NULL,
                trace_id TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        _ensure_update_columns(conn)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_policy_bandit_updates_user ON policy_bandit_updates(user_id, created_at)"
        )


def _upsert_arm(conn: sqlite3.Connection, user_id: str, arm_type: str, arm_value: str) -> None:
    row = conn.execute(
        "SELECT 1 FROM policy_bandit_arms WHERE user_id=? AND arm_type=? AND arm_value=?",
        (user_id, arm_type, arm_value),
    ).fetchone()
    if row is not None:
        return
    conn.execute(
        """
        INSERT INTO policy_bandit_arms(
            user_id, arm_type, arm_value, pulls, reward_sum, last_reward,
            conversion_sum, replay_success_sum, complaint_sum,
            last_conversion, last_replay_success, last_complaint, updated_at
        ) VALUES (?, ?, ?, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, ?)
        """,
        (user_id, arm_type, arm_value, _now()),
    )


def _ensure_user_arms(conn: sqlite3.Connection, user_id: str) -> None:
    for arm in STORYBOARD_ARMS:
        _upsert_arm(conn, user_id, "storyboard", str(arm))
    for arm in TONE_ARMS:
        _upsert_arm(conn, user_id, "tone", arm)


def _normalize_scope(value: str | None) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return DEFAULT_TEMPLATE_SCOPE
    return text[:96]


def _normalize_template_arm(value: str | None, default_value: str | None = None) -> str:
    raw = str(value or default_value or "").strip().lower()
    if not raw:
        raw = "default"
    output = []
    for ch in raw:
        if ch.isalnum() or ch in {"-", "_", ":"}:
            output.append(ch)
        else:
            output.append("-")
    text = "".join(output).strip("-")
    return text[:128] or "default"


def _best_arm(conn: sqlite3.Connection, user_id: str, arm_type: str) -> tuple[str, float]:
    rows = conn.execute(
        """
        SELECT arm_value, pulls, reward_sum
        FROM policy_bandit_arms
        WHERE user_id = ? AND arm_type = ?
        """,
        (user_id, arm_type),
    ).fetchall()
    best_value = ""
    best_score = -1e9
    for row in rows:
        pulls = int(row["pulls"] or 0)
        reward_sum = float(row["reward_sum"] or 0.0)
        mean = reward_sum / pulls if pulls > 0 else 0.0
        if mean > best_score:
            best_score = mean
            best_value = str(row["arm_value"])
    return best_value, best_score


def recommend_policy(
    user_id: str,
    *,
    template_scope: str | None = None,
    template_candidates: list[str] | None = None,
    default_template: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    epsilon = float(os.getenv("POLICY_BANDIT_EPSILON", "0.18"))
    epsilon = min(max(epsilon, 0.01), 0.8)
    enabled = _env_bool("POLICY_BANDIT_ENABLED", True)
    normalized_scope = _normalize_scope(template_scope)
    normalized_candidates = [
        _normalize_template_arm(item)
        for item in (template_candidates or [])
        if str(item or "").strip()
    ]
    # Stable ordering keeps exploration/replay deterministic.
    normalized_candidates = sorted(list(dict.fromkeys(normalized_candidates)))
    fallback_template = _normalize_template_arm(default_template, "default")
    if normalized_candidates and fallback_template not in normalized_candidates:
        fallback_template = normalized_candidates[0]

    with _LOCK, _conn() as conn:
        _ensure_user_arms(conn, user_id)
        for candidate in normalized_candidates:
            _upsert_arm(conn, user_id, normalized_scope, candidate)
        if not enabled:
            return {
                "enabled": False,
                "storyboard_count": 7,
                "tone": "friendly_trustworthy",
                "workflow_template_scope": normalized_scope,
                "workflow_template": fallback_template,
                "mode": "disabled",
            }

        explore = random.random() < epsilon
        if explore:
            storyboard = random.choice(STORYBOARD_ARMS)
            tone = random.choice(TONE_ARMS)
            mode = "explore"
        else:
            sb_arm, sb_score = _best_arm(conn, user_id, "storyboard")
            tone_arm, tone_score = _best_arm(conn, user_id, "tone")
            storyboard = int(sb_arm or 7)
            tone = tone_arm or "friendly_trustworthy"
            mode = f"exploit(sb={sb_score:.4f},tone={tone_score:.4f})"

        workflow_template = fallback_template
        template_mode = "fallback"
        if normalized_candidates:
            if explore:
                workflow_template = random.choice(normalized_candidates)
                template_mode = "explore"
            else:
                tpl_arm, tpl_score = _best_arm(conn, user_id, normalized_scope)
                workflow_template = _normalize_template_arm(tpl_arm, fallback_template)
                template_mode = f"exploit(score={tpl_score:.4f})"

    return {
        "enabled": enabled,
        "storyboard_count": storyboard,
        "tone": tone,
        "workflow_template_scope": normalized_scope,
        "workflow_template": workflow_template,
        "workflow_template_mode": template_mode,
        "workflow_template_candidates": normalized_candidates,
        "mode": mode,
        "epsilon": epsilon,
    }


def _build_effective_reward(
    *,
    conversion_rate: float,
    replay_success_rate: float,
    complaint_rate: float,
) -> tuple[float, dict[str, float]]:
    rates = {
        "conversion_rate": _clamp_01(conversion_rate),
        "replay_success_rate": _clamp_01(replay_success_rate),
        "complaint_rate": _clamp_01(complaint_rate),
    }
    weights = _weights()
    reward = (
        rates["conversion_rate"] * weights["conversion"]
        + rates["replay_success_rate"] * weights["replay_success"]
        - rates["complaint_rate"] * weights["complaint"]
    )
    return _clamp_01(reward), rates


def update_policy(
    *,
    user_id: str,
    storyboard_count: int,
    tone: str,
    reward: float | None = None,
    conversion_rate: float | None = None,
    replay_success_rate: float | None = None,
    complaint_rate: float | None = None,
    trace_id: str | None = None,
    template_scope: str | None = None,
    template_arm: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    sb_value = str(storyboard_count if storyboard_count in STORYBOARD_ARMS else 7)
    tone_value = tone if tone in TONE_ARMS else "friendly_trustworthy"

    conversion_rate = _clamp_01(conversion_rate if conversion_rate is not None else 0.0)
    replay_success_rate = _clamp_01(replay_success_rate if replay_success_rate is not None else 0.0)
    complaint_rate = _clamp_01(complaint_rate if complaint_rate is not None else 0.0)

    if reward is None:
        effective_reward, rates = _build_effective_reward(
            conversion_rate=conversion_rate,
            replay_success_rate=replay_success_rate,
            complaint_rate=complaint_rate,
        )
    else:
        effective_reward = _clamp_01(reward)
        rates = {
            "conversion_rate": conversion_rate,
            "replay_success_rate": replay_success_rate,
            "complaint_rate": complaint_rate,
        }
    now = _now()
    weights = _weights()
    normalized_scope = _normalize_scope(template_scope)
    normalized_template = _normalize_template_arm(template_arm, "")
    template_enabled = bool(template_arm and str(template_arm).strip())

    with _LOCK, _conn() as conn:
        _ensure_user_arms(conn, user_id)
        if template_enabled:
            _upsert_arm(conn, user_id, normalized_scope, normalized_template)
        chosen_arms = [("storyboard", sb_value), ("tone", tone_value)]
        if template_enabled:
            chosen_arms.append((normalized_scope, normalized_template))
        for arm_type, arm_value in chosen_arms:
            row = conn.execute(
                """
                SELECT pulls, reward_sum, conversion_sum, replay_success_sum, complaint_sum
                FROM policy_bandit_arms
                WHERE user_id = ? AND arm_type = ? AND arm_value = ?
                """,
                (user_id, arm_type, arm_value),
            ).fetchone()
            pulls = int((row or {"pulls": 0})["pulls"]) + 1
            reward_sum = float((row or {"reward_sum": 0.0})["reward_sum"]) + effective_reward
            conversion_sum = float((row or {"conversion_sum": 0.0})["conversion_sum"]) + rates["conversion_rate"]
            replay_sum = float((row or {"replay_success_sum": 0.0})["replay_success_sum"]) + rates["replay_success_rate"]
            complaint_sum = float((row or {"complaint_sum": 0.0})["complaint_sum"]) + rates["complaint_rate"]
            conn.execute(
                """
                UPDATE policy_bandit_arms
                SET pulls = ?,
                    reward_sum = ?,
                    last_reward = ?,
                    conversion_sum = ?,
                    replay_success_sum = ?,
                    complaint_sum = ?,
                    last_conversion = ?,
                    last_replay_success = ?,
                    last_complaint = ?,
                    updated_at = ?
                WHERE user_id = ? AND arm_type = ? AND arm_value = ?
                """,
                (
                    pulls,
                    reward_sum,
                    effective_reward,
                    conversion_sum,
                    replay_sum,
                    complaint_sum,
                    rates["conversion_rate"],
                    rates["replay_success_rate"],
                    rates["complaint_rate"],
                    now,
                    user_id,
                    arm_type,
                    arm_value,
                ),
            )
        conn.execute(
            """
            INSERT INTO policy_bandit_updates(
                user_id, storyboard_count, tone, template_scope, template_arm, reward,
                conversion_rate, replay_success_rate, complaint_rate,
                weights_json, trace_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                int(sb_value),
                tone_value,
                normalized_scope if template_enabled else "",
                normalized_template if template_enabled else "",
                effective_reward,
                rates["conversion_rate"],
                rates["replay_success_rate"],
                rates["complaint_rate"],
                json.dumps(weights, ensure_ascii=False),
                (trace_id or "").strip() or None,
                now,
            ),
        )
    return snapshot(user_id)


def snapshot(user_id: str) -> dict[str, Any]:
    ensure_schema()
    with _LOCK, _conn() as conn:
        _ensure_user_arms(conn, user_id)
        rows = conn.execute(
            """
            SELECT arm_type, arm_value, pulls, reward_sum, last_reward,
                   conversion_sum, replay_success_sum, complaint_sum,
                   last_conversion, last_replay_success, last_complaint,
                   updated_at
            FROM policy_bandit_arms
            WHERE user_id = ?
            ORDER BY arm_type, arm_value
            """,
            (user_id,),
        ).fetchall()
        latest = conn.execute(
            """
            SELECT reward, conversion_rate, replay_success_rate, complaint_rate,
                   template_scope, template_arm, created_at
            FROM policy_bandit_updates
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()

    arms = []
    for row in rows:
        pulls = int(row["pulls"] or 0)
        reward_sum = float(row["reward_sum"] or 0.0)
        conversion_sum = float(row["conversion_sum"] or 0.0)
        replay_sum = float(row["replay_success_sum"] or 0.0)
        complaint_sum = float(row["complaint_sum"] or 0.0)
        arms.append(
            {
                "arm_type": str(row["arm_type"]),
                "arm_value": str(row["arm_value"]),
                "pulls": pulls,
                "reward_sum": reward_sum,
                "avg_reward": (reward_sum / pulls) if pulls > 0 else 0.0,
                "avg_conversion_rate": (conversion_sum / pulls) if pulls > 0 else 0.0,
                "avg_replay_success_rate": (replay_sum / pulls) if pulls > 0 else 0.0,
                "avg_complaint_rate": (complaint_sum / pulls) if pulls > 0 else 0.0,
                "last_reward": float(row["last_reward"] or 0.0),
                "last_conversion": float(row["last_conversion"] or 0.0),
                "last_replay_success": float(row["last_replay_success"] or 0.0),
                "last_complaint": float(row["last_complaint"] or 0.0),
                "updated_at": str(row["updated_at"]),
            }
        )

    latest_update = None
    if latest:
        latest_update = {
            "reward": float(latest["reward"] or 0.0),
            "conversion_rate": float(latest["conversion_rate"] or 0.0),
            "replay_success_rate": float(latest["replay_success_rate"] or 0.0),
            "complaint_rate": float(latest["complaint_rate"] or 0.0),
            "template_scope": str(latest["template_scope"] or ""),
            "template_arm": str(latest["template_arm"] or ""),
            "created_at": str(latest["created_at"]),
        }
    return {"user_id": user_id, "weights": _weights(), "latest_update": latest_update, "arms": arms}
