"""
Lightweight knowledge base manager for lobster-bound document collections.
"""

from __future__ import annotations

import json
import hashlib
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
import importlib.util
import sys
from pathlib import Path
from typing import Any

DB_PATH = Path(os.getenv("KNOWLEDGE_BASE_DB", "./data/knowledge_base.sqlite"))


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class KnowledgeBaseManager:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS knowledge_bases (
                    kb_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS knowledge_base_bindings (
                    kb_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    PRIMARY KEY (kb_id, lobster_id)
                );
                CREATE TABLE IF NOT EXISTS knowledge_base_docs (
                    doc_id TEXT PRIMARY KEY,
                    kb_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    content TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    checksum TEXT NOT NULL,
                    chunk_count INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
                    chunk_id TEXT PRIMARY KEY,
                    kb_id TEXT NOT NULL,
                    doc_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_kb_tenant ON knowledge_bases(tenant_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_kb_chunks ON knowledge_base_chunks(kb_id, tenant_id, chunk_index);
                """
            )
            cols = {str(row[1]) for row in conn.execute("PRAGMA table_info(knowledge_base_docs)").fetchall()}
            if "metadata_json" not in cols:
                conn.execute("ALTER TABLE knowledge_base_docs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'")
            conn.commit()

    async def create(self, name: str, tenant_id: str) -> dict[str, Any]:
        kb_id = f"kb_{uuid.uuid4().hex[:12]}"
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO knowledge_bases(kb_id, name, tenant_id, created_at) VALUES (?, ?, ?, ?)",
                (kb_id, str(name).strip()[:200], tenant_id, _utc_now()),
            )
            conn.commit()
        return self.get(kb_id) or {}

    def list_all(self, tenant_id: str) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT kb.kb_id, kb.name, kb.tenant_id, kb.created_at, COUNT(DISTINCT d.doc_id) AS doc_count
                FROM knowledge_bases kb
                LEFT JOIN knowledge_base_docs d ON d.kb_id = kb.kb_id
                WHERE kb.tenant_id=?
                GROUP BY kb.kb_id
                ORDER BY kb.created_at DESC
                """,
                (tenant_id,),
            ).fetchall()
        items = []
        for row in rows:
            item = dict(row)
            item["bound_lobsters"] = self.list_bound_lobsters(str(row["kb_id"]))
            items.append(item)
        return items

    def get(self, kb_id: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT kb.kb_id, kb.name, kb.tenant_id, kb.created_at, COUNT(DISTINCT d.doc_id) AS doc_count
                FROM knowledge_bases kb
                LEFT JOIN knowledge_base_docs d ON d.kb_id = kb.kb_id
                WHERE kb.kb_id=?
                GROUP BY kb.kb_id
                """,
                (kb_id,),
            ).fetchone()
        if row is None:
            return None
        item = dict(row)
        item["bound_lobsters"] = self.list_bound_lobsters(kb_id)
        item["documents"] = self.list_docs(kb_id)
        return item

    async def upload_doc(self, kb_id: str, filename: str, file_bytes: bytes, tenant_id: str = "") -> dict[str, Any]:
        from file_loader import LobsterFileLoader

        loaded = await LobsterFileLoader().load(filename, file_bytes=file_bytes)
        content = str(loaded.raw_text or "").strip() or self._decode_content(file_bytes)
        chunks = self._split_into_chunks(content)
        checksum = hashlib.sha1(file_bytes).hexdigest()
        doc_id = f"doc_{uuid.uuid4().hex[:12]}"
        created_at = _utc_now()
        with self._conn() as conn:
            kb = conn.execute("SELECT tenant_id FROM knowledge_bases WHERE kb_id=?", (kb_id,)).fetchone()
            if kb is None:
                raise KeyError("knowledge_base_not_found")
            effective_tenant = tenant_id or str(kb["tenant_id"])
            conn.execute(
                """
                INSERT INTO knowledge_base_docs(doc_id, kb_id, filename, content, metadata_json, checksum, chunk_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    doc_id,
                    kb_id,
                    filename[:255],
                    content,
                    json.dumps(
                        {
                            "file_type": loaded.file_type,
                            "metadata": loaded.metadata,
                            "structured_data": loaded.structured_data,
                            "extraction_quality": loaded.extraction_quality,
                        },
                        ensure_ascii=False,
                    ),
                    checksum,
                    len(chunks),
                    created_at,
                ),
            )
            for index, chunk in enumerate(chunks):
                conn.execute(
                    """
                    INSERT INTO knowledge_base_chunks(chunk_id, kb_id, doc_id, tenant_id, chunk_index, content, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (f"chunk_{uuid.uuid4().hex[:12]}", kb_id, doc_id, effective_tenant, index, chunk, created_at),
                )
            conn.commit()
        self._best_effort_vector_mirror(kb_id, doc_id, chunks, effective_tenant)
        return {
            "doc_id": doc_id,
            "filename": filename,
            "chunk_count": len(chunks),
            "file_type": loaded.file_type,
            "metadata": loaded.metadata,
            "structured_data": loaded.structured_data,
            "extraction_quality": loaded.extraction_quality,
        }

    async def bind_lobster(self, kb_id: str, lobster_id: str, tenant_id: str) -> dict[str, Any]:
        with self._conn() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO knowledge_base_bindings(kb_id, lobster_id, tenant_id) VALUES (?, ?, ?)",
                (kb_id, lobster_id, tenant_id),
            )
            conn.commit()
        return {"ok": True, "kb_id": kb_id, "lobster_id": lobster_id}

    def list_docs(self, kb_id: str) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT doc_id, filename, metadata_json, chunk_count, created_at FROM knowledge_base_docs WHERE kb_id=? ORDER BY created_at DESC",
                (kb_id,),
            ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            try:
                item["metadata"] = json.loads(str(item.pop("metadata_json") or "{}"))
            except Exception:
                item["metadata"] = {}
            items.append(item)
        return items

    def list_bound_lobsters(self, kb_id: str) -> list[str]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT lobster_id FROM knowledge_base_bindings WHERE kb_id=? ORDER BY lobster_id ASC",
                (kb_id,),
            ).fetchall()
        return [str(row["lobster_id"]) for row in rows]

    def search(self, kb_id: str, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        q = str(query or "").strip().lower()
        if not q:
            return []
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT chunk_id, doc_id, chunk_index, content FROM knowledge_base_chunks WHERE kb_id=?",
                (kb_id,),
            ).fetchall()
        scored = []
        for row in rows:
            content = str(row["content"] or "")
            score = content.lower().count(q)
            if score <= 0:
                continue
            scored.append(
                {
                    "chunk_id": str(row["chunk_id"]),
                    "doc_id": str(row["doc_id"]),
                    "chunk_index": int(row["chunk_index"] or 0),
                    "content": content[:500],
                    "score": score,
                }
            )
        scored.sort(key=lambda item: (-int(item["score"]), int(item["chunk_index"])))
        return scored[: max(1, min(int(top_k), 20))]

    def search_bound_knowledge(self, lobster_id: str, tenant_id: str, query: str, top_k: int = 3) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT kb_id FROM knowledge_base_bindings WHERE lobster_id=? AND tenant_id=? ORDER BY kb_id ASC",
                (lobster_id, tenant_id),
            ).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            kb_id = str(row["kb_id"])
            kb = self.get(kb_id) or {}
            for item in self.search(kb_id, query, top_k=top_k):
                results.append({**item, "kb_id": kb_id, "kb_name": kb.get("name")})
        results.sort(key=lambda item: (-int(item.get("score", 0)), str(item.get("kb_id", ""))))
        return results[: max(1, min(int(top_k), 10))]

    @staticmethod
    def _decode_content(file_bytes: bytes) -> str:
        for encoding in ("utf-8", "utf-8-sig", "gb18030", "latin-1"):
            try:
                text = file_bytes.decode(encoding)
                if text.strip():
                    return text
            except Exception:
                continue
        return file_bytes.decode("utf-8", errors="replace")

    @staticmethod
    def _split_into_chunks(content: str, chunk_size: int = 500, overlap: int = 80) -> list[str]:
        text = re.sub(r"\s+", " ", str(content or "")).strip()
        if not text:
            return []
        if len(text) <= chunk_size:
            return [text]
        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = min(len(text), start + chunk_size)
            chunks.append(text[start:end].strip())
            if end >= len(text):
                break
            start = max(0, end - overlap)
        return [chunk for chunk in chunks if chunk]

    def _best_effort_vector_mirror(self, kb_id: str, doc_id: str, chunks: list[str], tenant_id: str) -> None:
        engine_path = Path(__file__).resolve().parent.parent / "services" / "lobster-memory" / "engine.py"
        if not engine_path.exists():
            return
        try:
            spec = importlib.util.spec_from_file_location("lobster_memory_engine_kb", engine_path)
            if spec is None or spec.loader is None:
                return
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            engine_cls = getattr(module, "LobsterMemoryEngine", None)
            if engine_cls is None:
                return
            engine = engine_cls(collection_name="lobster_knowledge_base")
        except Exception:
            return
        for index, chunk in enumerate(chunks):
            try:
                engine.store_experience(
                    node_id=kb_id,
                    intent=f"knowledge_chunk:{doc_id}:{index}",
                    context_data={"doc_id": doc_id, "chunk_index": index, "content": chunk},
                    reward=0.5,
                    tenant_id=tenant_id,
                    lobster_name="knowledge_base",
                    memory_type="knowledge_base",
                )
            except Exception:
                return


_kb_manager: KnowledgeBaseManager | None = None


def get_knowledge_base_manager() -> KnowledgeBaseManager:
    global _kb_manager
    if _kb_manager is None:
        _kb_manager = KnowledgeBaseManager()
    return _kb_manager
