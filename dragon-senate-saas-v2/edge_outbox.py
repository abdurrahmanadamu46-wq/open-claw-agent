"""
edge_outbox.py — 边缘消息发件箱
================================

借鉴 Golutra chat_outbox + batcher：
- 先持久化，再投递
- 按 node_id 批量分发
- ACK 后标记 delivered
- 超时指数退避重试
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

logger = logging.getLogger("edge_outbox")

DEFAULT_DB_PATH = "./data/edge_outbox.sqlite"


def _resolve_db_path(db_path: str | None = None) -> Path:
    raw = str(db_path or os.getenv("EDGE_OUTBOX_DB_PATH", DEFAULT_DB_PATH)).strip() or DEFAULT_DB_PATH
    path = Path(raw)
    if not path.is_absolute():
        path = Path(__file__).resolve().parent / path
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class OutboxEntry:
    outbox_id: str
    tenant_id: str
    node_id: str
    msg_type: str
    payload: dict[str, Any]
    status: str
    delivery_mode: str
    webhook_url: str
    retry_count: int
    max_retries: int
    created_at: float
    updated_at: float
    next_retry_at: float
    last_attempt_at: float
    ack_deadline_at: float
    last_error: str = ""

    def to_delivery_item(self) -> dict[str, Any]:
        package = dict(self.payload)
        package.setdefault("msg_type", self.msg_type)
        package["outbox_id"] = self.outbox_id
        package["_outbox"] = {
            "status": self.status,
            "retry_count": self.retry_count,
            "delivery_mode": self.delivery_mode,
            "created_at": self.created_at,
        }
        return package


class EdgeOutbox:
    def __init__(
        self,
        *,
        db_path: str | None = None,
        sender: Callable[[str, dict[str, Any], list[OutboxEntry]], Any] | None = None,
        flush_interval: float = 1.0,
        batch_size: int = 50,
        ack_timeout_sec: float = 30.0,
    ) -> None:
        self.db_path = _resolve_db_path(db_path)
        self.sender = sender
        self.flush_interval = max(0.2, float(flush_interval))
        self.batch_size = max(1, int(batch_size))
        self.ack_timeout_sec = max(1.0, float(ack_timeout_sec))
        self._lock = threading.Lock()
        self._running = False
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS edge_outbox (
                    outbox_id       TEXT PRIMARY KEY,
                    tenant_id       TEXT NOT NULL,
                    node_id         TEXT NOT NULL,
                    msg_type        TEXT NOT NULL,
                    payload_json    TEXT NOT NULL,
                    status          TEXT NOT NULL DEFAULT 'pending',
                    delivery_mode   TEXT NOT NULL DEFAULT 'poll',
                    webhook_url     TEXT NOT NULL DEFAULT '',
                    retry_count     INTEGER NOT NULL DEFAULT 0,
                    max_retries     INTEGER NOT NULL DEFAULT 3,
                    created_at      REAL NOT NULL,
                    updated_at      REAL NOT NULL,
                    next_retry_at   REAL NOT NULL,
                    last_attempt_at REAL NOT NULL DEFAULT 0,
                    ack_deadline_at REAL NOT NULL DEFAULT 0,
                    last_error      TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_edge_outbox_node_status
                    ON edge_outbox(node_id, status, next_retry_at);
                CREATE INDEX IF NOT EXISTS idx_edge_outbox_mode_status
                    ON edge_outbox(delivery_mode, status, next_retry_at);
                """
            )

    async def enqueue(
        self,
        tenant_id: str,
        node_id: str,
        msg_type: str,
        payload: dict[str, Any],
        *,
        delivery_mode: str = "poll",
        webhook_url: str = "",
        max_retries: int = 3,
    ) -> str:
        now = time.time()
        outbox_id = f"outbox_{uuid.uuid4().hex[:12]}"
        with self._lock, self._conn() as conn:
            conn.execute(
                """
                INSERT INTO edge_outbox(
                    outbox_id, tenant_id, node_id, msg_type, payload_json,
                    status, delivery_mode, webhook_url, retry_count, max_retries,
                    created_at, updated_at, next_retry_at, last_attempt_at, ack_deadline_at, last_error
                ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?, 0, 0, '')
                """,
                (
                    outbox_id,
                    str(tenant_id or "tenant_main").strip() or "tenant_main",
                    str(node_id or "").strip(),
                    str(msg_type or "message").strip() or "message",
                    json.dumps(payload or {}, ensure_ascii=False),
                    str(delivery_mode or "poll").strip() or "poll",
                    str(webhook_url or "").strip(),
                    max(0, int(max_retries)),
                    now,
                    now,
                    now,
                ),
            )
        logger.info("[EdgeOutbox] enqueued outbox_id=%s node=%s type=%s", outbox_id, node_id, msg_type)
        return outbox_id

    async def ack(self, outbox_id: str) -> bool:
        normalized = str(outbox_id or "").strip()
        if not normalized:
            return False
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT outbox_id FROM edge_outbox WHERE outbox_id = ?",
                (normalized,),
            ).fetchone()
            if row is None:
                return False
            now = time.time()
            conn.execute(
                """
                UPDATE edge_outbox
                SET status = 'delivered',
                    updated_at = ?,
                    ack_deadline_at = 0,
                    last_error = ''
                WHERE outbox_id = ?
                """,
                (now, normalized),
            )
        return True

    async def pull_batch(self, node_id: str, *, limit: int = 5) -> list[dict[str, Any]]:
        normalized_node = str(node_id or "").strip()
        if not normalized_node:
            return []
        now = time.time()
        with self._lock, self._conn() as conn:
            self._recover_expired_locked(conn, now, modes=("poll",))
            rows = conn.execute(
                """
                SELECT * FROM edge_outbox
                WHERE node_id = ?
                  AND delivery_mode = 'poll'
                  AND status = 'pending'
                  AND next_retry_at <= ?
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (normalized_node, now, max(1, int(limit))),
            ).fetchall()
            if not rows:
                return []
            claim_until = now + self.ack_timeout_sec
            ids = [str(row["outbox_id"]) for row in rows]
            conn.executemany(
                """
                UPDATE edge_outbox
                SET status = 'sending',
                    updated_at = ?,
                    last_attempt_at = ?,
                    ack_deadline_at = ?
                WHERE outbox_id = ?
                """,
                [(now, now, claim_until, outbox_id) for outbox_id in ids],
            )
            return [self._row_to_entry(row).to_delivery_item() for row in rows]

    async def flush_once(self) -> int:
        if self.sender is None:
            return 0
        now = time.time()
        with self._lock, self._conn() as conn:
            self._recover_expired_locked(conn, now, modes=("push",))
            rows = conn.execute(
                """
                SELECT * FROM edge_outbox
                WHERE delivery_mode = 'push'
                  AND status = 'pending'
                  AND next_retry_at <= ?
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (now, self.batch_size),
            ).fetchall()
            if not rows:
                return 0
            grouped_ids: dict[str, list[str]] = defaultdict(list)
            grouped_entries: dict[str, list[OutboxEntry]] = defaultdict(list)
            for row in rows:
                entry = self._row_to_entry(row)
                grouped_ids[entry.node_id].append(entry.outbox_id)
                grouped_entries[entry.node_id].append(entry)
            claim_until = now + self.ack_timeout_sec
            all_ids = [outbox_id for ids in grouped_ids.values() for outbox_id in ids]
            conn.executemany(
                """
                UPDATE edge_outbox
                SET status = 'sending',
                    updated_at = ?,
                    last_attempt_at = ?,
                    ack_deadline_at = ?
                WHERE outbox_id = ?
                """,
                [(now, now, claim_until, outbox_id) for outbox_id in all_ids],
            )

        sent_count = 0
        for node_id, entries in grouped_entries.items():
            batch_payload = {
                "type": "batch_delivery",
                "node_id": node_id,
                "count": len(entries),
                "items": [entry.to_delivery_item() for entry in entries],
                "created_at": time.time(),
            }
            try:
                response = await self._call_sender(node_id, batch_payload, entries)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[EdgeOutbox] send failed node=%s error=%s", node_id, exc)
                await self._schedule_retry_many([entry.outbox_id for entry in entries], error=str(exc))
                continue

            delivered_ids, awaiting_ack = self._normalize_sender_response(response, entries)
            if delivered_ids:
                for outbox_id in delivered_ids:
                    await self.ack(outbox_id)
            remaining = [entry.outbox_id for entry in entries if entry.outbox_id not in delivered_ids]
            if remaining and not awaiting_ack:
                await self._schedule_retry_many(remaining, error="sender_rejected")
                continue
            sent_count += len(entries)
        return sent_count

    async def flush_loop(self) -> None:
        self._running = True
        try:
            while self._running:
                await self.flush_once()
                await asyncio.sleep(self.flush_interval)
        except asyncio.CancelledError:
            self._running = False
            raise

    def stop(self) -> None:
        self._running = False

    def stats(self) -> dict[str, Any]:
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                """
                SELECT status, delivery_mode, node_id, COUNT(*) AS total
                FROM edge_outbox
                GROUP BY status, delivery_mode, node_id
                """
            ).fetchall()
        by_status: dict[str, int] = defaultdict(int)
        by_node: dict[str, int] = defaultdict(int)
        by_mode: dict[str, int] = defaultdict(int)
        for row in rows:
            total = int(row["total"] or 0)
            by_status[str(row["status"])] += total
            by_node[str(row["node_id"])] += total
            by_mode[str(row["delivery_mode"])] += total
        return {
            "db_path": str(self.db_path),
            "by_status": dict(by_status),
            "by_node": dict(by_node),
            "by_mode": dict(by_mode),
            "total": sum(by_status.values()),
        }

    def pending_counts_by_node(self) -> dict[str, int]:
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                """
                SELECT node_id, COUNT(*) AS total
                FROM edge_outbox
                WHERE status IN ('pending', 'sending')
                GROUP BY node_id
                """
            ).fetchall()
        return {str(row["node_id"]): int(row["total"] or 0) for row in rows}

    def queue_view(self) -> dict[str, list[dict[str, Any]]]:
        counts = self.pending_counts_by_node()
        return {node_id: [{"pending": True}] * count for node_id, count in counts.items()}

    def list_entries(
        self,
        *,
        node_id: str | None = None,
        status: str | None = None,
        delivery_mode: str | None = None,
        limit: int = 100,
    ) -> list[OutboxEntry]:
        query = "SELECT * FROM edge_outbox WHERE 1=1"
        params: list[Any] = []
        if node_id:
            query += " AND node_id = ?"
            params.append(str(node_id))
        if status:
            query += " AND status = ?"
            params.append(str(status))
        if delivery_mode:
            query += " AND delivery_mode = ?"
            params.append(str(delivery_mode))
        query += " ORDER BY created_at ASC LIMIT ?"
        params.append(max(1, int(limit)))
        with self._lock, self._conn() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_entry(row) for row in rows]

    async def _call_sender(
        self,
        node_id: str,
        batch_payload: dict[str, Any],
        entries: list[OutboxEntry],
    ) -> Any:
        result = self.sender(node_id, batch_payload, entries)
        if hasattr(result, "__await__"):
            return await result
        return result

    def _normalize_sender_response(
        self,
        response: Any,
        entries: list[OutboxEntry],
    ) -> tuple[set[str], bool]:
        if response is True:
            return {entry.outbox_id for entry in entries}, False
        if response in (None, {}):
            return set(), True
        if response is False:
            return set(), False
        if isinstance(response, dict):
            delivered_raw = response.get("delivered_ids") or response.get("acknowledged_ids") or []
            delivered_ids = {str(item) for item in delivered_raw if str(item).strip()}
            awaiting_ack = bool(response.get("awaiting_ack", False))
            if not delivered_ids and bool(response.get("accepted", False)) and not awaiting_ack:
                delivered_ids = {entry.outbox_id for entry in entries}
            return delivered_ids, awaiting_ack
        return set(), False

    async def _schedule_retry_many(self, outbox_ids: Iterable[str], *, error: str = "") -> None:
        ids = [str(item or "").strip() for item in outbox_ids if str(item or "").strip()]
        if not ids:
            return
        now = time.time()
        with self._lock, self._conn() as conn:
            failures = self._schedule_retry_many_locked(conn, ids, now=now, error=error)
        for _, _, outbox_id in failures:
            logger.error("[EdgeOutbox] failed after max retries outbox_id=%s", outbox_id)

    def _recover_expired_locked(
        self,
        conn: sqlite3.Connection,
        now: float,
        *,
        modes: tuple[str, ...] = ("poll", "push"),
    ) -> None:
        placeholders = ",".join("?" for _ in modes)
        rows = conn.execute(
            f"""
            SELECT outbox_id
            FROM edge_outbox
            WHERE status = 'sending'
              AND delivery_mode IN ({placeholders})
              AND ack_deadline_at > 0
              AND ack_deadline_at <= ?
            """,
            (*modes, now),
        ).fetchall()
        expired_ids = [str(row["outbox_id"]) for row in rows]
        if not expired_ids:
            return
        logger.info("[EdgeOutbox] recovering expired deliveries count=%d", len(expired_ids))
        self._schedule_retry_many_locked(conn, expired_ids, now=now, error="ack_timeout")

    def _schedule_retry_many_locked(
        self,
        conn: sqlite3.Connection,
        outbox_ids: list[str],
        *,
        now: float,
        error: str,
    ) -> list[tuple[Any, ...]]:
        rows = conn.execute(
            f"""
            SELECT outbox_id, retry_count, max_retries
            FROM edge_outbox
            WHERE outbox_id IN ({",".join("?" for _ in outbox_ids)})
            """,
            outbox_ids,
        ).fetchall()
        updates: list[tuple[Any, ...]] = []
        failures: list[tuple[Any, ...]] = []
        for row in rows:
            retry_count = int(row["retry_count"] or 0) + 1
            max_retries = int(row["max_retries"] or 0)
            if retry_count > max_retries:
                failures.append((now, error[:500], str(row["outbox_id"])))
                continue
            next_retry_at = now + (2 ** retry_count) * 5
            updates.append((retry_count, now, next_retry_at, error[:500], str(row["outbox_id"])))
        if updates:
            conn.executemany(
                """
                UPDATE edge_outbox
                SET status = 'pending',
                    retry_count = ?,
                    updated_at = ?,
                    next_retry_at = ?,
                    ack_deadline_at = 0,
                    last_error = ?
                WHERE outbox_id = ?
                """,
                updates,
            )
        if failures:
            conn.executemany(
                """
                UPDATE edge_outbox
                SET status = 'failed',
                    updated_at = ?,
                    ack_deadline_at = 0,
                    last_error = ?
                WHERE outbox_id = ?
                """,
                failures,
            )
        return failures

    @staticmethod
    def _row_to_entry(row: sqlite3.Row) -> OutboxEntry:
        return OutboxEntry(
            outbox_id=str(row["outbox_id"]),
            tenant_id=str(row["tenant_id"]),
            node_id=str(row["node_id"]),
            msg_type=str(row["msg_type"]),
            payload=json.loads(row["payload_json"]) if row["payload_json"] else {},
            status=str(row["status"]),
            delivery_mode=str(row["delivery_mode"]),
            webhook_url=str(row["webhook_url"] or ""),
            retry_count=int(row["retry_count"] or 0),
            max_retries=int(row["max_retries"] or 0),
            created_at=float(row["created_at"] or 0),
            updated_at=float(row["updated_at"] or 0),
            next_retry_at=float(row["next_retry_at"] or 0),
            last_attempt_at=float(row["last_attempt_at"] or 0),
            ack_deadline_at=float(row["ack_deadline_at"] or 0),
            last_error=str(row["last_error"] or ""),
        )
