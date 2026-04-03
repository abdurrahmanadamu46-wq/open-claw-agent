"""
trust_verification.py — 信任验证微服务 (port 8020)

对账号/内容/边缘节点做信任度评估。
核心逻辑：账号活跃度、互动质量、历史违规记录。
"""
from __future__ import annotations

import os
import time
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="TrustVerification", version="1.0.0")

DRAGON_SENATE_URL = os.getenv("DRAGON_SENATE_URL", "http://app:8000")


class TrustCheckRequest(BaseModel):
    subject_id: str
    subject_type: str = "account"  # account | content | edge_node
    tenant_id: str = ""
    metadata: dict[str, Any] = {}


class TrustScore(BaseModel):
    subject_id: str
    subject_type: str
    trust_score: float  # 0.0 - 1.0
    trust_level: str  # verified | trusted | unknown | suspicious | blocked
    reasons: list[str] = []
    checked_at: float = 0.0


@app.get("/healthz")
async def healthz():
    return {"ok": True, "service": "trust-verification"}


@app.post("/trust/check", response_model=TrustScore)
async def trust_check(req: TrustCheckRequest) -> TrustScore:
    """评估主体的信任度。"""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                f"{DRAGON_SENATE_URL}/internal/trust/check",
                json=req.model_dump(),
            )
            data = resp.json()
            return TrustScore(
                subject_id=req.subject_id,
                subject_type=req.subject_type,
                trust_score=float(data.get("trust_score", 0.7)),
                trust_level=str(data.get("trust_level", "unknown")),
                reasons=list(data.get("reasons", [])),
                checked_at=time.time(),
            )
    except Exception:
        pass

    # 兜底：未知主体给予中等信任
    return TrustScore(
        subject_id=req.subject_id,
        subject_type=req.subject_type,
        trust_score=0.6,
        trust_level="unknown",
        reasons=["no_history"],
        checked_at=time.time(),
    )


@app.get("/trust/score/{subject_id}")
async def get_trust_score(subject_id: str, subject_type: str = "account") -> dict[str, Any]:
    result = await trust_check(TrustCheckRequest(
        subject_id=subject_id,
        subject_type=subject_type,
    ))
    return result.model_dump()
