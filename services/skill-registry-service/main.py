"""
main.py — 技能注册服务 (services/skill-registry-service)

轻量 FastAPI 微服务，代理 dragon-senate 的龙虾技能注册表。
对外提供技能的 CRUD 查询接口，配合 SkillEffectivenessCalibrator 返回推荐列表。

Port: 8050
"""
from __future__ import annotations

import os
import sys
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

app = FastAPI(title="SkillRegistryService", version="1.0.0")

DRAGON_SENATE_URL = os.getenv("DRAGON_SENATE_URL", "http://app:8000")


# ── 请求/响应模型 ─────────────────────────────────────────────────────

class SkillConfigUpdate(BaseModel):
    config: dict[str, Any] = {}


class SkillStatusPatchRequest(BaseModel):
    status: str
    note: str | None = None


class SkillRegisterRequest(BaseModel):
    manifest: dict[str, Any] = {}
    files: list[str] = []
    system_prompt: str | None = None
    user_template: str | None = None
    persist: bool = False


# ── 健康检查 ─────────────────────────────────────────────────────────

@app.get("/healthz")
async def healthz():
    return {"ok": True, "service": "skill-registry-service"}


# ── 技能列表 ─────────────────────────────────────────────────────────

@app.get("/skills")
async def list_skills(
    lobster_id: str | None = Query(default=None),
    category: str | None = Query(default=None),
    enabled_only: bool = Query(default=True),
) -> dict[str, Any]:
    """获取技能列表，支持按龙虾 ID 和分类过滤。"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        params: dict[str, str] = {}
        if lobster_id:
            params["lobster_id"] = lobster_id
        if category:
            params["category"] = category
        if not enabled_only:
            params["enabled_only"] = "false"
        try:
            resp = await client.get(f"{DRAGON_SENATE_URL}/api/v1/skills", params=params)
            return resp.json()
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:200], "skills": []}


@app.get("/skills/{skill_id}")
async def get_skill(skill_id: str) -> dict[str, Any]:
    """获取单个技能详情。"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(f"{DRAGON_SENATE_URL}/api/v1/skills/{skill_id}")
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
            return resp.json()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)[:200])


# ── 技能配置 ─────────────────────────────────────────────────────────

@app.put("/skills/{skill_id}/config")
async def update_skill_config(skill_id: str, body: SkillConfigUpdate) -> dict[str, Any]:
    """更新技能配置。"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.put(
                f"{DRAGON_SENATE_URL}/api/skills/{skill_id}/config",
                json=body.model_dump(),
            )
            return resp.json()
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:200]}


@app.patch("/skills/{skill_id}/status")
async def patch_skill_status(skill_id: str, body: SkillStatusPatchRequest) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.patch(
                f"{DRAGON_SENATE_URL}/api/v1/skills/{skill_id}/status",
                json=body.model_dump(),
            )
            return resp.json()
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:200]}


@app.post("/skills/register")
async def register_skill(body: SkillRegisterRequest) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(
                f"{DRAGON_SENATE_URL}/api/v1/skills/register",
                json=body.model_dump(),
            )
            return resp.json()
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:200]}


@app.put("/skills/{skill_id}/enable")
async def enable_skill(skill_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.put(f"{DRAGON_SENATE_URL}/api/skills/{skill_id}/enable")
            return resp.json()
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:200]}


@app.put("/skills/{skill_id}/disable")
async def disable_skill(skill_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.put(f"{DRAGON_SENATE_URL}/api/skills/{skill_id}/disable")
            return resp.json()
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:200]}


# ── 效力评级 ─────────────────────────────────────────────────────────

@app.get("/skills/{skill_id}/effectiveness")
async def get_skill_effectiveness(skill_id: str) -> dict[str, Any]:
    """获取技能效力评级详情。"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(f"{DRAGON_SENATE_URL}/api/skills/{skill_id}/effectiveness")
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
            return resp.json()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)[:200])


@app.get("/skills/recommended")
async def get_recommended_skills(
    lobster_id: str = Query(...),
    industry: str | None = Query(default=None),
    channel: str | None = Query(default=None),
    top_n: int = Query(default=5, le=20),
) -> dict[str, Any]:
    """获取推荐技能列表（按效力评级排序）。"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        params: dict[str, str] = {"lobster_id": lobster_id, "top_n": str(top_n)}
        if industry:
            params["industry"] = industry
        if channel:
            params["channel"] = channel
        try:
            resp = await client.get(f"{DRAGON_SENATE_URL}/api/skills/recommended", params=params)
            return resp.json()
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:200], "recommendations": []}


@app.post("/skills/calibrate")
async def calibrate_skills() -> dict[str, Any]:
    """触发效力评级重新校准。"""
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.post(f"{DRAGON_SENATE_URL}/api/v1/skills/calibrate", json=[])
            return resp.json()
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:200]}
