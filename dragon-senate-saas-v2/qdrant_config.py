from __future__ import annotations

import os
import re
import threading
import time
from collections import defaultdict
from typing import Any

from langchain_core.documents import Document


COLLECTION_NAME = "viral_formulas"

_init_lock = threading.Lock()
_vector_stores: dict[str, Any] = {}
_init_errors: dict[str, str] = {}
_memory_docs: dict[str, list[Document]] = defaultdict(list)
_client: Any | None = None
_embeddings: Any | None = None
_vector_dim: int | None = None
_binary_quantization_enabled: dict[str, bool] = {}
_binary_quantization_error: dict[str, str | None] = {}


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _sanitize_scope(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", value).strip("_").lower()
    return cleaned[:64] or "shared"


def _scope_key(user_id: str | None = None) -> str:
    raw = (user_id or "").strip()
    if not raw:
        return "shared"
    return _sanitize_scope(raw)


def _collection_for_scope(scope: str) -> str:
    base = os.getenv("QDRANT_COLLECTION_NAME", COLLECTION_NAME).strip() or COLLECTION_NAME
    per_user = _bool_env("QDRANT_PER_USER_COLLECTION", True)
    if not per_user or scope == "shared":
        return base
    collection = f"{base}__u_{scope}"
    return collection[:120]


def _doc_copy(doc: Document) -> Document:
    return Document(page_content=doc.page_content, metadata=dict(doc.metadata or {}))


def _resolve_embeddings() -> tuple[Any, int]:
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_key:
        from langchain_openai import OpenAIEmbeddings

        return OpenAIEmbeddings(model="text-embedding-3-small"), 1536

    try:
        from langchain_community.embeddings import HuggingFaceEmbeddings

        model_name = os.getenv(
            "LOCAL_EMBEDDING_MODEL",
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        )
        embedding_dim = int(os.getenv("LOCAL_EMBEDDING_DIM", "384"))
        return HuggingFaceEmbeddings(model_name=model_name), embedding_dim
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            "No real embedding backend is available. Set OPENAI_API_KEY or install sentence-transformers "
            "and configure LOCAL_EMBEDDING_MODEL."
        ) from exc


def _get_client() -> Any:
    global _client
    if _client is not None:
        return _client

    from qdrant_client import QdrantClient

    qdrant_url = os.getenv("QDRANT_URL", "http://127.0.0.1:6333").strip()
    qdrant_api_key = os.getenv("QDRANT_API_KEY", "").strip() or None
    prefer_grpc = _bool_env("QDRANT_PREFER_GRPC", False)
    _client = QdrantClient(
        url=qdrant_url,
        api_key=qdrant_api_key,
        prefer_grpc=prefer_grpc,
        timeout=5.0,
    )
    return _client


def _get_embeddings() -> tuple[Any, int]:
    global _embeddings
    global _vector_dim
    if _embeddings is not None and _vector_dim is not None:
        return _embeddings, _vector_dim

    embeddings, vector_dim = _resolve_embeddings()
    _embeddings = embeddings
    _vector_dim = vector_dim
    return _embeddings, _vector_dim


def _apply_binary_quantization(client: Any, collection: str) -> None:
    if not _bool_env("QDRANT_ENABLE_BINARY_QUANTIZATION", False):
        _binary_quantization_enabled[collection] = False
        _binary_quantization_error[collection] = None
        return

    try:
        from qdrant_client.http import models

        quantization_config = models.BinaryQuantization(
            binary=models.BinaryQuantizationConfig(always_ram=True),
        )
        client.update_collection(
            collection_name=collection,
            quantization_config=quantization_config,
        )
        _binary_quantization_enabled[collection] = True
        _binary_quantization_error[collection] = None
    except Exception as exc:  # noqa: BLE001
        _binary_quantization_enabled[collection] = False
        _binary_quantization_error[collection] = str(exc)


def _ensure_vector_store(scope: str) -> Any | None:
    collection = _collection_for_scope(scope)
    if collection in _vector_stores:
        return _vector_stores[collection]
    if collection in _init_errors:
        return None

    with _init_lock:
        if collection in _vector_stores:
            return _vector_stores[collection]
        if collection in _init_errors:
            return None

        try:
            from langchain_community.vectorstores import Qdrant
            from qdrant_client.http.models import Distance, VectorParams

            client = _get_client()
            embeddings, vector_dim = _get_embeddings()

            if not client.collection_exists(collection_name=collection):
                client.create_collection(
                    collection_name=collection,
                    vectors_config=VectorParams(size=vector_dim, distance=Distance.COSINE),
                )
            _apply_binary_quantization(client, collection)
            _vector_stores[collection] = Qdrant(
                client=client,
                collection_name=collection,
                embeddings=embeddings,
            )
        except Exception as exc:  # noqa: BLE001
            _init_errors[collection] = str(exc)
            _vector_stores[collection] = None

    return _vector_stores.get(collection)


def ingest_formula_documents(documents: list[Document], *, user_id: str | None = None) -> int:
    if not documents:
        return 0

    scope = _scope_key(user_id)
    now_ts = int(time.time())
    staged_docs: list[Document] = []
    for doc in documents:
        metadata = dict(doc.metadata or {})
        metadata.setdefault("scope", scope)
        metadata.setdefault("ingest_ts", now_ts)
        staged_docs.append(Document(page_content=doc.page_content, metadata=metadata))

    _memory_docs[scope].extend(_doc_copy(doc) for doc in staged_docs)
    vector_store = _ensure_vector_store(scope)
    if vector_store is None:
        return len(staged_docs)

    try:
        ids = vector_store.add_documents(staged_docs)
        return len(ids) if ids else len(staged_docs)
    except Exception:  # noqa: BLE001
        return len(staged_docs)


def _filter_docs(
    docs: list[Document],
    *,
    scope: str,
    category: str | None = None,
    min_ingest_ts: int | None = None,
) -> list[Document]:
    filtered: list[Document] = []
    for doc in docs:
        metadata = doc.metadata or {}
        if str(metadata.get("scope") or scope) != scope:
            continue
        if category and str(metadata.get("category")) != category:
            continue
        if min_ingest_ts is not None:
            ingest_ts = int(metadata.get("ingest_ts", 0) or 0)
            if ingest_ts < min_ingest_ts:
                continue
        filtered.append(doc)
    return filtered


def _score_text_match(query: str, text: str) -> float:
    q_tokens = {token for token in query.lower().split() if token}
    if not q_tokens:
        return 0.0
    t_tokens = {token for token in text.lower().split() if token}
    if not t_tokens:
        return 0.0
    return len(q_tokens & t_tokens) / len(q_tokens)


def search_formula_documents(
    query: str,
    *,
    k: int = 3,
    category: str | None = None,
    min_ingest_ts: int | None = None,
    user_id: str | None = None,
) -> list[Document]:
    scope = _scope_key(user_id)
    k = max(1, k)

    vector_store = _ensure_vector_store(scope)
    docs: list[Document] = []
    if vector_store is not None:
        try:
            docs = vector_store.similarity_search(query, k=max(k * 2, 8))
        except Exception:  # noqa: BLE001
            docs = []

    docs = _filter_docs(docs, scope=scope, category=category, min_ingest_ts=min_ingest_ts)
    if docs:
        return docs[:k]

    fallback = _filter_docs(_memory_docs[scope], scope=scope, category=category, min_ingest_ts=min_ingest_ts)
    ranked = sorted(
        fallback,
        key=lambda doc: _score_text_match(query, doc.page_content),
        reverse=True,
    )
    return ranked[:k]


def fetch_recent_formula_documents(
    *,
    limit: int = 20,
    since_hours: int = 24,
    user_id: str | None = None,
) -> list[Document]:
    cutoff = int(time.time()) - (max(1, since_hours) * 3600)
    docs = search_formula_documents(
        "latest viral formula trend",
        k=max(limit, 20),
        min_ingest_ts=cutoff,
        user_id=user_id,
    )
    docs.sort(key=lambda doc: int((doc.metadata or {}).get("ingest_ts", 0) or 0), reverse=True)
    return docs[: max(1, limit)]


def rag_status(*, user_id: str | None = None) -> dict[str, Any]:
    scope = _scope_key(user_id)
    collection = _collection_for_scope(scope)
    _ensure_vector_store(scope)
    return {
        "scope": scope,
        "collection_name": collection,
        "qdrant_enabled": _vector_stores.get(collection) is not None,
        "init_error": _init_errors.get(collection),
        "fallback_memory_size": len(_memory_docs[scope]),
        "binary_quantization_enabled": _binary_quantization_enabled.get(collection, False),
        "binary_quantization_error": _binary_quantization_error.get(collection),
    }
