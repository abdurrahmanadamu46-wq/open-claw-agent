from __future__ import annotations

import asyncio
import gzip
import json
import sqlite3
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib import request as urllib_request


@dataclass
class TelemetryEvent:
    event_id: str
    event_type: str
    timestamp: float
    lobster_id: str
    edge_node_id: str
    tenant_id: str
    payload: dict[str, Any]
    trace_id: str | None = None


class EdgeTelemetryBuffer:
    def __init__(
        self,
        *,
        cloud_endpoint: str,
        edge_node_id: str,
        batch_size: int = 50,
        flush_interval: float = 15.0,
        max_retry: int = 3,
        offline_db_path: str = "./tmp/edge_telemetry.sqlite",
    ) -> None:
        self.cloud_endpoint = cloud_endpoint.rstrip("/")
        self.edge_node_id = edge_node_id
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self.max_retry = max_retry
        self.offline_db_path = offline_db_path
        self._buffer: list[TelemetryEvent] = []
        self._lock = asyncio.Lock()
        self._last_flush = time.time()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.offline_db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        Path(self.offline_db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS pending_events (
                    event_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    retry_count INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            conn.commit()

    async def push(self, event: TelemetryEvent) -> None:
        async with self._lock:
            self._buffer.append(event)
            should_flush = len(self._buffer) >= self.batch_size or (time.time() - self._last_flush) >= self.flush_interval
        if should_flush:
            await self.flush()

    async def flush(self) -> None:
        async with self._lock:
            if not self._buffer:
                return
            batch = self._buffer[:]
            self._buffer.clear()
            self._last_flush = time.time()
        await self._send_batch(batch)

    async def _post(self, compressed: bytes) -> bool:
        url = f"{self.cloud_endpoint}/api/v1/edge/telemetry/batch"
        req = urllib_request.Request(
            url,
            data=compressed,
            headers={
                "Content-Type": "application/json",
                "Content-Encoding": "gzip",
                "X-Edge-Node-ID": self.edge_node_id,
            },
            method="POST",
        )
        return await asyncio.to_thread(lambda: urllib_request.urlopen(req, timeout=10).status == 200)

    async def _send_batch(self, events: list[TelemetryEvent]) -> None:
        payload = {
            "batch_id": f"tb_{uuid.uuid4().hex[:12]}",
            "edge_node_id": self.edge_node_id,
            "batch_size": len(events),
            "events": [asdict(item) for item in events],
            "sent_at": time.time(),
        }
        compressed = gzip.compress(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        for attempt in range(self.max_retry):
            try:
                if await self._post(compressed):
                    return
            except Exception:
                await asyncio.sleep(2**attempt)
        self._save_offline(events)

    def _save_offline(self, events: list[TelemetryEvent]) -> None:
        with self._connect() as conn:
            for event in events:
                conn.execute(
                    "INSERT OR REPLACE INTO pending_events(event_id, payload_json, created_at, retry_count) VALUES (?, ?, ?, COALESCE((SELECT retry_count FROM pending_events WHERE event_id = ?), 0))",
                    (event.event_id, json.dumps(asdict(event), ensure_ascii=False), event.timestamp, event.event_id),
                )
            conn.commit()

    async def retry_offline(self) -> int:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT event_id, payload_json, retry_count FROM pending_events WHERE retry_count < ? ORDER BY created_at LIMIT 200",
                (self.max_retry * 2,),
            ).fetchall()
        if not rows:
            return 0
        events = [TelemetryEvent(**json.loads(str(row["payload_json"]))) for row in rows]
        try:
            await self._send_batch(events)
            with self._connect() as conn:
                conn.executemany("DELETE FROM pending_events WHERE event_id = ?", [(row["event_id"],) for row in rows])
                conn.commit()
            return len(events)
        except Exception:
            with self._connect() as conn:
                conn.executemany(
                    "UPDATE pending_events SET retry_count = retry_count + 1 WHERE event_id = ?",
                    [(row["event_id"],) for row in rows],
                )
                conn.commit()
            return 0

    async def run_forever(self) -> None:
        while True:
            await asyncio.sleep(self.flush_interval)
            await self.flush()
            await self.retry_offline()
