"""
前置审计：行为生物学指纹 (BBP) 校验
原则：「人类充满不确定性，过于完美的匀速就是机器。」
"""
import numpy as np
from models.schemas import BehaviorPlan, VerificationResult


class PreExecutionCertifier:
    """调度层在下发前调用，拦截机器味过重的行为剧本。"""

    def __init__(self):
        # 实际生产中可加载训练好的行为基线模型（见 core/ml_models.py）
        pass

    def certify_plan(self, plan: BehaviorPlan) -> VerificationResult:
        """
        前置审计：若延迟方差极低或交互频率超出人类物理极限，则 BLOCK_AND_REGENERATE。
        """
        delays = [s.delay for s in plan.steps if s.delay is not None]
        durations = [s.duration for s in plan.steps if s.duration is not None]

        # 规则 1：方差检测 (Variance Check)
        # 若所有延迟都是 2.000 秒级、方差接近 0，视为写死脚本
        if len(delays) > 3:
            delay_variance = float(np.var(delays))
            if delay_variance < 0.05:
                return VerificationResult(
                    is_safe=False,
                    risk_score=0.95,
                    reason="BBP_ALERT: 动作延迟方差极低，呈现出机器匀速特征",
                    action_taken="BLOCK_AND_REGENERATE",
                )

        # 规则 2：高危动作频率阈值 (Rate Limiting)
        like_comment_count = sum(
            1 for s in plan.steps if s.action in ("like", "comment")
        )
        total_time = sum(delays) + sum(durations)

        if total_time > 0 and (like_comment_count / total_time) > 0.5:
            return VerificationResult(
                is_safe=False,
                risk_score=0.88,
                reason="RATE_LIMIT_ALERT: 交互频率过高，超出正常人类阅读速度的物理极限",
                action_taken="BLOCK_AND_REGENERATE",
            )

        return VerificationResult(
            is_safe=True,
            risk_score=0.1,
            reason="Pass",
            action_taken="ALLOW",
        )
