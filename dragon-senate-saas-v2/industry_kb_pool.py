from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from langchain_core.documents import Document

from qdrant_config import ingest_formula_documents
from qdrant_config import search_formula_documents


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sanitize(value: str, *, max_len: int = 64) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_\-]+", "_", str(value or "").strip().lower()).strip("_")
    return cleaned[:max_len] or "general"


def normalize_industry_tag(industry_tag: str | None) -> str:
    return _sanitize(industry_tag or "general", max_len=64)


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(value, hi))


def _float_env(name: str, default: float) -> float:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _int_env(name: str, default: int) -> int:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _thresholds() -> dict[str, float]:
    return {
        "min_quality_score": _clamp(_float_env("INDUSTRY_KB_MIN_QUALITY_SCORE", 45.0), 0.0, 100.0),
        "min_effect_score": _clamp(_float_env("INDUSTRY_KB_MIN_EFFECT_SCORE", 0.0), 0.0, 100.0),
        "min_content_len": float(max(0, _int_env("INDUSTRY_KB_MIN_CONTENT_LEN", 24))),
        "min_title_len": float(max(0, _int_env("INDUSTRY_KB_MIN_TITLE_LEN", 4))),
    }


def _db_path() -> Path:
    raw = os.getenv("INDUSTRY_KB_DB_PATH", "./data/industry_kb_pool.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def _table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {str(row["name"]).strip().lower() for row in rows}


def _ensure_column(conn: sqlite3.Connection, table_name: str, column_name: str, ddl: str) -> None:
    cols = _table_columns(conn, table_name)
    if column_name.strip().lower() in cols:
        return
    conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}")


def ensure_schema() -> None:
    with _conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS industry_kb_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                industry_tag TEXT NOT NULL,
                display_name TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                config_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, industry_tag)
            );
            CREATE INDEX IF NOT EXISTS idx_industry_kb_profiles_tenant
                ON industry_kb_profiles (tenant_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS industry_kb_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                industry_tag TEXT NOT NULL,
                entry_type TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                source_url TEXT,
                source_account TEXT,
                effect_score REAL NOT NULL DEFAULT 0,
                quality_score REAL NOT NULL DEFAULT 0,
                dedupe_hash TEXT NOT NULL DEFAULT '',
                trace_id TEXT,
                created_by TEXT,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_industry_kb_entries_tenant_industry
                ON industry_kb_entries (tenant_id, industry_tag, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_industry_kb_entries_trace
                ON industry_kb_entries (trace_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS industry_kb_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                industry_tag TEXT NOT NULL,
                action TEXT NOT NULL,
                detail_json TEXT NOT NULL,
                actor_user_id TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_industry_kb_audit_tenant
                ON industry_kb_audit (tenant_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS industry_kb_run_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                trace_id TEXT NOT NULL,
                industry_tag TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'run_dragon_team',
                kb_hits INTEGER NOT NULL DEFAULT 0,
                kb_requested INTEGER NOT NULL DEFAULT 0,
                kb_hit_rate REAL NOT NULL DEFAULT 0,
                run_score REAL NOT NULL DEFAULT 0,
                avg_effect_score REAL NOT NULL DEFAULT 0,
                effect_delta REAL NOT NULL DEFAULT 0,
                detail_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                UNIQUE(tenant_id, trace_id)
            );
            CREATE INDEX IF NOT EXISTS idx_industry_kb_run_metrics_tenant_time
                ON industry_kb_run_metrics (tenant_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_industry_kb_run_metrics_industry
                ON industry_kb_run_metrics (tenant_id, industry_tag, created_at DESC);
            """
        )
        _ensure_column(conn, "industry_kb_entries", "quality_score", "REAL NOT NULL DEFAULT 0")
        _ensure_column(conn, "industry_kb_entries", "dedupe_hash", "TEXT NOT NULL DEFAULT ''")
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_industry_kb_entries_dedupe
                ON industry_kb_entries (tenant_id, industry_tag, dedupe_hash)
                WHERE dedupe_hash != ''
            """
        )


def _scope_user_id(tenant_id: str, industry_tag: str) -> str:
    return f"tenant_{_sanitize(tenant_id, max_len=40)}__industry_{_sanitize(industry_tag, max_len=40)}"


def _profile_display_name(industry_tag: str) -> str:
    tag = normalize_industry_tag(industry_tag)
    if tag == "general":
        return "General Industry KB"
    return f"{tag} Industry KB"


def upsert_profile(
    *,
    tenant_id: str,
    industry_tag: str,
    display_name: str | None = None,
    description: str | None = None,
    status: str = "active",
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_schema()
    tag = normalize_industry_tag(industry_tag)
    now = _utc_now()
    safe_status = str(status or "active").strip().lower()
    if safe_status not in {"active", "paused", "archived"}:
        safe_status = "active"

    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM industry_kb_profiles WHERE tenant_id = ? AND industry_tag = ?",
            (tenant_id, tag),
        ).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO industry_kb_profiles
                    (tenant_id, industry_tag, display_name, description, status, config_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tenant_id,
                    tag,
                    str(display_name or _profile_display_name(tag))[:120],
                    str(description or "")[:1000],
                    safe_status,
                    json.dumps(config or {}, ensure_ascii=False),
                    now,
                    now,
                ),
            )
        else:
            conn.execute(
                """
                UPDATE industry_kb_profiles
                SET display_name = ?, description = ?, status = ?, config_json = ?, updated_at = ?
                WHERE tenant_id = ? AND industry_tag = ?
                """,
                (
                    str(display_name or _profile_display_name(tag))[:120],
                    str(description or "")[:1000],
                    safe_status,
                    json.dumps(config or {}, ensure_ascii=False),
                    now,
                    tenant_id,
                    tag,
                ),
            )

        saved = conn.execute(
            """
            SELECT tenant_id, industry_tag, display_name, description, status, config_json, created_at, updated_at
            FROM industry_kb_profiles
            WHERE tenant_id = ? AND industry_tag = ?
            """,
            (tenant_id, tag),
        ).fetchone()
        return {
            "tenant_id": str(saved["tenant_id"]),
            "industry_tag": str(saved["industry_tag"]),
            "display_name": str(saved["display_name"]),
            "description": str(saved["description"] or ""),
            "status": str(saved["status"]),
            "config": json.loads(saved["config_json"] or "{}"),
            "created_at": str(saved["created_at"]),
            "updated_at": str(saved["updated_at"]),
        }


def list_profiles(*, tenant_id: str, include_archived: bool = False) -> list[dict[str, Any]]:
    ensure_schema()
    where = "tenant_id = ?"
    params: list[Any] = [tenant_id]
    if not include_archived:
        where += " AND status != ?"
        params.append("archived")

    with _conn() as conn:
        rows = conn.execute(
            f"""
            SELECT tenant_id, industry_tag, display_name, description, status, config_json, created_at, updated_at
            FROM industry_kb_profiles
            WHERE {where}
            ORDER BY updated_at DESC
            """,
            tuple(params),
        ).fetchall()
    return [
        {
            "tenant_id": str(row["tenant_id"]),
            "industry_tag": str(row["industry_tag"]),
            "display_name": str(row["display_name"]),
            "description": str(row["description"] or ""),
            "status": str(row["status"]),
            "config": json.loads(row["config_json"] or "{}"),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
        }
        for row in rows
    ]


def _entry_text(entry: dict[str, Any]) -> str:
    payload = {
        "entry_type": entry.get("entry_type"),
        "title": entry.get("title"),
        "content": entry.get("content"),
        "cta": entry.get("cta"),
        "hook_type": entry.get("hook_type"),
        "content_structure": entry.get("content_structure"),
        "storyboard_count": entry.get("storyboard_count"),
        "rhythm_peak_seconds": entry.get("rhythm_peak_seconds"),
        "persona_slang": entry.get("persona_slang"),
        "duration_golden_seconds": entry.get("duration_golden_seconds"),
    }
    return json.dumps(payload, ensure_ascii=False)


def _entry_metadata(
    *,
    tenant_id: str,
    industry_tag: str,
    entry: dict[str, Any],
    trace_id: str | None,
    created_by: str | None,
) -> dict[str, Any]:
    return {
        "tenant_id": tenant_id,
        "industry_tag": normalize_industry_tag(industry_tag),
        "entry_type": str(entry.get("entry_type") or "formula")[:64],
        "title": str(entry.get("title") or "untitled")[:160],
        "source_url": str(entry.get("source_url") or "")[:1000],
        "source_account": str(entry.get("source_account") or "")[:120],
        "effect_score": float(entry.get("effect_score", 0) or 0),
        "trace_id": str(trace_id or "")[:120],
        "created_by": str(created_by or "")[:120],
        "storyboard_count": int(entry.get("storyboard_count", 0) or 0),
        "ingest_ts": int(time.time()),
        "category": str(entry.get("entry_type") or "formula")[:64],
        "account": str(entry.get("source_account") or "")[:120],
    }


def _normalize_for_hash(value: str, *, max_len: int = 3000) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip().lower())
    return text[:max_len]


def _dedupe_hash(item: dict[str, Any]) -> str:
    base = "|".join(
        [
            _normalize_for_hash(item.get("entry_type", ""), max_len=80),
            _normalize_for_hash(item.get("title", ""), max_len=220),
            _normalize_for_hash(item.get("content", ""), max_len=4000),
            _normalize_for_hash(item.get("source_url", ""), max_len=1000),
            _normalize_for_hash(item.get("source_account", ""), max_len=200),
        ]
    )
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def _evaluate_quality(item: dict[str, Any], thresholds: dict[str, float]) -> dict[str, Any]:
    effect_score = _clamp(float(item.get("effect_score", 0) or 0), 0.0, 100.0)
    content_len = len(str(item.get("content", "") or ""))
    title_len = len(str(item.get("title", "") or ""))

    effect_component = effect_score * 0.6
    content_component = _clamp((content_len / 800.0) * 25.0, 0.0, 25.0)
    title_component = _clamp((title_len / 40.0) * 15.0, 0.0, 15.0)
    quality_score = _clamp(effect_component + content_component + title_component, 0.0, 100.0)

    reasons: list[str] = []
    if content_len < int(thresholds["min_content_len"]):
        reasons.append("content_too_short")
    if title_len < int(thresholds["min_title_len"]):
        reasons.append("title_too_short")
    if effect_score < thresholds["min_effect_score"]:
        reasons.append("effect_score_too_low")
    if quality_score < thresholds["min_quality_score"]:
        reasons.append("quality_score_too_low")

    return {
        "quality_score": round(quality_score, 4),
        "accepted": len(reasons) == 0,
        "reasons": reasons,
        "content_len": content_len,
        "title_len": title_len,
        "effect_score": effect_score,
    }


def _append_audit(
    *,
    tenant_id: str,
    industry_tag: str,
    action: str,
    detail: dict[str, Any],
    actor_user_id: str | None,
) -> None:
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO industry_kb_audit (tenant_id, industry_tag, action, detail_json, actor_user_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                tenant_id,
                normalize_industry_tag(industry_tag),
                str(action or "unknown")[:64],
                json.dumps(detail or {}, ensure_ascii=False),
                str(actor_user_id or "")[:120],
                _utc_now(),
            ),
        )


def _avg_effect_score(references: list[dict[str, Any]]) -> float:
    values: list[float] = []
    for ref in references:
        try:
            values.append(float(ref.get("effect_score", 0) or 0))
        except (TypeError, ValueError):
            continue
    if not values:
        return 0.0
    return sum(values) / len(values)


def ingest_entries(
    *,
    tenant_id: str,
    industry_tag: str,
    entries: list[dict[str, Any]],
    trace_id: str | None = None,
    actor_user_id: str | None = None,
    auto_create_profile: bool = True,
) -> dict[str, Any]:
    ensure_schema()
    tag = normalize_industry_tag(industry_tag)
    if auto_create_profile:
        upsert_profile(tenant_id=tenant_id, industry_tag=tag)

    thresholds = _thresholds()
    normalized_entries: list[dict[str, Any]] = []
    for raw in entries:
        entry_type = str(raw.get("entry_type") or "formula").strip().lower() or "formula"
        title = str(raw.get("title") or raw.get("hook_type") or "untitled")[:160]
        content = str(raw.get("content") or "").strip()
        if not content:
            content = _entry_text(raw)
        normalized_entries.append(
            {
                "entry_type": entry_type,
                "title": title,
                "content": content,
                "source_url": str(raw.get("source_url") or "")[:1000],
                "source_account": str(raw.get("source_account") or "")[:120],
                "effect_score": float(raw.get("effect_score", 0) or 0),
                "metadata": raw.get("metadata") or {},
                "raw": raw,
            }
        )

    if not normalized_entries:
        return {
            "ok": True,
            "tenant_id": tenant_id,
            "industry_tag": tag,
            "ingested_count": 0,
            "accepted_count": 0,
            "duplicate_count": 0,
            "rejected_count": 0,
            "vector_count": 0,
            "thresholds": thresholds,
        }

    documents: list[Document] = []
    accepted_count = 0
    duplicate_count = 0
    rejected_count = 0
    duplicate_samples: list[dict[str, Any]] = []
    rejected_samples: list[dict[str, Any]] = []
    with _conn() as conn:
        for item in normalized_entries:
            dedupe_hash = _dedupe_hash(item)
            duplicated = conn.execute(
                """
                SELECT 1 FROM industry_kb_entries
                WHERE tenant_id = ? AND industry_tag = ? AND dedupe_hash = ?
                LIMIT 1
                """,
                (tenant_id, tag, dedupe_hash),
            ).fetchone()
            if duplicated:
                duplicate_count += 1
                if len(duplicate_samples) < 5:
                    duplicate_samples.append(
                        {
                            "title": item["title"],
                            "entry_type": item["entry_type"],
                            "dedupe_hash": dedupe_hash,
                            "reason": "duplicate_entry",
                        }
                    )
                continue

            quality = _evaluate_quality(item, thresholds)
            if not quality["accepted"]:
                rejected_count += 1
                if len(rejected_samples) < 8:
                    rejected_samples.append(
                        {
                            "title": item["title"],
                            "entry_type": item["entry_type"],
                            "quality_score": quality["quality_score"],
                            "reasons": quality["reasons"],
                        }
                    )
                continue

            metadata = _entry_metadata(
                tenant_id=tenant_id,
                industry_tag=tag,
                entry=item["raw"],
                trace_id=trace_id,
                created_by=actor_user_id,
            )
            merged_metadata = {
                **metadata,
                **(item.get("metadata") or {}),
                "dedupe_hash": dedupe_hash,
                "quality_score": quality["quality_score"],
                "quality_reasons": quality["reasons"],
            }
            conn.execute(
                """
                INSERT INTO industry_kb_entries
                    (tenant_id, industry_tag, entry_type, title, content, source_url, source_account, effect_score, quality_score, dedupe_hash, trace_id, created_by, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tenant_id,
                    tag,
                    item["entry_type"],
                    item["title"],
                    item["content"],
                    item["source_url"],
                    item["source_account"],
                    item["effect_score"],
                    quality["quality_score"],
                    dedupe_hash,
                    str(trace_id or "")[:120],
                    str(actor_user_id or "")[:120],
                    json.dumps(merged_metadata, ensure_ascii=False),
                    _utc_now(),
                ),
            )
            documents.append(Document(page_content=item["content"], metadata=merged_metadata))
            accepted_count += 1

    scope_user_id = _scope_user_id(tenant_id, tag)
    vector_count = ingest_formula_documents(documents, user_id=scope_user_id) if documents else 0
    _append_audit(
        tenant_id=tenant_id,
        industry_tag=tag,
        action="ingest_entries",
        detail={
            "received_count": len(normalized_entries),
            "ingested_count": accepted_count,
            "accepted_count": accepted_count,
            "duplicate_count": duplicate_count,
            "rejected_count": rejected_count,
            "vector_count": vector_count,
            "trace_id": trace_id,
            "rejected_samples": rejected_samples,
            "duplicate_samples": duplicate_samples,
            "thresholds": thresholds,
        },
        actor_user_id=actor_user_id,
    )
    return {
        "ok": True,
        "tenant_id": tenant_id,
        "industry_tag": tag,
        "scope_user_id": scope_user_id,
        "received_count": len(normalized_entries),
        "ingested_count": accepted_count,
        "accepted_count": accepted_count,
        "duplicate_count": duplicate_count,
        "rejected_count": rejected_count,
        "rejected_samples": rejected_samples,
        "duplicate_samples": duplicate_samples,
        "thresholds": thresholds,
        "vector_count": vector_count,
    }


def ingest_competitor_formulas(
    *,
    tenant_id: str,
    industry_tag: str,
    formulas: list[dict[str, Any]],
    source_account: str | None = None,
    trace_id: str | None = None,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    for formula in formulas:
        entries.append(
            {
                "entry_type": "formula",
                "title": str(formula.get("hook_type") or formula.get("topic_focus") or "formula")[:160],
                "content": json.dumps(formula, ensure_ascii=False),
                "source_url": str(formula.get("source_url") or "")[:1000],
                "source_account": str(formula.get("source_account") or source_account or "")[:120],
                "effect_score": float(formula.get("effect_score", 0) or 0),
                "storyboard_count": int(formula.get("storyboard_count", 0) or 0),
                "hook_type": formula.get("hook_type"),
                "content_structure": formula.get("content_structure"),
                "cta": formula.get("cta"),
                "rhythm_peak_seconds": formula.get("rhythm_peak_seconds"),
                "persona_slang": formula.get("persona_slang"),
                "duration_golden_seconds": formula.get("duration_golden_seconds"),
                "metadata": {
                    "source": "competitor_formula",
                    "category": str(formula.get("category") or "formula")[:64],
                },
            }
        )
    return ingest_entries(
        tenant_id=tenant_id,
        industry_tag=industry_tag,
        entries=entries,
        trace_id=trace_id,
        actor_user_id=actor_user_id,
    )


def search_entries(
    *,
    tenant_id: str,
    industry_tag: str,
    query: str,
    limit: int = 8,
    entry_type: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    tag = normalize_industry_tag(industry_tag)
    scope_user_id = _scope_user_id(tenant_id, tag)
    docs = search_formula_documents(
        query,
        k=max(1, min(int(limit), 50)),
        category=(str(entry_type).strip().lower() if entry_type else None),
        user_id=scope_user_id,
    )
    references: list[dict[str, Any]] = []
    for doc in docs:
        metadata = dict(doc.metadata or {})
        references.append(
            {
                "entry_type": str(metadata.get("entry_type") or metadata.get("category") or "formula"),
                "title": str(metadata.get("title") or "untitled")[:160],
                "effect_score": float(metadata.get("effect_score", 0) or 0),
                "source_url": str(metadata.get("source_url") or ""),
                "source_account": str(metadata.get("source_account") or metadata.get("account") or ""),
                "storyboard_count": int(metadata.get("storyboard_count", 0) or 0),
                "snippet": doc.page_content[:320],
                "metadata": metadata,
            }
        )
    return {
        "ok": True,
        "tenant_id": tenant_id,
        "industry_tag": tag,
        "scope_user_id": scope_user_id,
        "query": query,
        "count": len(references),
        "references": references,
    }


def build_runtime_context(
    *,
    tenant_id: str,
    industry_tag: str,
    query: str,
    limit: int = 6,
) -> dict[str, Any]:
    result = search_entries(
        tenant_id=tenant_id,
        industry_tag=industry_tag,
        query=query,
        limit=limit,
    )
    result["industry_tag"] = normalize_industry_tag(industry_tag)
    result["knowledge_scope"] = _scope_user_id(tenant_id, industry_tag)
    return result


def profile_stats(*, tenant_id: str, industry_tag: str) -> dict[str, Any]:
    ensure_schema()
    tag = normalize_industry_tag(industry_tag)
    with _conn() as conn:
        profile = conn.execute(
            "SELECT tenant_id, industry_tag, display_name, description, status, config_json, created_at, updated_at FROM industry_kb_profiles WHERE tenant_id = ? AND industry_tag = ?",
            (tenant_id, tag),
        ).fetchone()
        entries_count = int(
            conn.execute(
                "SELECT COUNT(1) FROM industry_kb_entries WHERE tenant_id = ? AND industry_tag = ?",
                (tenant_id, tag),
            ).fetchone()[0]
        )
        latest_entry = conn.execute(
            "SELECT created_at, effect_score FROM industry_kb_entries WHERE tenant_id = ? AND industry_tag = ? ORDER BY id DESC LIMIT 1",
            (tenant_id, tag),
        ).fetchone()
    return {
        "ok": True,
        "tenant_id": tenant_id,
        "industry_tag": tag,
        "profile": (
            {
                "tenant_id": str(profile["tenant_id"]),
                "industry_tag": str(profile["industry_tag"]),
                "display_name": str(profile["display_name"]),
                "description": str(profile["description"] or ""),
                "status": str(profile["status"]),
                "config": json.loads(profile["config_json"] or "{}"),
                "created_at": str(profile["created_at"]),
                "updated_at": str(profile["updated_at"]),
            }
            if profile
            else None
        ),
        "entries_count": entries_count,
        "latest_entry": (
            {
                "created_at": str(latest_entry["created_at"]),
                "effect_score": float(latest_entry["effect_score"] or 0),
            }
            if latest_entry
            else None
        ),
    }


def record_run_metrics(
    *,
    tenant_id: str,
    user_id: str,
    trace_id: str,
    industry_tag: str,
    kb_hits: int,
    kb_requested: int,
    run_score: float,
    references: list[dict[str, Any]] | None = None,
    source: str = "run_dragon_team",
    strategy_version: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    tag = normalize_industry_tag(industry_tag)
    references = list(references or [])
    safe_requested = max(0, int(kb_requested or 0))
    safe_hits = max(0, int(kb_hits or 0))
    hit_rate = 0.0 if safe_requested <= 0 else _clamp(float(safe_hits) / float(safe_requested), 0.0, 1.0)
    avg_effect = _avg_effect_score(references)
    safe_score = float(run_score or 0)
    effect_delta = safe_score - avg_effect
    created_at = _utc_now()

    detail = {
        "references": references[:20],
        "strategy_version": str(strategy_version or "")[:80],
        "industry_tag": tag,
        "source": str(source or "run_dragon_team")[:64],
    }
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO industry_kb_run_metrics
                (tenant_id, user_id, trace_id, industry_tag, source, kb_hits, kb_requested, kb_hit_rate, run_score, avg_effect_score, effect_delta, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, trace_id) DO UPDATE SET
                user_id = excluded.user_id,
                industry_tag = excluded.industry_tag,
                source = excluded.source,
                kb_hits = excluded.kb_hits,
                kb_requested = excluded.kb_requested,
                kb_hit_rate = excluded.kb_hit_rate,
                run_score = excluded.run_score,
                avg_effect_score = excluded.avg_effect_score,
                effect_delta = excluded.effect_delta,
                detail_json = excluded.detail_json,
                created_at = excluded.created_at
            """,
            (
                tenant_id,
                user_id,
                str(trace_id or "")[:128],
                tag,
                str(source or "run_dragon_team")[:64],
                safe_hits,
                safe_requested,
                hit_rate,
                safe_score,
                avg_effect,
                effect_delta,
                json.dumps(detail, ensure_ascii=False),
                created_at,
            ),
        )

    _append_audit(
        tenant_id=tenant_id,
        industry_tag=tag,
        action="run_metrics_recorded",
        detail={
            "trace_id": str(trace_id or "")[:128],
            "kb_hits": safe_hits,
            "kb_requested": safe_requested,
            "industry_kb_hit_rate": hit_rate,
            "industry_kb_effect_delta": effect_delta,
            "avg_effect_score": avg_effect,
            "run_score": safe_score,
            "strategy_version": str(strategy_version or "")[:80],
        },
        actor_user_id=user_id,
    )
    return {
        "ok": True,
        "tenant_id": tenant_id,
        "user_id": user_id,
        "trace_id": str(trace_id or "")[:128],
        "industry_tag": tag,
        "source": str(source or "run_dragon_team")[:64],
        "industry_kb_hits": safe_hits,
        "industry_kb_requested": safe_requested,
        "industry_kb_hit_rate": hit_rate,
        "run_score": safe_score,
        "avg_effect_score": avg_effect,
        "industry_kb_effect_delta": effect_delta,
        "created_at": created_at,
        "references": references[:20],
    }


def metrics_dashboard(
    *,
    tenant_id: str,
    industry_tag: str | None = None,
    from_utc: str | None = None,
    to_utc: str | None = None,
    granularity: str = "day",
) -> dict[str, Any]:
    ensure_schema()
    params: list[Any] = [tenant_id]
    where = ["tenant_id = ?"]
    if industry_tag and str(industry_tag).strip():
        where.append("industry_tag = ?")
        params.append(normalize_industry_tag(industry_tag))
    if from_utc:
        where.append("created_at >= ?")
        params.append(str(from_utc))
    if to_utc:
        where.append("created_at <= ?")
        params.append(str(to_utc))
    where_sql = " AND ".join(where)
    bucket_expr = (
        "substr(created_at, 1, 13) || ':00:00Z'" if str(granularity).strip().lower() == "hour" else "substr(created_at, 1, 10) || 'T00:00:00Z'"
    )
    with _conn() as conn:
        summary_row = conn.execute(
            f"""
            SELECT
                COUNT(1) AS total_runs,
                SUM(CASE WHEN kb_hits > 0 THEN 1 ELSE 0 END) AS runs_with_hits,
                AVG(kb_hit_rate) AS avg_hit_rate,
                AVG(effect_delta) AS avg_effect_delta,
                AVG(run_score) AS avg_run_score,
                AVG(avg_effect_score) AS avg_reference_effect,
                AVG(kb_hits) AS avg_kb_hits
            FROM industry_kb_run_metrics
            WHERE {where_sql}
            """,
            tuple(params),
        ).fetchone()
        series_rows = conn.execute(
            f"""
            SELECT
                {bucket_expr} AS bucket,
                COUNT(1) AS total_runs,
                SUM(CASE WHEN kb_hits > 0 THEN 1 ELSE 0 END) AS runs_with_hits,
                AVG(kb_hit_rate) AS avg_hit_rate,
                AVG(effect_delta) AS avg_effect_delta,
                AVG(run_score) AS avg_run_score
            FROM industry_kb_run_metrics
            WHERE {where_sql}
            GROUP BY bucket
            ORDER BY bucket ASC
            """,
            tuple(params),
        ).fetchall()
    total_runs = int(summary_row["total_runs"] or 0) if summary_row else 0
    runs_with_hits = int(summary_row["runs_with_hits"] or 0) if summary_row else 0
    summary = {
        "total_runs": total_runs,
        "runs_with_hits": runs_with_hits,
        "industry_kb_hit_rate": (float(runs_with_hits) / float(total_runs)) if total_runs > 0 else 0.0,
        "industry_kb_hit_rate_avg": float(summary_row["avg_hit_rate"] or 0.0) if summary_row else 0.0,
        "industry_kb_effect_delta": float(summary_row["avg_effect_delta"] or 0.0) if summary_row else 0.0,
        "avg_run_score": float(summary_row["avg_run_score"] or 0.0) if summary_row else 0.0,
        "avg_reference_effect_score": float(summary_row["avg_reference_effect"] or 0.0) if summary_row else 0.0,
        "avg_kb_hits": float(summary_row["avg_kb_hits"] or 0.0) if summary_row else 0.0,
    }
    series = [
        {
            "bucket": str(row["bucket"]),
            "total_runs": int(row["total_runs"] or 0),
            "runs_with_hits": int(row["runs_with_hits"] or 0),
            "industry_kb_hit_rate": float(row["avg_hit_rate"] or 0.0),
            "industry_kb_effect_delta": float(row["avg_effect_delta"] or 0.0),
            "avg_run_score": float(row["avg_run_score"] or 0.0),
        }
        for row in series_rows
    ]
    return {
        "ok": True,
        "tenant_id": tenant_id,
        "industry_tag": normalize_industry_tag(industry_tag) if industry_tag else None,
        "from_utc": from_utc,
        "to_utc": to_utc,
        "granularity": "hour" if str(granularity).strip().lower() == "hour" else "day",
        "summary": summary,
        "series": series,
    }


def trace_snapshot(
    *,
    tenant_id: str,
    trace_id: str,
) -> dict[str, Any]:
    ensure_schema()
    safe_trace = str(trace_id or "").strip()
    if not safe_trace:
        return {"trace_id": safe_trace, "entries": [], "audit_events": [], "metrics": None}

    with _conn() as conn:
        entry_rows = conn.execute(
            """
            SELECT id, industry_tag, entry_type, title, source_url, source_account, effect_score, quality_score, created_at
            FROM industry_kb_entries
            WHERE tenant_id = ? AND trace_id = ?
            ORDER BY id DESC
            LIMIT 50
            """,
            (tenant_id, safe_trace),
        ).fetchall()
        metric_row = conn.execute(
            """
            SELECT tenant_id, user_id, trace_id, industry_tag, source, kb_hits, kb_requested, kb_hit_rate, run_score, avg_effect_score, effect_delta, detail_json, created_at
            FROM industry_kb_run_metrics
            WHERE tenant_id = ? AND trace_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (tenant_id, safe_trace),
        ).fetchone()
        audit_rows = conn.execute(
            """
            SELECT industry_tag, action, detail_json, actor_user_id, created_at
            FROM industry_kb_audit
            WHERE tenant_id = ?
            ORDER BY id DESC
            LIMIT 400
            """,
            (tenant_id,),
        ).fetchall()

    entries = [
        {
            "id": int(row["id"]),
            "industry_tag": str(row["industry_tag"]),
            "entry_type": str(row["entry_type"]),
            "title": str(row["title"]),
            "source_url": str(row["source_url"] or ""),
            "source_account": str(row["source_account"] or ""),
            "effect_score": float(row["effect_score"] or 0),
            "quality_score": float(row["quality_score"] or 0),
            "created_at": str(row["created_at"]),
        }
        for row in entry_rows
    ]

    metrics = None
    if metric_row is not None:
        detail = json.loads(metric_row["detail_json"] or "{}")
        metrics = {
            "tenant_id": str(metric_row["tenant_id"]),
            "user_id": str(metric_row["user_id"]),
            "trace_id": str(metric_row["trace_id"]),
            "industry_tag": str(metric_row["industry_tag"]),
            "source": str(metric_row["source"]),
            "industry_kb_hits": int(metric_row["kb_hits"] or 0),
            "industry_kb_requested": int(metric_row["kb_requested"] or 0),
            "industry_kb_hit_rate": float(metric_row["kb_hit_rate"] or 0),
            "run_score": float(metric_row["run_score"] or 0),
            "avg_effect_score": float(metric_row["avg_effect_score"] or 0),
            "industry_kb_effect_delta": float(metric_row["effect_delta"] or 0),
            "strategy_version": str(detail.get("strategy_version") or ""),
            "references": detail.get("references", []),
            "created_at": str(metric_row["created_at"]),
        }

    audit_events: list[dict[str, Any]] = []
    for row in audit_rows:
        try:
            detail = json.loads(row["detail_json"] or "{}")
        except json.JSONDecodeError:
            continue
        if str(detail.get("trace_id") or "").strip() != safe_trace:
            continue
        audit_events.append(
            {
                "industry_tag": str(row["industry_tag"]),
                "action": str(row["action"]),
                "detail": detail,
                "actor_user_id": str(row["actor_user_id"] or ""),
                "created_at": str(row["created_at"]),
            }
        )
        if len(audit_events) >= 50:
            break

    return {
        "trace_id": safe_trace,
        "entries": entries,
        "audit_events": audit_events,
        "metrics": metrics,
    }
