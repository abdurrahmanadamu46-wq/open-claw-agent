from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx


logger = logging.getLogger("vector_snapshot_manager")

DEFAULT_COLLECTIONS = [
    "lobster_episodic_memory",
    "viral_formulas",
]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def _resolve_backup_dir() -> Path:
    raw = os.getenv("VECTOR_BACKUP_DIR", "./data/vector_backups").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / raw).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _resolve_db_path() -> Path:
    raw = os.getenv("VECTOR_BACKUP_DB_PATH", "./data/vector_snapshot_backups.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / raw).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _resolve_qdrant_url() -> str:
    return os.getenv("QDRANT_URL", "http://127.0.0.1:6333").strip().rstrip("/")


def _resolve_qdrant_api_key() -> str | None:
    value = os.getenv("QDRANT_API_KEY", "").strip()
    return value or None


def _collections_to_backup() -> list[str]:
    raw = os.getenv("VECTOR_BACKUP_COLLECTIONS", "").strip()
    if not raw:
        return list(DEFAULT_COLLECTIONS)
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass
class VectorSnapshotRecord:
    backup_id: str
    collection_name: str
    snapshot_name: str
    backup_path: str
    status: str
    size_bytes: int = 0
    created_at: str = _utc_now()
    detail: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["detail"] = dict(self.detail or {})
        return payload


class VectorSnapshotManager:
    def __init__(
        self,
        *,
        qdrant_url: str | None = None,
        backup_dir: str | Path | None = None,
        keep_versions: int = 7,
    ) -> None:
        self.qdrant_url = qdrant_url or _resolve_qdrant_url()
        self.qdrant_api_key = _resolve_qdrant_api_key()
        self.backup_dir = Path(backup_dir or _resolve_backup_dir())
        self.keep_versions = max(1, int(keep_versions))
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(_resolve_db_path()))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS vector_snapshot_backups (
                    backup_id TEXT PRIMARY KEY,
                    collection_name TEXT NOT NULL,
                    snapshot_name TEXT NOT NULL,
                    backup_path TEXT NOT NULL,
                    status TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL DEFAULT 0,
                    detail_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_vector_snapshot_backups_collection
                    ON vector_snapshot_backups(collection_name, created_at DESC);
                """
            )
            conn.commit()

    def _client(self) -> httpx.Client:
        headers = {"api-key": self.qdrant_api_key} if self.qdrant_api_key else None
        return httpx.Client(base_url=self.qdrant_url, headers=headers, timeout=120.0)

    def _record(self, record: VectorSnapshotRecord) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO vector_snapshot_backups(
                    backup_id, collection_name, snapshot_name, backup_path,
                    status, size_bytes, detail_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.backup_id,
                    record.collection_name,
                    record.snapshot_name,
                    record.backup_path,
                    record.status,
                    record.size_bytes,
                    json.dumps(record.detail or {}, ensure_ascii=False),
                    record.created_at,
                ),
            )
            conn.commit()

    def collection_exists(self, collection_name: str) -> bool:
        try:
            with self._client() as client:
                resp = client.get(f"/collections/{collection_name}")
            return resp.status_code == 200
        except Exception:
            return False

    def list_remote_snapshots(self, collection_name: str) -> list[dict[str, Any]]:
        with self._client() as client:
            resp = client.get(f"/collections/{collection_name}/snapshots", timeout=30.0)
            resp.raise_for_status()
        payload = resp.json().get("result", [])
        return list(payload or [])

    def snapshot_collection(self, collection_name: str) -> Path | None:
        if not self.collection_exists(collection_name):
            logger.warning("[VectorBackup] collection missing, skip: %s", collection_name)
            return None

        backup_id = f"vec_{uuid.uuid4().hex[:12]}"
        snapshot_name = ""
        local_path = self.backup_dir / f"{collection_name}_{_timestamp_slug()}.snapshot"
        detail: dict[str, Any] = {}

        try:
            with self._client() as client:
                create_resp = client.post(f"/collections/{collection_name}/snapshots", timeout=120.0)
                create_resp.raise_for_status()
                snapshot_info = create_resp.json().get("result") or {}
                snapshot_name = str(snapshot_info.get("name") or "").strip()
                if not snapshot_name:
                    raise RuntimeError("snapshot_name_missing")

                download_resp = client.get(
                    f"/collections/{collection_name}/snapshots/{snapshot_name}",
                    timeout=300.0,
                    follow_redirects=True,
                )
                download_resp.raise_for_status()
                with open(local_path, "wb") as file:
                    for chunk in download_resp.iter_bytes():
                        if chunk:
                            file.write(chunk)

            size_bytes = local_path.stat().st_size if local_path.exists() else 0
            detail = {
                "qdrant_url": self.qdrant_url,
                "downloaded_at": _utc_now(),
            }
            self._record(
                VectorSnapshotRecord(
                    backup_id=backup_id,
                    collection_name=collection_name,
                    snapshot_name=snapshot_name,
                    backup_path=str(local_path),
                    status="ok",
                    size_bytes=size_bytes,
                    detail=detail,
                )
            )
            return local_path
        except Exception as exc:
            self._record(
                VectorSnapshotRecord(
                    backup_id=backup_id,
                    collection_name=collection_name,
                    snapshot_name=snapshot_name or "unknown",
                    backup_path=str(local_path),
                    status="failed",
                    size_bytes=0,
                    detail={"error": str(exc)},
                )
            )
            logger.error("[VectorBackup] snapshot failed collection=%s error=%s", collection_name, exc)
            return None

    def cleanup_old_snapshots(self, collection_name: str) -> None:
        try:
            snapshots = self.list_remote_snapshots(collection_name)
            snapshots.sort(key=lambda item: str(item.get("creation_time") or ""), reverse=True)
            for item in snapshots[self.keep_versions :]:
                name = str(item.get("name") or "").strip()
                if not name:
                    continue
                with self._client() as client:
                    client.delete(f"/collections/{collection_name}/snapshots/{name}", timeout=30.0)
        except Exception as exc:
            logger.warning("[VectorBackup] cleanup failed collection=%s error=%s", collection_name, exc)

    def list_backup_history(self, *, collection_name: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        query = "SELECT * FROM vector_snapshot_backups"
        params: list[Any] = []
        if collection_name:
            query += " WHERE collection_name = ?"
            params.append(collection_name)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(max(1, min(int(limit), 200)))
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            payload = dict(row)
            payload["detail"] = json.loads(str(payload.pop("detail_json", "{}") or "{}"))
            items.append(payload)
        return items

    def run_daily_backup(self) -> dict[str, Any]:
        started = time.time()
        summary: dict[str, Any] = {}
        for collection_name in _collections_to_backup():
            path = self.snapshot_collection(collection_name)
            if path is None:
                summary[collection_name] = {"status": "failed"}
                continue
            self.cleanup_old_snapshots(collection_name)
            summary[collection_name] = {
                "status": "ok",
                "path": str(path),
                "size_mb": round(path.stat().st_size / 1024 / 1024, 2),
            }
        return {
            "elapsed_seconds": round(time.time() - started, 1),
            "collections": summary,
            "backup_dir": str(self.backup_dir),
        }


async def run_vector_backup_daily_loop(stop_event: asyncio.Event, *, hour_utc: int = 3) -> None:
    manager = VectorSnapshotManager()
    last_run_day = ""
    while not stop_event.is_set():
        now = datetime.now(timezone.utc)
        if now.hour == hour_utc and now.minute < 5 and now.strftime("%Y-%m-%d") != last_run_day:
            try:
                result = manager.run_daily_backup()
                last_run_day = now.strftime("%Y-%m-%d")
                logger.info("[VectorBackup] scheduled backup completed: %s", result)
            except Exception as exc:
                logger.error("[VectorBackup] scheduled backup failed: %s", exc)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=300)
        except asyncio.TimeoutError:
            continue
