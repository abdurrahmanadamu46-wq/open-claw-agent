from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from langchain_core.documents import Document


_STATE_LOCK = asyncio.Lock()
_RUNTIME_STATES: dict[str, dict[str, Any]] = {}
_INSERT_FINGERPRINTS: dict[str, set[str]] = {}


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _rag_enabled() -> bool:
    return _bool_env("RAG_ANYTHING_ENABLED", False)


def _strict_runtime_mode() -> bool:
    return _bool_env("RAG_ANYTHING_RUNTIME_STRICT", False)


def _scope_key(user_id: str | None = None) -> str:
    if not user_id:
        return "shared"
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", user_id.strip().lower()).strip("_")
    return cleaned[:64] or "shared"


def _scope_state(scope: str) -> dict[str, Any]:
    return _RUNTIME_STATES.setdefault(
        scope,
        {
            "initialized": False,
            "runtime": None,
            "error": None,
            "mode": "fallback_disabled",
            "workdir": "",
            "inserted_records": 0,
            "last_query_at": None,
            "last_query_mode": None,
            "last_used_query_mode": None,
        },
    )


def _scope_fingerprints(scope: str) -> set[str]:
    return _INSERT_FINGERPRINTS.setdefault(scope, set())


def _resolve_api_key() -> str:
    return (
        os.getenv("RAG_ANYTHING_LLM_API_KEY", "").strip()
        or os.getenv("OPENAI_API_KEY", "").strip()
        or os.getenv("DASHSCOPE_API_KEY", "").strip()
    )


def _resolve_llm_base_url() -> str:
    return (
        os.getenv("RAG_ANYTHING_LLM_BASE_URL", "").strip()
        or os.getenv("CLOUD_LLM_BASE_URL", "").strip()
        or "https://api.openai.com/v1"
    )


def _resolve_embedding_base_url() -> str:
    return (
        os.getenv("RAG_ANYTHING_EMBED_BASE_URL", "").strip()
        or os.getenv("RAG_ANYTHING_LLM_BASE_URL", "").strip()
        or os.getenv("CLOUD_LLM_BASE_URL", "").strip()
        or "https://api.openai.com/v1"
    )


def _resolve_workdir(scope: str) -> str:
    base = os.getenv("RAG_ANYTHING_WORKDIR", "./raganything_workdir").strip() or "./raganything_workdir"
    workdir = Path(base) / scope
    workdir.mkdir(parents=True, exist_ok=True)
    return str(workdir)


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def _create_runtime(scope: str) -> tuple[Any | None, str | None]:
    try:
        from raganything import RAGAnything  # type: ignore
        from lightrag import LightRAG  # type: ignore
        from lightrag.llm.openai import openai_complete_if_cache, openai_embed  # type: ignore
        from lightrag.utils import EmbeddingFunc  # type: ignore
    except Exception as exc:  # noqa: BLE001
        return None, f"import_error:{exc}"

    api_key = _resolve_api_key()
    if not api_key:
        return None, "missing_api_key"

    llm_model_name = os.getenv("RAG_ANYTHING_LLM_MODEL", "").strip() or os.getenv("CLOUD_LLM_MODEL", "qwen-flash")
    embed_model_name = os.getenv("RAG_ANYTHING_EMBED_MODEL", "").strip() or "text-embedding-3-small"
    embedding_dim = int(os.getenv("RAG_ANYTHING_EMBED_DIM", "1536"))
    embed_max_tokens = int(os.getenv("RAG_ANYTHING_EMBED_MAX_TOKENS", "8192"))
    llm_base_url = _resolve_llm_base_url()
    embed_base_url = _resolve_embedding_base_url()
    working_dir = _resolve_workdir(scope)

    embedding_func = EmbeddingFunc(
        embedding_dim=embedding_dim,
        max_token_size=embed_max_tokens,
        func=lambda texts: openai_embed(
            texts,
            model=embed_model_name,
            api_key=api_key,
            base_url=embed_base_url,
        ),
    )

    lightrag = LightRAG(
        working_dir=working_dir,
        llm_model_func=openai_complete_if_cache,
        llm_model_name=llm_model_name,
        llm_model_kwargs={"api_key": api_key, "base_url": llm_base_url},
        embedding_func=embedding_func,
    )

    try:
        rag = RAGAnything(lightrag=lightrag)
    except TypeError:
        rag = RAGAnything(light_rag=lightrag)

    if hasattr(rag, "create_indexes"):
        await _maybe_await(rag.create_indexes())

    try:
        from lightrag.kg.shared_storage import initialize_pipeline_status  # type: ignore

        await _maybe_await(initialize_pipeline_status())
    except Exception:
        pass

    return rag, None


async def _ensure_runtime(user_id: str | None = None) -> tuple[Any | None, str]:
    scope = _scope_key(user_id)
    state = _scope_state(scope)
    if not _rag_enabled():
        state.update(
            {
                "initialized": True,
                "runtime": None,
                "error": None,
                "mode": "fallback_disabled",
                "workdir": _resolve_workdir(scope),
            }
        )
        return None, "fallback_disabled"

    if state.get("initialized") and state.get("runtime") is not None:
        return state.get("runtime"), "raganything_runtime"

    async with _STATE_LOCK:
        state = _scope_state(scope)
        if state.get("initialized") and state.get("runtime") is not None:
            return state.get("runtime"), "raganything_runtime"
        rag, error = await _create_runtime(scope)
        state["initialized"] = True
        state["runtime"] = rag
        state["error"] = error
        state["workdir"] = _resolve_workdir(scope)
        if rag is not None:
            state["mode"] = "raganything_runtime"
            return rag, "raganything_runtime"
        if _strict_runtime_mode():
            state["mode"] = "strict_runtime_unavailable"
            return None, "strict_runtime_unavailable"
        state["mode"] = "fallback_runtime_unavailable"
        return None, "fallback_runtime_unavailable"


def raganything_status(*, user_id: str | None = None) -> dict[str, Any]:
    scope = _scope_key(user_id)
    state = _scope_state(scope)
    enabled = _rag_enabled()
    strict_mode = _strict_runtime_mode()
    try:
        import raganything  # type: ignore  # noqa: F401

        installed = True
        import_error = None
    except Exception as exc:  # noqa: BLE001
        installed = False
        import_error = str(exc)

    runtime_ready = bool(state.get("runtime"))
    mode = str(state.get("mode", "fallback_disabled"))
    if enabled and installed and runtime_ready:
        mode = "raganything_runtime"
    elif enabled and installed and not runtime_ready:
        mode = "strict_runtime_unavailable" if strict_mode else "runtime_not_initialized"
    elif enabled and not installed:
        mode = "strict_runtime_unavailable" if strict_mode else "fallback_no_package"
    elif not enabled:
        mode = "fallback_disabled"

    return {
        "scope": scope,
        "enabled": enabled,
        "strict_mode": strict_mode,
        "installed": installed,
        "mode": mode,
        "runtime_ready": runtime_ready,
        "error": state.get("error") or import_error,
        "workdir": state.get("workdir") or _resolve_workdir(scope),
        "inserted_records": int(state.get("inserted_records", 0) or 0),
        "last_query_mode": state.get("last_query_mode"),
        "last_used_query_mode": state.get("last_used_query_mode"),
        "last_query_at": state.get("last_query_at"),
    }


def _normalize_modality(value: str) -> str:
    v = (value or "").strip().lower()
    if v in {"image", "table", "equation", "text", "audio", "video"}:
        return v
    return "text"


def _safe_asset_id(raw: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", raw or "").strip("_")
    return cleaned[:80] or "asset"


def _fingerprint(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def collect_multimodal_assets(
    handles: list[str],
    radar_data: dict[str, Any],
) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    source_assets = radar_data.get("multimodal_assets")
    if isinstance(source_assets, list):
        for idx, item in enumerate(source_assets):
            if not isinstance(item, dict):
                continue
            modality = _normalize_modality(str(item.get("modality", "text")))
            source = str(item.get("source") or item.get("source_url") or "").strip()
            content = str(item.get("content") or item.get("summary") or "").strip()
            if not source and not content:
                continue
            assets.append(
                {
                    "asset_id": str(item.get("asset_id") or f"asset_{idx + 1}"),
                    "modality": modality,
                    "source": source,
                    "content": content,
                    "metadata": item.get("metadata", {}) if isinstance(item.get("metadata"), dict) else {},
                }
            )

    if assets:
        return assets[:30]

    for idx, handle in enumerate(handles[:10]):
        handle_norm = handle.strip() or f"handle_{idx + 1}"
        is_url = handle_norm.startswith("http://") or handle_norm.startswith("https://")
        base_meta = {"handle": handle_norm, "generated": True}
        assets.append(
            {
                "asset_id": f"{_safe_asset_id(handle_norm)}_img",
                "modality": "image",
                "source": handle_norm if is_url else "",
                "content": f"Screenshot narrative from competitor source {handle_norm}",
                "metadata": {**base_meta, "kind": "screenshot"},
            }
        )
        assets.append(
            {
                "asset_id": f"{_safe_asset_id(handle_norm)}_tbl",
                "modality": "table",
                "source": handle_norm if is_url else "",
                "content": "Engagement table with fields: hook, retention_peak, cta_position, conversion_hint",
                "metadata": {**base_meta, "kind": "engagement_table"},
            }
        )
    return assets


def enrich_formulas_with_multimodal(
    formulas: list[dict[str, Any]],
    assets: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    status = raganything_status()
    mode = status["mode"]
    by_handle: dict[str, list[dict[str, Any]]] = {}
    for asset in assets:
        metadata = asset.get("metadata", {}) if isinstance(asset.get("metadata"), dict) else {}
        handle = str(metadata.get("handle") or "").strip()
        if not handle:
            handle = str(asset.get("source") or "").strip()
        by_handle.setdefault(handle, []).append(asset)

    links: list[dict[str, Any]] = []
    enriched: list[dict[str, Any]] = []
    for formula in formulas:
        handle = str(formula.get("source_url") or formula.get("source_account") or "").strip()
        related_assets = by_handle.get(handle, [])
        modalities = sorted({str(a.get("modality", "text")) for a in related_assets})
        cross_modal_score = min(1.0, 0.35 + 0.2 * len(modalities))
        formula_out = {
            **formula,
            "multimodal_signals": modalities,
            "cross_modal_score": round(cross_modal_score, 3),
            "rag_mode": mode,
        }
        enriched.append(formula_out)

        for asset in related_assets[:8]:
            links.append(
                {
                    "source_account": formula.get("source_account"),
                    "formula_category": formula.get("category"),
                    "asset_id": asset.get("asset_id"),
                    "modality": asset.get("modality"),
                    "relation": "supports_formula",
                }
            )

    return enriched, links, mode


def build_multimodal_documents(
    formulas: list[dict[str, Any]],
    assets: list[dict[str, Any]],
) -> list[Document]:
    now_ts = int(datetime.now(timezone.utc).timestamp())
    docs: list[Document] = []
    for formula in formulas:
        docs.append(
            Document(
                page_content=(
                    f"Formula {formula.get('source_account')} | category={formula.get('category')} | "
                    f"hook={formula.get('hook_type')} | structure={formula.get('content_structure')} | "
                    f"cta={formula.get('cta')} | multimodal={','.join(formula.get('multimodal_signals', []))}"
                ),
                metadata={
                    "kind": "formula_multimodal_bridge",
                    "category": formula.get("category", "unknown"),
                    "account": formula.get("source_account", "unknown"),
                    "source_url": formula.get("source_url"),
                    "effect_score": float(formula.get("effect_score", 0) or 0),
                    "ingest_ts": now_ts,
                    "modality_count": len(formula.get("multimodal_signals", [])),
                },
            )
        )
    for asset in assets:
        metadata = asset.get("metadata", {}) if isinstance(asset.get("metadata"), dict) else {}
        docs.append(
            Document(
                page_content=(
                    f"Asset {asset.get('asset_id')} [{asset.get('modality')}] "
                    f"source={asset.get('source')} content={asset.get('content')}"
                ),
                metadata={
                    "kind": "multimodal_asset",
                    "modality": asset.get("modality", "text"),
                    "source": asset.get("source"),
                    "asset_id": asset.get("asset_id"),
                    "account": metadata.get("handle"),
                    "ingest_ts": now_ts,
                },
            )
        )
    return docs


async def _try_insert_text(runtime: Any, text: str) -> bool:
    candidates = [runtime, getattr(runtime, "lightrag", None), getattr(runtime, "light_rag", None)]
    for obj in candidates:
        if obj is None:
            continue
        for method_name in ("ainsert", "insert", "add_text", "ingest_text"):
            method = getattr(obj, method_name, None)
            if method is None:
                continue
            try:
                await _maybe_await(method(text))
                return True
            except Exception:
                continue
    return False


async def ingest_raganything_runtime(
    formulas: list[dict[str, Any]],
    assets: list[dict[str, Any]],
    *,
    user_id: str | None = None,
) -> dict[str, Any]:
    scope = _scope_key(user_id)
    runtime, mode = await _ensure_runtime(user_id)
    state = _scope_state(scope)
    if runtime is None:
        strict_mode = _strict_runtime_mode()
        return {
            "scope": scope,
            "mode": mode,
            "runtime_ingested": 0,
            "runtime_file_ingested": 0,
            "runtime_text_ingested": 0,
            "error": state.get("error"),
            "fail_closed": bool(strict_mode and _rag_enabled()),
        }

    file_ingested = 0
    text_ingested = 0
    errors: list[str] = []
    fingerprints = _scope_fingerprints(scope)

    for asset in assets:
        source = str(asset.get("source") or "").strip()
        if not source or source.startswith("http://") or source.startswith("https://"):
            continue
        path = Path(source)
        if not path.exists() or not path.is_file():
            continue
        process_method = getattr(runtime, "process_document_complete", None)
        if process_method is None:
            break
        try:
            await _maybe_await(process_method(str(path)))
            file_ingested += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"process_document_complete:{exc}")

    text_records: list[str] = []
    for formula in formulas:
        text_records.append(
            json.dumps(
                {
                    "type": "formula",
                    "source_account": formula.get("source_account"),
                    "category": formula.get("category"),
                    "hook_type": formula.get("hook_type"),
                    "content_structure": formula.get("content_structure"),
                    "cta": formula.get("cta"),
                    "effect_score": formula.get("effect_score"),
                    "multimodal_signals": formula.get("multimodal_signals", []),
                    "scope": scope,
                },
                ensure_ascii=False,
            )
        )
    for asset in assets:
        text_records.append(
            json.dumps(
                {
                    "type": "asset",
                    "asset_id": asset.get("asset_id"),
                    "modality": asset.get("modality"),
                    "source": asset.get("source"),
                    "content": asset.get("content"),
                    "metadata": asset.get("metadata", {}),
                    "scope": scope,
                },
                ensure_ascii=False,
            )
        )

    for record in text_records:
        fp = _fingerprint(record)
        if fp in fingerprints:
            continue
        ok = await _try_insert_text(runtime, record)
        if ok:
            fingerprints.add(fp)
            text_ingested += 1
        else:
            errors.append("insert_text:no_supported_method")
            break

    total = file_ingested + text_ingested
    state["inserted_records"] = int(state.get("inserted_records", 0) or 0) + total
    return {
        "scope": scope,
        "mode": mode,
        "runtime_ingested": total,
        "runtime_file_ingested": file_ingested,
        "runtime_text_ingested": text_ingested,
        "error": "; ".join(errors[:3]) if errors else None,
        "fail_closed": False,
    }


def _extract_graph_refs(raw: Any, *, top_k: int) -> list[dict[str, Any]]:
    candidates: list[Any] = []
    if isinstance(raw, dict):
        candidates.extend([raw.get("references"), raw.get("entities"), raw.get("nodes"), raw.get("chunks"), raw.get("context")])
    refs: list[dict[str, Any]] = []
    for block in candidates:
        if not isinstance(block, list):
            continue
        for item in block:
            if len(refs) >= max(1, top_k):
                return refs
            if isinstance(item, dict):
                refs.append(
                    {
                        "category": str(item.get("category") or item.get("type") or "graph"),
                        "account": str(item.get("account") or item.get("id") or item.get("name") or "graph_node"),
                        "source": "raganything_graph",
                        "score": item.get("score"),
                    }
                )
            else:
                refs.append(
                    {
                        "category": "graph",
                        "account": str(item),
                        "source": "raganything_graph",
                    }
                )
    return refs


async def query_raganything_hybrid(query: str, top_k: int = 4, *, user_id: str | None = None) -> dict[str, Any]:
    scope = _scope_key(user_id)
    runtime, mode = await _ensure_runtime(user_id)
    state = _scope_state(scope)
    if runtime is None:
        strict_mode = _strict_runtime_mode()
        return {
            "scope": scope,
            "mode": mode,
            "enabled": False,
            "answer": "",
            "graph_refs": [],
            "error": state.get("error"),
            "fail_closed": bool(strict_mode and _rag_enabled()),
        }

    answer_text = ""
    graph_refs: list[dict[str, Any]] = []
    query_mode = os.getenv("RAG_ANYTHING_QUERY_MODE", "hybrid,mix,local,naive").strip() or "hybrid"
    mode_chain = [m.strip() for m in query_mode.split(",") if m.strip()]
    if not mode_chain:
        mode_chain = ["hybrid"]

    try:
        raw: Any = None
        used_mode = ""
        for mode_candidate in mode_chain:
            try:
                from lightrag import QueryParam  # type: ignore

                param = QueryParam(mode=mode_candidate)
                raw = await _maybe_await(runtime.aquery(query, param=param))
                used_mode = mode_candidate
                break
            except Exception:
                continue
        if raw is None:
            raw = await _maybe_await(runtime.aquery(query))
            used_mode = "default"

        if isinstance(raw, dict):
            answer_text = str(raw.get("answer") or raw.get("result") or raw.get("response") or "").strip()
            graph_refs = _extract_graph_refs(raw, top_k=top_k)
        else:
            answer_text = str(raw).strip()
            used_mode = "text_response"
    except Exception as exc:  # noqa: BLE001
        return {
            "scope": scope,
            "mode": mode,
            "enabled": False,
            "answer": "",
            "graph_refs": [],
            "error": str(exc),
            "fail_closed": False,
        }

    if answer_text and not graph_refs:
        graph_refs.append(
            {
                "category": "graph_hybrid",
                "account": "raganything_summary",
                "source": "raganything_graph",
            }
        )

    state["last_query_mode"] = query_mode
    state["last_used_query_mode"] = used_mode
    state["last_query_at"] = datetime.now(timezone.utc).isoformat()

    return {
        "scope": scope,
        "mode": mode,
        "enabled": True,
        "answer": answer_text[:1800],
        "graph_refs": graph_refs[: max(1, top_k)],
        "error": None,
        "query_mode_chain": mode_chain,
        "used_query_mode": used_mode,
        "fail_closed": False,
    }

