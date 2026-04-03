"""
cti_engine.py — 竞品情报引擎微服务 (port 8030)

CTI = Competitive/Threat Intelligence
聚合 radar 龙虾产出的竞品情报，提供结构化查询接口。
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, Query
from pydantic import BaseModel

app = FastAPI(title="CTIEngine", version="1.0.0")

DRAGON_SENATE_URL = os.getenv("DRAGON_SENATE_URL", "http://app:8000")


class CompetitorIntelRequest(BaseModel):
    competitor_handle: str
    platform: str = "xiaohongshu"
    tenant_id: str = ""
    depth: str = "summary"  # summary | full


class ThreatSignal(BaseModel):
    signal_type: str  # price_war | content_copy | keyword_grab | viral_post
    severity: str = "low"  # low | medium | high
    source: str = ""
    description: str = ""
    detected_at: str = ""


@app.get("/healthz")
async def healthz():
    return {"ok": True, "service": "cti-engine"}


@app.post("/cti/competitor-intel")
async def competitor_intel(req: CompetitorIntelRequest) -> dict[str, Any]:
    """拉取竞品情报（委托 radar 龙虾 or 缓存）。"""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{DRAGON_SENATE_URL}/analyze_competitor_formula",
                json={
                    "target_account_url": req.competitor_handle,
                    "platform": req.platform,
                    "tenant_id": req.tenant_id,
                    "analysis_mode": True,
                },
            )
            data = resp.json()
            return {
                "ok": True,
                "competitor": req.competitor_handle,
                "platform": req.platform,
                "intel": data.get("radar_data") or data.get("formula") or {},
                "threat_signals": data.get("threat_signals", []),
                "source": "dragon_senate_radar",
            }
    except Exception as exc:
        return {
            "ok": False,
            "competitor": req.competitor_handle,
            "error": str(exc)[:200],
            "intel": {},
            "threat_signals": [],
        }


@app.get("/cti/threats")
async def list_threats(
    tenant_id: str = Query(default=""),
    platform: str = Query(default=""),
    severity: str = Query(default=""),
) -> dict[str, Any]:
    """查询租户当前的威胁信号列表（从 dragon_senate 聚合）。"""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            params: dict[str, str] = {}
            if tenant_id:
                params["tenant_id"] = tenant_id
            if platform:
                params["platform"] = platform
            resp = await client.get(
                f"{DRAGON_SENATE_URL}/api/v1/threat-signals",
                params=params,
            )
            data = resp.json()
            signals = data.get("signals", [])
            if severity:
                signals = [s for s in signals if s.get("severity") == severity]
            return {"ok": True, "total": len(signals), "signals": signals}
    except Exception:
        return {"ok": True, "total": 0, "signals": []}
