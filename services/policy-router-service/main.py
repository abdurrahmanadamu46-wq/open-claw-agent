"""
策略张量与上下文路由器 — FastAPI 启动入口与路由映射
生产环境可依赖 Redis 维持策略状态同步；未配置时使用进程内内存。
"""
import json
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from redis import asyncio as aioredis

from config import (
    REDIS_URL,
    REDIS_POLICY_KEY,
    LEARNING_RATE,
    LAMBDA_REWARD,
    LAMBDA_RISK,
    use_redis,
)
from core.prompt_builder import ContextRouter
from core.tensor_math import update_tensor
from models.schemas import PolicyTensor, FeedbackEvent, AgentPromptRequest, AgentPromptResponse

# 进程内默认张量（无 Redis 或 Redis 无键时使用）
DEFAULT_TENSOR = PolicyTensor(aggressiveness=0.5, authenticity=0.8, conversion_focus=0.5)

# 内存态（Redis 未启用时唯一状态源）
MEMORY_STATE: dict[str, PolicyTensor] = {"current_tensor": DEFAULT_TENSOR}


async def get_redis():
    if not use_redis():
        return None
    try:
        return await aioredis.from_url(REDIS_URL, decode_responses=True)
    except Exception:
        return None


async def load_tensor_from_redis(redis) -> Optional[PolicyTensor]:
    if redis is None:
        return None
    try:
        raw = await redis.get(REDIS_POLICY_KEY)
        if not raw:
            return None
        data = json.loads(raw)
        return PolicyTensor(**data)
    except Exception:
        return None


async def save_tensor_to_redis(redis, tensor: PolicyTensor) -> None:
    if redis is None:
        return
    try:
        await redis.set(REDIS_POLICY_KEY, tensor.model_dump_json())
    except Exception:
        pass


async def get_current_tensor(redis) -> PolicyTensor:
    if redis is not None:
        t = await load_tensor_from_redis(redis)
        if t is not None:
            return t
    return MEMORY_STATE["current_tensor"]


async def set_current_tensor(redis, tensor: PolicyTensor) -> None:
    MEMORY_STATE["current_tensor"] = tensor
    await save_tensor_to_redis(redis, tensor)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = await get_redis()
    yield
    if getattr(app.state, "redis", None) is not None:
        try:
            await app.state.redis.aclose()
        except Exception:
            pass
    app.state.redis = None


app = FastAPI(
    title="Lobster Policy & Context Router",
    description="策略张量 + 上下文路由器：反馈闭环更新张量，按 Agent 动态组装 Prompt",
    lifespan=lifespan,
)
router_ctx = ContextRouter()


@app.get("/api/v1/policy/current", response_model=PolicyTensor)
async def get_current_policy():
    """管理后台 / 金算虾 / 铁网虾：查看当前系统大盘的策略张量。"""
    redis = app.state.redis
    return await get_current_tensor(redis)


@app.post("/api/v1/policy/feedback")
async def process_telemetry_feedback(event: FeedbackEvent):
    """
    闭环核心：接收边缘节点或风控审计的反馈，动态更新张量。
    使用公式 T_{t+1} = clip(T_t + η·(λ1·Reward - λ2·Risk), 0, 1)。
    """
    redis = app.state.redis
    current = await get_current_tensor(redis)
    next_tensor = update_tensor(
        current,
        event,
        eta=LEARNING_RATE,
        lambda_reward=LAMBDA_REWARD,
        lambda_risk=LAMBDA_RISK,
    )
    await set_current_tensor(redis, next_tensor)
    return {"status": "tensor_updated", "new_tensor": next_tensor}


@app.post("/api/v1/context/generate", response_model=AgentPromptResponse)
async def generate_agent_context(req: AgentPromptRequest):
    """
    Agent 调用口：各龙虾在执行任务前到此领取动态 Prompt。
    """
    redis = app.state.redis
    tensor = await get_current_tensor(redis)
    dynamic_prompt = router_ctx.build_prompt_for_agent(
        agent_id=req.agent_id,
        task=req.base_task,
        tensor=tensor,
    )
    return AgentPromptResponse(
        agent_id=req.agent_id,
        applied_tensor=tensor,
        injected_prompt=dynamic_prompt,
    )


if __name__ == "__main__":
    import uvicorn
    from config import HOST, PORT
    uvicorn.run(app, host=HOST, port=PORT)
