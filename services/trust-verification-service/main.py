"""
零信任安全审计微服务 — FastAPI 总入口
仅内网暴露：点兵虾 (Dispatcher) 与边缘数据接入网关 (WSS Hub) 调用。
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, BackgroundTasks

from core.pre_certifier import PreExecutionCertifier
from core.post_auditor import PostExecutionAuditor
from models.schemas import BehaviorPlan, TelemetryData, VerificationResult

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

pre_certifier = PreExecutionCertifier()
post_auditor = PostExecutionAuditor()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 可选：加载 ML 模型（见 core/ml_models.py）
    yield
    # 可选：释放模型资源
    pass


app = FastAPI(
    title="Lobster Zero-Trust Verification Center",
    description="行为剧本前置 BBP 校验 + 边缘遥测后置环境排雷；仅内网调用。",
    lifespan=lifespan,
)


def _log_pre_audit_failure(plan: BehaviorPlan, result: VerificationResult) -> None:
    logger.warning(
        "[PRE-AUDIT FAILED] session_id=%s reason=%s action_taken=%s",
        plan.session_id,
        result.reason,
        result.action_taken,
    )


def _log_post_audit_failure(telemetry: TelemetryData, result: VerificationResult) -> None:
    logger.warning(
        "[POST-AUDIT FAILED] node_id=%s session_id=%s reason=%s action_taken=%s",
        telemetry.node_id,
        telemetry.session_id,
        result.reason,
        result.action_taken,
    )


@app.post("/api/v1/verify/pre-execution", response_model=VerificationResult)
async def verify_before_dispatch(plan: BehaviorPlan, background_tasks: BackgroundTasks):
    """
    调度层 (Dispatcher) 调用：在把任务派发给边缘节点前，验证剧本是否通过行为生物学指纹 (BBP)。
    若 is_safe=False，应抓取 reason 回传 Behavior Engine，要求「增加高斯噪声延迟并重试」。
    """
    result = pre_certifier.certify_plan(plan)
    if not result.is_safe:
        background_tasks.add_task(_log_pre_audit_failure, plan, result)
    return result


@app.post("/api/v1/verify/post-execution", response_model=VerificationResult)
async def verify_after_execution(
    telemetry: TelemetryData,
    background_tasks: BackgroundTasks,
):
    """
    边缘节点回传：执行完毕后携带遥测请求结算。
    仅当 action_taken=SETTLE_REWARD 时，下游（金算虾/CRM）才进行虾粮结算。
    否则可触发 BAN_NODE / FLAG_NODE_FOR_REVIEW 等，并通过 Event Bus 扣减余额。
    """
    result = post_auditor.audit_telemetry(telemetry)
    if not result.is_safe:
        background_tasks.add_task(_log_post_audit_failure, telemetry, result)
    return result


if __name__ == "__main__":
    import uvicorn
    import os
    host = os.environ.get("VERIFY_HOST", "0.0.0.0")
    port = int(os.environ.get("VERIFY_PORT", "8020"))
    uvicorn.run(app, host=host, port=port)
