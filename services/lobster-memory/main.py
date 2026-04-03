"""
Lobster memory service.

The vector memory engine depends on Qdrant and embedding models, but the
compression routes should remain available even when that engine is degraded.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from threading import Lock
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from compression_pipeline import router as compression_router

logger = logging.getLogger("lobster_memory.main")
ENGINE_INIT_LOCK = Lock()

QDRANT_HOST = os.environ.get("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.environ.get("QDRANT_PORT", "6333"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.engine = None
    app.state.engine_error = None
    yield
    app.state.engine = None


app = FastAPI(
    title="Lobster Memory API",
    description="Elastic memory service with vector retrieval and three-layer compression.",
    lifespan=lifespan,
)


class StoreExperienceBody(BaseModel):
    node_id: str = Field(..., description="Edge node/device ID")
    intent: str = Field(..., description="Action intent")
    context_data: dict = Field(default_factory=dict, description="Structured context")
    reward: float = Field(0.5, ge=0.0, le=1.0, description="Importance score 0-1")
    persona_id: str | None = Field(None, description="Optional persona scope")
    tenant_id: str = Field("tenant_main", description="Tenant ID")
    lobster_name: str | None = Field(None, description="Optional lobster name")
    memory_type: str = Field("episodic", description="Memory type")


class StoreExperienceResponse(BaseModel):
    point_id: str
    message: str = "记忆已写入"


class RetrieveMemoryBody(BaseModel):
    node_id: str = Field(..., description="Edge node ID")
    current_task: str = Field(..., description="Current task description")
    top_k: int = Field(5, ge=1, le=20, description="Top K results")
    persona_id: str | None = Field(None, description="Optional persona scope")
    tenant_id: str | None = Field(None, description="Tenant ID")
    lobster_name: str | None = Field(None, description="Optional lobster name")
    memory_type: str | None = Field(None, description="Memory type")
    days: int | None = Field(None, ge=1, le=365, description="Recent N days filter")
    use_hybrid: bool = Field(True, description="Enable hybrid search")


class MemoryItem(BaseModel):
    final_score: float
    memory_details: dict


class RetrieveMemoryResponse(BaseModel):
    memories: list[MemoryItem]


def _get_or_create_engine() -> Any:
    engine = getattr(app.state, "engine", None)
    if engine is not None:
        return engine
    with ENGINE_INIT_LOCK:
        engine = getattr(app.state, "engine", None)
        if engine is not None:
            return engine
        try:
            from engine import LobsterMemoryEngine

            engine = LobsterMemoryEngine(
                qdrant_host=QDRANT_HOST,
                qdrant_port=QDRANT_PORT,
            )
            app.state.engine = engine
            app.state.engine_error = None
            return engine
        except Exception as exc:  # noqa: BLE001
            app.state.engine_error = str(exc)
            logger.warning("LobsterMemoryEngine lazy init failed: %s", exc)
            raise HTTPException(status_code=503, detail="lobster memory engine unavailable") from exc


def _require_engine() -> Any:
    engine = _get_or_create_engine()
    return engine


@app.post("/memory/store", response_model=StoreExperienceResponse)
def store_experience(body: StoreExperienceBody):
    try:
        engine = _require_engine()
        point_id = engine.store_experience(
            node_id=body.node_id,
            intent=body.intent,
            context_data=body.context_data,
            reward=body.reward,
            persona_id=body.persona_id,
            tenant_id=body.tenant_id,
            lobster_name=body.lobster_name,
            memory_type=body.memory_type,
        )
        return StoreExperienceResponse(point_id=point_id)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/memory/retrieve", response_model=RetrieveMemoryResponse)
def retrieve_adaptive_memory(body: RetrieveMemoryBody):
    try:
        engine = _require_engine()
        memories = engine.retrieve_adaptive_memory(
            node_id=body.node_id,
            current_task=body.current_task,
            top_k=body.top_k,
            persona_id=body.persona_id,
            tenant_id=body.tenant_id,
            lobster_name=body.lobster_name,
            memory_type=body.memory_type,
            days=body.days,
            use_hybrid=body.use_hybrid,
        )
        return RetrieveMemoryResponse(
            memories=[
                MemoryItem(final_score=item["final_score"], memory_details=item["memory_details"])
                for item in memories
            ]
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/health")
@app.get("/healthz")
def health():
    engine = getattr(app.state, "engine", None)
    engine_error = getattr(app.state, "engine_error", None)
    engine_state = "ready" if engine is not None else ("degraded" if engine_error else "lazy")
    return {
        "ok": True,
        "service": "lobster-memory",
        "status": "ok" if not engine_error else "degraded",
        "engine_ready": engine is not None,
        "engine_state": engine_state,
        "compression_ready": True,
        "engine_error": engine_error,
    }


app.include_router(compression_router)
