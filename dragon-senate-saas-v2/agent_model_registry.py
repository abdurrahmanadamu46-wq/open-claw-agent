from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    raw = os.getenv("AGENT_MODEL_DB_PATH", "./data/agent_model_registry.sqlite").strip()
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


def _safe_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:  # noqa: BLE001
        return float(default)


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:  # noqa: BLE001
        return int(default)


def _mask_secret(secret: str) -> str:
    text = str(secret or "").strip()
    if not text:
        return ""
    if len(text) <= 8:
        return "*" * len(text)
    return f"{text[:4]}{'*' * (len(text) - 8)}{text[-4:]}"


def _normalize_local_model_name(model: str) -> str:
    normalized = str(model or "").strip()
    if not normalized:
        return normalized
    lowered = normalized.lower()
    if lowered == "qwen3.59b":
        return "qwen3:59b"
    return normalized


def _env_provider_defaults() -> dict[str, dict[str, Any]]:
    return {
        "local": {
            "provider_id": "local",
            "label": "Local (Ollama/OpenAI-Compatible)",
            "route": "local",
            "base_url": os.getenv("LOCAL_LLM_BASE_URL", "http://127.0.0.1:11434/v1").strip(),
            "default_model": os.getenv("LOCAL_LLM_MODEL", "qwen3:59b").strip(),
            "api_key": os.getenv("LOCAL_LLM_API_KEY", "ollama").strip() or "ollama",
        },
        "deepseek": {
            "provider_id": "deepseek",
            "label": "DeepSeek",
            "route": "cloud",
            "base_url": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").strip(),
            "default_model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat").strip(),
            "api_key": os.getenv("DEEPSEEK_API_KEY", "").strip(),
        },
        "dashscope": {
            "provider_id": "dashscope",
            "label": "DashScope",
            "route": "cloud",
            "base_url": os.getenv("CLOUD_LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").strip(),
            "default_model": os.getenv("CLOUD_LLM_MODEL", "qwen-flash").strip(),
            "api_key": os.getenv("DASHSCOPE_API_KEY", "").strip(),
        },
        "volcengine": {
            "provider_id": "volcengine",
            "label": "Volcengine Ark",
            "route": "cloud",
            "base_url": os.getenv("VOLCENGINE_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3").strip(),
            "default_model": os.getenv("VOLCENGINE_MODEL", "").strip(),
            "api_key": os.getenv("VOLCENGINE_API_KEY", "").strip(),
        },
        "openai": {
            "provider_id": "openai",
            "label": "OpenAI-Compatible",
            "route": "cloud",
            "base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip(),
            "default_model": os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip(),
            "api_key": os.getenv("OPENAI_API_KEY", "").strip(),
        },
        "custom": {
            "provider_id": "custom",
            "label": "Custom OpenAI-Compatible",
            "route": "cloud",
            "base_url": os.getenv("CUSTOM_LLM_BASE_URL", "").strip(),
            "default_model": os.getenv("CUSTOM_LLM_MODEL", "").strip(),
            "api_key": os.getenv("CUSTOM_LLM_API_KEY", "").strip(),
        },
    }


def _default_agent_bindings() -> dict[str, dict[str, Any]]:
    return {
        "radar": {"provider_id": "deepseek", "task_type": "radar_enrichment"},
        "strategist": {"provider_id": "deepseek", "task_type": "strategy_planning"},
        "inkwriter": {"provider_id": "deepseek", "task_type": "content_generation"},
        "visualizer": {"provider_id": "deepseek", "task_type": "visual_prompting"},
        "dispatcher": {"provider_id": "local", "task_type": "dispatch_routing"},
        "echoer": {"provider_id": "deepseek", "task_type": "engagement_copy"},
        "catcher": {"provider_id": "deepseek", "task_type": "intent_classification"},
        "abacus": {"provider_id": "local", "task_type": "lead_scoring"},
        "followup": {"provider_id": "deepseek", "task_type": "sales_followup"},
    }


def _task_type_agent_map() -> dict[str, str]:
    return {
        "strategy_planning": "strategist",
        "content_generation": "inkwriter",
        "engagement_copy": "echoer",
        "sales_followup": "followup",
        "dm_followup": "followup",
        "radar_enrichment": "radar",
        "visual_prompting": "visualizer",
        "dispatch_routing": "dispatcher",
        "lead_scoring": "abacus",
        "intent_classification": "catcher",
    }


def _provider_model_options() -> dict[str, list[str]]:
    return {
        "local": [
            "qwen3:59b",
            "qwen3.59b",
            "qwen3:8b",
            "qwen3:14b",
            "qwen2.5:72b-instruct",
            "deepseek-r1:8b",
            "deepseek-r1:14b",
            "llama3.1:8b",
            "llama3.3:70b",
            "mistral-small:24b",
            "gemma3:12b",
            "phi4:14b",
        ],
        "deepseek": [
            "deepseek-chat",
            "deepseek-reasoner",
        ],
        "dashscope": [
            "qwen-flash",
            "qwen-turbo",
            "qwen-plus",
            "qwen-max",
            "qwen-long",
            "qvq-max",
            "qwen-vl-max",
        ],
        "volcengine": [
            "doubao-1.5-lite-32k",
            "doubao-1.5-pro-32k",
            "doubao-seed-1.6",
            "deepseek-v3",
            "deepseek-r1",
            "kimi-k2",
            "glm-4.5",
        ],
        "openai": [
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4o",
            "gpt-4o-mini",
            "o3",
            "o4-mini",
        ],
        "custom": [
            "deepseek-chat",
            "deepseek-reasoner",
            "qwen-max",
            "qwen-plus",
            "gpt-4o-mini",
            "claude-3-5-sonnet",
            "gemini-2.5-pro",
            "glm-4.5",
            "kimi-k2",
        ],
    }


def ensure_schema() -> None:
    with _conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS provider_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                route TEXT NOT NULL DEFAULT 'cloud',
                base_url TEXT NOT NULL DEFAULT '',
                default_model TEXT NOT NULL DEFAULT '',
                api_key TEXT NOT NULL DEFAULT '',
                note TEXT,
                updated_by TEXT,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, provider_id)
            );
            CREATE INDEX IF NOT EXISTS idx_provider_configs_tenant
                ON provider_configs (tenant_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS agent_model_bindings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                task_type TEXT NOT NULL DEFAULT '',
                provider_id TEXT NOT NULL DEFAULT 'local',
                model_name TEXT NOT NULL DEFAULT '',
                temperature REAL NOT NULL DEFAULT 0.3,
                max_tokens INTEGER NOT NULL DEFAULT 0,
                note TEXT,
                updated_by TEXT,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, agent_id)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_model_bindings_tenant
                ON agent_model_bindings (tenant_id, updated_at DESC);
            """
        )


def list_provider_configs(*, tenant_id: str) -> list[dict[str, Any]]:
    ensure_schema()
    defaults = _env_provider_defaults()
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT provider_id, enabled, route, base_url, default_model, api_key, note, updated_by, updated_at
            FROM provider_configs
            WHERE tenant_id = ?
            """,
            (tenant_id,),
        ).fetchall()
    custom = {str(row["provider_id"]): row for row in rows}
    output: list[dict[str, Any]] = []
    for provider_id, default in defaults.items():
        row = custom.get(provider_id)
        if row is None:
            output.append(
                {
                    "provider_id": provider_id,
                    "label": default.get("label", provider_id),
                    "enabled": bool(default.get("api_key")) or provider_id == "local",
                    "route": default.get("route", "cloud"),
                    "base_url": default.get("base_url", ""),
                    "default_model": default.get("default_model", ""),
                    "api_key_masked": _mask_secret(str(default.get("api_key", ""))),
                    "api_key_configured": bool(str(default.get("api_key", "")).strip()),
                    "source": "env_default",
                    "updated_at": None,
                    "updated_by": None,
                    "note": None,
                }
            )
        else:
            api_key = str(row["api_key"] or "").strip()
            output.append(
                {
                    "provider_id": provider_id,
                    "label": default.get("label", provider_id),
                    "enabled": bool(int(row["enabled"] or 0)),
                    "route": str(row["route"] or default.get("route", "cloud")).strip().lower(),
                    "base_url": str(row["base_url"] or default.get("base_url", "")).strip(),
                    "default_model": str(row["default_model"] or default.get("default_model", "")).strip(),
                    "api_key_masked": _mask_secret(api_key),
                    "api_key_configured": bool(api_key),
                    "source": "tenant_override",
                    "updated_at": str(row["updated_at"] or ""),
                    "updated_by": str(row["updated_by"] or ""),
                    "note": str(row["note"] or ""),
                }
            )
    return output


def upsert_provider_config(
    *,
    tenant_id: str,
    provider_id: str,
    enabled: bool,
    route: str,
    base_url: str,
    default_model: str,
    api_key: str | None,
    note: str | None = None,
    updated_by: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now()
    provider_key = str(provider_id).strip().lower()
    if not provider_key:
        raise ValueError("provider_id required")
    route_value = str(route or "cloud").strip().lower()
    if route_value not in {"local", "cloud"}:
        route_value = "cloud"
    with _conn() as conn:
        existing = conn.execute(
            """
            SELECT api_key FROM provider_configs
            WHERE tenant_id = ? AND provider_id = ?
            """,
            (tenant_id, provider_key),
        ).fetchone()
        previous_key = str(existing["api_key"] or "").strip() if existing else ""
        final_key = str(api_key or "").strip() if api_key is not None else previous_key
        conn.execute(
            """
            INSERT INTO provider_configs
                (tenant_id, provider_id, enabled, route, base_url, default_model, api_key, note, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, provider_id) DO UPDATE SET
                enabled=excluded.enabled,
                route=excluded.route,
                base_url=excluded.base_url,
                default_model=excluded.default_model,
                api_key=excluded.api_key,
                note=excluded.note,
                updated_by=excluded.updated_by,
                updated_at=excluded.updated_at
            """,
            (
                tenant_id,
                provider_key,
                1 if enabled else 0,
                route_value,
                str(base_url or "").strip(),
                _normalize_local_model_name(default_model) if provider_key == "local" else str(default_model or "").strip(),
                final_key,
                str(note or "").strip(),
                str(updated_by or "").strip(),
                now,
            ),
        )
    providers = list_provider_configs(tenant_id=tenant_id)
    row = next((item for item in providers if item.get("provider_id") == provider_key), None)
    return row or {
        "provider_id": provider_key,
        "enabled": bool(enabled),
        "route": route_value,
        "base_url": str(base_url or "").strip(),
        "default_model": str(default_model or "").strip(),
        "api_key_masked": _mask_secret(final_key),
        "api_key_configured": bool(final_key),
    }


def list_agent_bindings(*, tenant_id: str) -> list[dict[str, Any]]:
    ensure_schema()
    defaults = _default_agent_bindings()
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT agent_id, enabled, task_type, provider_id, model_name, temperature, max_tokens, note, updated_by, updated_at
            FROM agent_model_bindings
            WHERE tenant_id = ?
            """,
            (tenant_id,),
        ).fetchall()
    custom = {str(row["agent_id"]): row for row in rows}
    output: list[dict[str, Any]] = []
    for agent_id, default in defaults.items():
        row = custom.get(agent_id)
        if row is None:
            output.append(
                {
                    "agent_id": agent_id,
                    "enabled": True,
                    "task_type": default.get("task_type", ""),
                    "provider_id": default.get("provider_id", "local"),
                    "model_name": "",
                    "temperature": 0.3,
                    "max_tokens": 0,
                    "note": "",
                    "updated_by": "",
                    "updated_at": None,
                    "source": "default",
                }
            )
        else:
            output.append(
                {
                    "agent_id": agent_id,
                    "enabled": bool(int(row["enabled"] or 0)),
                    "task_type": str(row["task_type"] or default.get("task_type", "")).strip(),
                    "provider_id": str(row["provider_id"] or default.get("provider_id", "local")).strip().lower(),
                    "model_name": str(row["model_name"] or "").strip(),
                    "temperature": _safe_float(row["temperature"], 0.3),
                    "max_tokens": _safe_int(row["max_tokens"], 0),
                    "note": str(row["note"] or ""),
                    "updated_by": str(row["updated_by"] or ""),
                    "updated_at": str(row["updated_at"] or ""),
                    "source": "tenant_override",
                }
            )
    return output


def upsert_agent_binding(
    *,
    tenant_id: str,
    agent_id: str,
    enabled: bool,
    task_type: str,
    provider_id: str,
    model_name: str,
    temperature: float,
    max_tokens: int,
    note: str | None = None,
    updated_by: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now()
    agent_key = str(agent_id).strip().lower()
    if not agent_key:
        raise ValueError("agent_id required")
    provider_key = str(provider_id).strip().lower()
    if not provider_key:
        raise ValueError("provider_id required")
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO agent_model_bindings
                (tenant_id, agent_id, enabled, task_type, provider_id, model_name, temperature, max_tokens, note, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, agent_id) DO UPDATE SET
                enabled=excluded.enabled,
                task_type=excluded.task_type,
                provider_id=excluded.provider_id,
                model_name=excluded.model_name,
                temperature=excluded.temperature,
                max_tokens=excluded.max_tokens,
                note=excluded.note,
                updated_by=excluded.updated_by,
                updated_at=excluded.updated_at
            """,
            (
                tenant_id,
                agent_key,
                1 if enabled else 0,
                str(task_type or "").strip(),
                provider_key,
                _normalize_local_model_name(model_name) if provider_key == "local" else str(model_name or "").strip(),
                max(0.0, min(float(temperature), 2.0)),
                max(0, int(max_tokens)),
                str(note or "").strip(),
                str(updated_by or "").strip(),
                now,
            ),
        )
    bindings = list_agent_bindings(tenant_id=tenant_id)
    row = next((item for item in bindings if item.get("agent_id") == agent_key), None)
    return row or {
        "agent_id": agent_key,
        "enabled": bool(enabled),
        "task_type": str(task_type or "").strip(),
        "provider_id": provider_key,
        "model_name": str(model_name or "").strip(),
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }


def resolve_binding_for_task(*, tenant_id: str, task_type: str) -> dict[str, Any] | None:
    ensure_schema()
    task_key = str(task_type or "").strip().lower()
    if not task_key:
        return None
    agent_id = _task_type_agent_map().get(task_key)
    if not agent_id:
        return None

    bindings = list_agent_bindings(tenant_id=tenant_id)
    providers = {row["provider_id"]: row for row in list_provider_configs(tenant_id=tenant_id)}
    binding = next((row for row in bindings if row.get("agent_id") == agent_id), None)
    if not binding or not bool(binding.get("enabled", True)):
        return None
    provider_id = str(binding.get("provider_id", "")).strip().lower()
    provider = providers.get(provider_id)
    if not provider or not bool(provider.get("enabled", False)):
        return None

    model_name = str(binding.get("model_name") or provider.get("default_model") or "").strip()
    if provider_id == "local":
        model_name = _normalize_local_model_name(model_name)
    base_url = str(provider.get("base_url") or "").strip()
    route = str(provider.get("route") or "cloud").strip().lower()
    if route not in {"local", "cloud"}:
        route = "cloud"
    if not model_name or not base_url:
        return None

    # pull plaintext key from db if tenant override exists, else env default
    api_key = ""
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT api_key
            FROM provider_configs
            WHERE tenant_id = ? AND provider_id = ?
            """,
            (tenant_id, provider_id),
        ).fetchone()
    if row is not None:
        api_key = str(row["api_key"] or "").strip()
    if not api_key:
        defaults = _env_provider_defaults()
        api_key = str((defaults.get(provider_id) or {}).get("api_key") or "").strip()

    if route == "cloud" and not api_key:
        return None
    if route == "local" and not api_key:
        api_key = "ollama"

    return {
        "agent_id": agent_id,
        "task_type": task_key,
        "provider_id": provider_id,
        "route": route,
        "model_name": model_name,
        "base_url": base_url,
        "api_key": api_key,
        "temperature": _safe_float(binding.get("temperature"), 0.3),
        "max_tokens": _safe_int(binding.get("max_tokens"), 0),
    }


def catalog() -> dict[str, Any]:
    model_options = _provider_model_options()
    return {
        "agents": list(_default_agent_bindings().keys()),
        "task_type_agent_map": _task_type_agent_map(),
        "hot_models": [
            "qwen3:59b",
            "deepseek-chat",
            "deepseek-reasoner",
            "qwen-flash",
            "qwen-plus",
            "qwen-max",
            "gpt-4o-mini",
            "gpt-4.1",
            "o3",
            "doubao-1.5-pro-32k",
            "glm-4.5",
            "kimi-k2",
        ],
        "providers": [
            {
                "provider_id": row["provider_id"],
                "label": row["label"],
                "route": row["route"],
                "base_url": row["base_url"],
                "default_model": row["default_model"],
                "model_options": model_options.get(str(row["provider_id"]), []),
            }
            for row in _env_provider_defaults().values()
        ],
    }
