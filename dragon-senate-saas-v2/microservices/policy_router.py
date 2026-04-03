"""
policy_router.py — 内容政策路由微服务 (port 8010)

委托 dragon_senate 的 constitutional_guardian 做内容合规判断。
提供轻量 REST 接口供其他服务调用，避免直接导入 dragon_senate 大模块。
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="PolicyRouter", version="1.0.0")

DRAGON_SENATE_URL = os.getenv("DRAGON_SENATE_URL", "http://app:8000")


class PolicyCheckRequest(BaseModel):
    content: str
    content_type: str = "post"
    platform: str = "xiaohongshu"
    tenant_id: str = ""
    extra: dict[str, Any] = {}


class PolicyCheckResponse(BaseModel):
    ok: bool
    allowed: bool
    risk_level: str = "low"
    violations: list[str] = []
    reason: str = ""


@app.get("/healthz")
async def healthz():
    return {"ok": True, "service": "policy-router"}


@app.post("/policy/check", response_model=PolicyCheckResponse)
async def policy_check(req: PolicyCheckRequest) -> PolicyCheckResponse:
    """
    委托 constitutional_guardian 做内容合规检测。
    实际路由到 dragon_senate 的 /internal/policy/check，
    如果该接口未实现则降级到本地规则判断。
    """
    import httpx

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{DRAGON_SENATE_URL}/internal/policy/check",
                json={
                    "content": req.content,
                    "content_type": req.content_type,
                    "platform": req.platform,
                    "tenant_id": req.tenant_id,
                },
            )
            data = resp.json()
            return PolicyCheckResponse(
                ok=True,
                allowed=bool(data.get("allowed", True)),
                risk_level=str(data.get("risk_level", "low")),
                violations=list(data.get("violations", [])),
                reason=str(data.get("reason", "")),
            )
    except Exception:
        pass

    # 本地规则兜底：简单关键词过滤
    banned = ["违禁", "诈骗", "违法", "赌博", "色情"]
    found = [kw for kw in banned if kw in req.content]
    return PolicyCheckResponse(
        ok=True,
        allowed=len(found) == 0,
        risk_level="high" if found else "low",
        violations=found,
        reason=f"命中关键词: {found}" if found else "通过",
    )


@app.post("/policy/batch-check")
async def batch_check(items: list[PolicyCheckRequest]) -> dict[str, Any]:
    results = []
    for item in items[:50]:
        r = await policy_check(item)
        results.append(r.model_dump())
    blocked = sum(1 for r in results if not r["allowed"])
    return {"ok": True, "total": len(results), "blocked": blocked, "results": results}
