from __future__ import annotations

import gzip
import json

from fastapi import APIRouter, Header, Request

from edge_telemetry_store import get_edge_telemetry_store


router = APIRouter(prefix="/api/v1/edge/telemetry", tags=["edge-telemetry"])


@router.post("/batch")
async def receive_edge_telemetry_batch(
    request: Request,
    x_edge_node_id: str = Header(default=""),
    content_encoding: str | None = Header(default=None),
):
    raw = await request.body()
    if content_encoding == "gzip":
        raw = gzip.decompress(raw)
    payload = json.loads(raw or b"{}")
    batch_id = str(payload.get("batch_id") or "")
    edge_node_id = str(payload.get("edge_node_id") or x_edge_node_id or "")
    events = payload.get("events") if isinstance(payload.get("events"), list) else []
    tenant_id = str(events[0].get("tenant_id") or "tenant_main") if events else "tenant_main"
    result = get_edge_telemetry_store().ingest_batch(
        batch_id=batch_id or f"batch_{edge_node_id}",
        edge_node_id=edge_node_id or "unknown",
        tenant_id=tenant_id,
        events=[dict(item) for item in events if isinstance(item, dict)],
        metadata={"sent_at": payload.get("sent_at"), "batch_size": payload.get("batch_size")},
    )
    return {"ok": True, "received": len(events), "result": result}


@router.get("/runs")
async def list_edge_telemetry_runs(tenant_id: str = "tenant_main", limit: int = 100):
    items = get_edge_telemetry_store().latest_run_results(tenant_id=tenant_id, limit=limit)
    return {"ok": True, "tenant_id": tenant_id, "count": len(items), "items": items}
