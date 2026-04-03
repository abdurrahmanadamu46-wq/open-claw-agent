"""
策略张量衰减与反馈更新算法
公式：T_{t+1} = clip(T_t + η · (λ1·Reward_conv - λ2·Risk_alert), 0, 1)
引入学习率 η 防止策略震荡。
"""
from typing import Tuple

from models.schemas import PolicyTensor, FeedbackEvent


def clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def update_tensor(
    current: PolicyTensor,
    event: FeedbackEvent,
    eta: float,
    lambda_reward: float,
    lambda_risk: float,
) -> PolicyTensor:
    """
    根据反馈事件更新策略张量。
    - 转化分高 → 可适当提高激进度与转化导向
    - 风险分高 → 提高拟真度、降低激进度，实现“呼吸感”与自愈
    """
    delta = eta * (lambda_reward * event.conversion_score - lambda_risk * event.risk_score)

    # 激进度：转化加分、风险减分
    new_agg = clip(current.aggressiveness + delta, 0.0, 1.0)
    # 拟真度：风险加分（风控高时更拟真）、转化略减
    new_auth = clip(
        current.authenticity + eta * (event.risk_score * 0.8 - event.conversion_score * 0.2),
        0.0,
        1.0,
    )
    # 转化导向：转化加分、风险减分
    new_conv = clip(current.conversion_focus + delta * 0.7, 0.0, 1.0)

    return PolicyTensor(
        aggressiveness=new_agg,
        authenticity=new_auth,
        conversion_focus=new_conv,
    )
