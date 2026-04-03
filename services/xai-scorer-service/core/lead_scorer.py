"""
基础线索打分引擎（模拟金算虾核心逻辑）
生产可接入 DeepSeek-V3 评分大模型或 XGBoost 回归。
"""
from models.schemas import LeadFeature
from core.knowledge_base import INTENT_WEIGHTS


class LeadScorer:
    def __init__(self, base_score: float = 50.0):
        self.base_score = base_score

    def calculate_score(self, feature: LeadFeature) -> float:
        """根据特征计算当前线索的商业价值得分 (0-100)。"""
        score = self.base_score

        for kw, weight in INTENT_WEIGHTS["keywords"].items():
            if kw in feature.content:
                score += weight

        score += (feature.interaction_depth - 1) * 2

        score += INTENT_WEIGHTS["personas"].get(feature.persona_tag, 0)

        return max(0.0, min(100.0, score))
