"""
Markdown document store for lobster outputs.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any


DB_PATH = Path(os.getenv("LOBSTER_DOC_STORE_DB", "./data/lobster_doc_store.sqlite"))
AUTO_SAVE_LOBSTERS = {"inkwriter", "strategist", "visualizer"}
MIN_DOC_LENGTH = 200


class LobsterDocStore:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lobster_docs (
                    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    doc_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    lobster_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    task_id TEXT DEFAULT '',
                    version INTEGER NOT NULL DEFAULT 1,
                    is_latest INTEGER NOT NULL DEFAULT 1,
                    editor_id TEXT DEFAULT '',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_lobster_docs_latest ON lobster_docs(tenant_id, lobster_name, is_latest, updated_at DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_lobster_docs_doc ON lobster_docs(doc_id, version DESC)")
            conn.commit()
        finally:
            conn.close()

    def auto_save_from_task(
        self,
        *,
        task_id: str,
        lobster_name: str,
        tenant_id: str,
        output: str,
        title: str = "",
    ) -> str | None:
        if lobster_name not in AUTO_SAVE_LOBSTERS:
            return None
        content = str(output or "").strip()
        if len(content) < MIN_DOC_LENGTH:
            return None
        doc_id = f"doc_{uuid.uuid4().hex[:12]}"
        now = time.time()
        normalized_title = title.strip() or self._extract_title(content, lobster_name)
        content_hash = hashlib.md5(content.encode("utf-8")).hexdigest()[:8]
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO lobster_docs (
                    doc_id, tenant_id, lobster_name, title, content, content_hash,
                    task_id, version, is_latest, editor_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, '', ?, ?)
                """,
                (
                    doc_id,
                    tenant_id,
                    lobster_name,
                    normalized_title,
                    content,
                    content_hash,
                    task_id,
                    now,
                    now,
                ),
            )
            conn.commit()
            return doc_id
        finally:
            conn.close()

    def update_content(self, *, doc_id: str, tenant_id: str, new_content: str, editor_id: str = "") -> dict[str, Any]:
        current = self.get_doc(doc_id, tenant_id)
        if not current:
            return {"success": False, "error": "文档不存在"}
        now = time.time()
        new_version = int(current.get("version") or 1) + 1
        content = str(new_content or "")
        content_hash = hashlib.md5(content.encode("utf-8")).hexdigest()[:8]
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE lobster_docs SET is_latest=0 WHERE doc_id=? AND tenant_id=? AND is_latest=1",
                (doc_id, tenant_id),
            )
            conn.execute(
                """
                INSERT INTO lobster_docs (
                    doc_id, tenant_id, lobster_name, title, content, content_hash,
                    task_id, version, is_latest, editor_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    doc_id,
                    tenant_id,
                    current["lobster_name"],
                    current["title"],
                    content,
                    content_hash,
                    current.get("task_id") or "",
                    new_version,
                    editor_id,
                    float(current.get("created_at") or now),
                    now,
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return {"success": True, "version": new_version}

    def get_doc(self, doc_id: str, tenant_id: str) -> dict[str, Any]:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM lobster_docs WHERE doc_id=? AND tenant_id=? AND is_latest=1 ORDER BY version DESC LIMIT 1",
                (doc_id, tenant_id),
            ).fetchone()
            return dict(row) if row else {}
        finally:
            conn.close()

    def list_docs(self, tenant_id: str, lobster_name: str = "") -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            if lobster_name:
                rows = conn.execute(
                    "SELECT * FROM lobster_docs WHERE tenant_id=? AND lobster_name=? AND is_latest=1 ORDER BY updated_at DESC",
                    (tenant_id, lobster_name),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM lobster_docs WHERE tenant_id=? AND is_latest=1 ORDER BY updated_at DESC",
                    (tenant_id,),
                ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get_versions(self, doc_id: str, tenant_id: str) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute(
                """
                SELECT version, content_hash, updated_at, editor_id, is_latest
                FROM lobster_docs
                WHERE doc_id=? AND tenant_id=?
                ORDER BY version DESC
                """,
                (doc_id, tenant_id),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get_latest_for_lobster(self, lobster_name: str, tenant_id: str) -> dict[str, Any]:
        conn = self._conn()
        try:
            row = conn.execute(
                """
                SELECT * FROM lobster_docs
                WHERE tenant_id=? AND lobster_name=? AND is_latest=1
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (tenant_id, lobster_name),
            ).fetchone()
            return dict(row) if row else {}
        finally:
            conn.close()

    def _extract_title(self, content: str, lobster_name: str) -> str:
        first_line = content.strip().split("\n")[0].lstrip("#").strip()
        if first_line and len(first_line) <= 40:
            return first_line
        return f"{lobster_name} 文档 {time.strftime('%m-%d %H:%M')}"


_default_store: LobsterDocStore | None = None


def get_lobster_doc_store() -> LobsterDocStore:
    global _default_store
    if _default_store is None:
        _default_store = LobsterDocStore()
    return _default_store
