"""
反事实解释生成器：特征扰动 + 最小成本搜索
探寻「突破目标分数（如 80 分 Hot Lead）的最短路径」，输出挽回路径给业务员。
"""
import copy
from typing import Dict, Any

from models.schemas import LeadFeature, CounterfactualExplanation
from core.lead_scorer import LeadScorer
from core.knowledge_base import INTENT_WEIGHTS


class CounterfactualExplainer:
    def __init__(self, scorer: LeadScorer, target_threshold: float = 80.0):
        self.scorer = scorer
        self.target_threshold = target_threshold

    def generate_explanation(
        self,
        original_feature: LeadFeature,
        current_score: float,
    ) -> CounterfactualExplanation:
        """寻找最小改变路径 (Minimal Perturbation Path)。"""
        best_perturbation: Dict[str, str] | None = None
        min_cost = float("inf")

        high_value_keywords = [
            kw for kw, w in INTENT_WEIGHTS["keywords"].items() if w > 20
        ]

        for target_kw in high_value_keywords:
            perturbed = copy.deepcopy(original_feature)
            perturbed.content = f"[{target_kw}]"
            new_score = self.scorer.calculate_score(perturbed)

            if new_score >= self.target_threshold:
                cost = 1
                if cost < min_cost:
                    min_cost = cost
                    best_perturbation = {"content_keyword": target_kw}

        for depth_increase in range(1, 10):
            perturbed = copy.deepcopy(original_feature)
            perturbed.interaction_depth = min(
                10,
                original_feature.interaction_depth + depth_increase,
            )
            new_score = self.scorer.calculate_score(perturbed)

            if new_score >= self.target_threshold:
                cost = depth_increase * 0.5
                if cost < min_cost:
                    min_cost = cost
                    best_perturbation = {"interaction_depth": f"+{depth_increase}"}

        if best_perturbation is not None:
            if "content_keyword" in best_perturbation:
                kw = best_perturbation["content_keyword"]
                human_text = (
                    f"虽然当前得分为 {current_score:.0f}，但如果该用户在评论中没有纠结价格，"
                    f"而是询问了核心痛点（如「{kw}」），其得分将跃升至高意向线索。"
                    "建议：使用「回声虾」回复一条强调成分/售后的诱饵话术，测试其反应深度。"
                )
            else:
                inc = best_perturbation["interaction_depth"]
                human_text = (
                    f"该用户目前意向偏冷，但如果系统能引导其多观看几个分镜（互动深度 {inc}），"
                    f"其转化潜力将突破 {self.target_threshold:.0f} 分阈值。"
                )
        else:
            human_text = (
                "该线索质量极低，短期内无有效转化路径，建议放弃跟进。"
            )
            best_perturbation = {"status": "unrecoverable"}

        return CounterfactualExplanation(
            original_score=current_score,
            target_score=self.target_threshold,
            minimal_changes_required=best_perturbation,
            human_readable_explanation=human_text,
        )
