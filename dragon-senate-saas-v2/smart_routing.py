"""
Smart model routing inspired by IronClaw's smart-routing design.

This module scores request complexity and maps it onto a 4-tier
model ladder. The actual provider route (local/cloud) is still decided
by the existing LLMRouter. Smart routing only chooses the right model
within the chosen route/provider unless an explicit model override is used.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger("smart_routing")


class ModelTier(str, Enum):
    FLASH = "flash"
    STANDARD = "standard"
    PRO = "pro"
    FRONTIER = "frontier"


GENERIC_TIER_MODEL_MAP: dict[ModelTier, str] = {
    ModelTier.FLASH: "qwen-flash",
    ModelTier.STANDARD: "qwen-plus",
    ModelTier.PRO: "deepseek-reasoner",
    ModelTier.FRONTIER: "o3",
}


PROVIDER_TIER_MODEL_MAP: dict[str, dict[ModelTier, str]] = {
    "local": {
        ModelTier.FLASH: "qwen3:8b",
        ModelTier.STANDARD: "qwen3:14b",
        ModelTier.PRO: "qwen3:59b",
        ModelTier.FRONTIER: "qwen2.5:72b-instruct",
    },
    "deepseek": {
        ModelTier.FLASH: "deepseek-chat",
        ModelTier.STANDARD: "deepseek-chat",
        ModelTier.PRO: "deepseek-reasoner",
        ModelTier.FRONTIER: "deepseek-reasoner",
    },
    "dashscope": {
        ModelTier.FLASH: "qwen-flash",
        ModelTier.STANDARD: "qwen-turbo",
        ModelTier.PRO: "qwen-plus",
        ModelTier.FRONTIER: "qwen-max",
    },
    "volcengine": {
        ModelTier.FLASH: "doubao-1.5-lite-32k",
        ModelTier.STANDARD: "doubao-1.5-pro-32k",
        ModelTier.PRO: "deepseek-v3",
        ModelTier.FRONTIER: "deepseek-r1",
    },
    "openai": {
        ModelTier.FLASH: "gpt-4o-mini",
        ModelTier.STANDARD: "gpt-4.1-mini",
        ModelTier.PRO: "gpt-4.1",
        ModelTier.FRONTIER: "o3",
    },
    "anthropic": {
        ModelTier.FLASH: "claude-3-5-haiku-latest",
        ModelTier.STANDARD: "claude-3-5-sonnet-latest",
        ModelTier.PRO: "claude-sonnet-4-5-latest",
        ModelTier.FRONTIER: "claude-opus-4-5-latest",
    },
    "custom": {
        ModelTier.FLASH: "gpt-4o-mini",
        ModelTier.STANDARD: "qwen-plus",
        ModelTier.PRO: "claude-3-5-sonnet",
        ModelTier.FRONTIER: "gemini-2.5-pro",
    },
}


PATTERN_OVERRIDES: list[tuple[re.Pattern[str], ModelTier]] = [
    (re.compile(r"^(hi|hello|hey|ok|sure|yes|no|thanks|好的|谢谢|是的|不用了|收到|明白|好)[\s!。！？]*$", re.I), ModelTier.FLASH),
    (re.compile(r"^(现在几点|今天几号|今天星期几|what.*(time|date|day)|ping|test|测试|hello world)", re.I), ModelTier.FLASH),
    (re.compile(r"(安全).*(审计|审查|漏洞|扫描)|security.*(audit|review|scan|vulnerability)", re.I), ModelTier.FRONTIER),
    (re.compile(r"(部署|发布|上线).*(生产|正式|production|prod)", re.I), ModelTier.FRONTIER),
    (re.compile(r"(代码审查|code review|重构|refactor|架构设计)", re.I), ModelTier.PRO),
    (re.compile(r"(分析|对比).*(方案|策略|pros.*cons)", re.I), ModelTier.PRO),
]


DIMENSION_WEIGHTS: dict[str, float] = {
    "reasoning_words": 0.14,
    "token_estimate": 0.12,
    "code_indicators": 0.10,
    "multi_step": 0.10,
    "domain_specific": 0.10,
    "creativity": 0.07,
    "question_complexity": 0.07,
    "precision": 0.06,
    "ambiguity": 0.05,
    "context_dependency": 0.05,
    "sentence_complexity": 0.05,
    "tool_likelihood": 0.05,
    "safety_sensitivity": 0.04,
}


DIMENSION_SIGNALS: dict[str, list[str]] = {
    "reasoning_words": [
        "为什么", "解释", "分析", "对比", "权衡", "原因", "如何理解",
        "why", "explain", "analyze", "compare", "trade-off", "reason",
    ],
    "code_indicators": [
        "代码", "函数", "实现", "接口", "pr", "bug", "报错", "调试",
        "implement", "function", "class", "debug", "error", "```",
    ],
    "multi_step": [
        "首先", "然后", "接下来", "最后", "步骤", "流程", "第一步", "一步步",
        "first", "then", "next", "finally", "steps", "workflow",
    ],
    "creativity": [
        "写", "创作", "文案", "标题", "推文", "脚本", "种草笔记", "总结",
        "write", "create", "draft", "summarize", "generate",
    ],
    "tool_likelihood": [
        "发布", "上传", "执行", "运行", "搜索", "查找", "获取", "下载",
        "publish", "upload", "execute", "run", "search", "fetch",
    ],
    "safety_sensitivity": [
        "密码", "密钥", "token", "账号", "权限", "加密", "授权",
        "password", "key", "secret", "auth", "permission", "vulnerability",
    ],
    "context_dependency": [
        "之前", "上次", "刚才", "前面说", "你说过",
        "previous", "earlier", "you said", "last time", "before",
    ],
    "precision": [
        "精确", "精准", "计算", "具体数字", "百分比", "统计",
        "exactly", "precisely", "calculate", "specific", "percentage",
    ],
    "_domain_keywords": [
        "小红书", "抖音", "快手", "带货", "种草", "roi", "gmv",
        "转化率", "涨粉", "粉丝", "引流", "评论区", "私信", "爆款",
    ],
}


@dataclass(slots=True)
class RoutingDecision:
    tier: ModelTier
    model: str
    method: str
    score: int
    pattern: str | None
    dim_scores: dict[str, int] = field(default_factory=dict)
    provider_name: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "tier": self.tier.value,
            "model": self.model,
            "method": self.method,
            "score": self.score,
            "pattern": self.pattern,
            "provider_name": self.provider_name,
            "dim_scores": dict(self.dim_scores),
        }


def normalize_tier(value: Any) -> ModelTier | None:
    if isinstance(value, ModelTier):
        return value
    text = str(value or "").strip().lower()
    if not text:
        return None
    for tier in ModelTier:
        if tier.value == text:
            return tier
    return None


def choose_model_for_provider(
    provider_name: str | None,
    tier: ModelTier,
    fallback_model: str | None = None,
) -> str:
    provider_key = str(provider_name or "").strip().lower()
    provider_map = PROVIDER_TIER_MODEL_MAP.get(provider_key)
    if provider_map and tier in provider_map:
        return provider_map[tier]

    fallback = str(fallback_model or "").strip()
    if fallback:
        return fallback
    return GENERIC_TIER_MODEL_MAP[tier]


def _hits(text_lower: str, signals: list[str]) -> int:
    return sum(1 for signal in signals if signal in text_lower)


def _score_complexity(text: str) -> tuple[int, dict[str, int]]:
    text_lower = str(text or "").lower()
    words = text_lower.split()
    zh_chars = len(re.findall(r"[\u4e00-\u9fff]", text))
    scores: dict[str, int] = {}

    scores["reasoning_words"] = min(100, _hits(text_lower, DIMENSION_SIGNALS["reasoning_words"]) * 30)
    token_est = len(words) + zh_chars * 0.8
    scores["token_estimate"] = min(100, int(token_est / 1.2))
    scores["code_indicators"] = min(100, _hits(text_lower, DIMENSION_SIGNALS["code_indicators"]) * 30)
    scores["multi_step"] = min(100, _hits(text_lower, DIMENSION_SIGNALS["multi_step"]) * 30)
    scores["domain_specific"] = min(100, _hits(text_lower, DIMENSION_SIGNALS["_domain_keywords"]) * 25)
    scores["creativity"] = min(100, _hits(text_lower, DIMENSION_SIGNALS["creativity"]) * 25)
    q_marks = text.count("?") + text.count("？")
    scores["question_complexity"] = min(100, q_marks * 20)
    has_numbers = bool(re.search(r"\d+", text))
    scores["precision"] = min(100, _hits(text_lower, DIMENSION_SIGNALS["precision"]) * 30 + (20 if has_numbers else 0))
    scores["ambiguity"] = max(0, 50 - len(words) * 2)
    scores["context_dependency"] = min(100, _hits(text_lower, DIMENSION_SIGNALS["context_dependency"]) * 30)
    comma_count = text.count(",") + text.count("，") + text.count("、")
    scores["sentence_complexity"] = min(100, comma_count * 15)
    scores["tool_likelihood"] = min(100, _hits(text_lower, DIMENSION_SIGNALS["tool_likelihood"]) * 25)
    scores["safety_sensitivity"] = min(100, _hits(text_lower, DIMENSION_SIGNALS["safety_sensitivity"]) * 40)

    total = sum(scores[key] * weight for key, weight in DIMENSION_WEIGHTS.items())
    high_dim_count = sum(1 for value in scores.values() if value > 50)
    if high_dim_count >= 3:
        total = min(100.0, total * 1.3)
    total = min(100.0, total * 2.5)

    return int(total), {key: int(value) for key, value in scores.items()}


def route_model(
    user_input: str,
    *,
    force_tier: ModelTier | str | None = None,
    provider_name: str | None = None,
    fallback_model: str | None = None,
    custom_model_map: dict[ModelTier, str] | None = None,
) -> RoutingDecision:
    normalized_force_tier = normalize_tier(force_tier)
    effective_map = custom_model_map or PROVIDER_TIER_MODEL_MAP.get(str(provider_name or "").strip().lower(), GENERIC_TIER_MODEL_MAP)

    if normalized_force_tier is not None:
        model = effective_map.get(normalized_force_tier) or choose_model_for_provider(provider_name, normalized_force_tier, fallback_model)
        return RoutingDecision(
            tier=normalized_force_tier,
            model=model,
            method="forced",
            score=-1,
            pattern=None,
            provider_name=provider_name,
        )

    for pattern, tier in PATTERN_OVERRIDES:
        if pattern.search(user_input or ""):
            model = effective_map.get(tier) or choose_model_for_provider(provider_name, tier, fallback_model)
            logger.debug("[SmartRouting] pattern_override -> %s (%s)", tier.value, model)
            return RoutingDecision(
                tier=tier,
                model=model,
                method="pattern_override",
                score=-1,
                pattern=pattern.pattern,
                provider_name=provider_name,
            )

    score, dim_scores = _score_complexity(user_input or "")
    if score <= 15:
        tier = ModelTier.FLASH
    elif score <= 40:
        tier = ModelTier.STANDARD
    elif score <= 65:
        tier = ModelTier.PRO
    else:
        tier = ModelTier.FRONTIER

    model = effective_map.get(tier) or choose_model_for_provider(provider_name, tier, fallback_model)
    logger.info(
        "[SmartRouting] score=%s -> %s model=%s provider=%s",
        score,
        tier.value,
        model,
        provider_name or "-",
    )
    return RoutingDecision(
        tier=tier,
        model=model,
        method="complexity_score",
        score=score,
        pattern=None,
        dim_scores=dim_scores,
        provider_name=provider_name,
    )


__all__ = [
    "ModelTier",
    "RoutingDecision",
    "GENERIC_TIER_MODEL_MAP",
    "PROVIDER_TIER_MODEL_MAP",
    "choose_model_for_provider",
    "normalize_tier",
    "route_model",
    "_score_complexity",
]
