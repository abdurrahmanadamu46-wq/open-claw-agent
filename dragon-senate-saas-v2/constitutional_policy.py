from __future__ import annotations

import re
from typing import Any


INDUSTRY_KEYWORDS: dict[str, list[str]] = {
    "beauty": ["美妆", "护肤", "彩妆", "成分党", "痘痘", "修护"],
    "hotel": ["酒店", "民宿", "客房", "酒旅", "入住", "度假"],
    "restaurant": ["餐饮", "餐厅", "探店", "美食", "菜品", "外卖"],
    "tcm": ["中医", "养生", "体质", "调理", "经络", "草本"],
    "housekeeping": ["家政", "保洁", "阿姨", "上门", "整理收纳"],
}

INDUSTRY_BASELINES: dict[str, dict[str, Any]] = {
    "beauty": {
        "strategy_version": "beauty_safe_v2",
        "blocked_terms": ["虚假宣传", "绝对无副作用", "永久治愈", "7天根治"],
        "review_terms": ["敏感肌", "孕妇", "医美替代", "药效"],
        "required_points": ["成分依据", "适用人群", "风险提示"],
        "digital_human_defaults": {"expression_intensity": 0.58, "speech_rate": 1.0, "lip_sync_weight": 0.9},
        "vlog_defaults": {"subtitle_density": "medium", "beat_cut_strength": 0.62, "narration_tone": "trustworthy"},
    },
    "hotel": {
        "strategy_version": "hotel_conversion_v2",
        "blocked_terms": ["刷单", "虚假房型", "假活动"],
        "review_terms": ["最便宜", "全网最低价", "无条件退款"],
        "required_points": ["房型亮点", "价格说明", "预约方式"],
        "digital_human_defaults": {"expression_intensity": 0.52, "speech_rate": 0.98, "lip_sync_weight": 0.86},
        "vlog_defaults": {"subtitle_density": "light", "beat_cut_strength": 0.56, "narration_tone": "lifestyle"},
    },
    "restaurant": {
        "strategy_version": "restaurant_growth_v2",
        "blocked_terms": ["虚假折扣", "刷好评", "食品安全造假"],
        "review_terms": ["减肥神效", "医疗功效"],
        "required_points": ["招牌菜亮点", "到店权益", "位置与营业时间"],
        "digital_human_defaults": {"expression_intensity": 0.64, "speech_rate": 1.06, "lip_sync_weight": 0.84},
        "vlog_defaults": {"subtitle_density": "high", "beat_cut_strength": 0.73, "narration_tone": "energetic"},
    },
    "tcm": {
        "strategy_version": "tcm_compliance_v2",
        "blocked_terms": ["包治百病", "替代医生", "处方推荐"],
        "review_terms": ["疗效保证", "快速治愈", "药理结论"],
        "required_points": ["体质适配", "建议咨询专业人士", "个体差异说明"],
        "digital_human_defaults": {"expression_intensity": 0.44, "speech_rate": 0.92, "lip_sync_weight": 0.88},
        "vlog_defaults": {"subtitle_density": "medium", "beat_cut_strength": 0.45, "narration_tone": "calm"},
    },
    "housekeeping": {
        "strategy_version": "housekeeping_trust_v2",
        "blocked_terms": ["伪造资质", "虚假工时"],
        "review_terms": ["全网第一", "绝对无损"],
        "required_points": ["服务边界", "收费规则", "售后机制"],
        "digital_human_defaults": {"expression_intensity": 0.5, "speech_rate": 1.0, "lip_sync_weight": 0.82},
        "vlog_defaults": {"subtitle_density": "medium", "beat_cut_strength": 0.58, "narration_tone": "practical"},
    },
}

DEFAULT_BASELINE: dict[str, Any] = {
    "strategy_version": "general_safe_v1",
    "blocked_terms": ["诈骗", "黑产", "伪造身份"],
    "review_terms": ["自动私信", "自动评论", "批量群发"],
    "required_points": ["风险提示"],
    "digital_human_defaults": {"expression_intensity": 0.5, "speech_rate": 1.0, "lip_sync_weight": 0.82},
    "vlog_defaults": {"subtitle_density": "medium", "beat_cut_strength": 0.55, "narration_tone": "neutral"},
}


def detect_industry_from_text(task_description: str, hot_topics: list[str] | None = None) -> str:
    blob = f"{task_description}\n{' '.join(hot_topics or [])}".lower()
    best = ("general", 0)
    for industry, keywords in INDUSTRY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in blob)
        if score > best[1]:
            best = (industry, score)
    return best[0]


def _extract_customer_requirements(task_description: str) -> list[str]:
    text = str(task_description or "")
    chunks: list[str] = []
    for pattern in [r"(?:客户要求|要求|希望|需要)[：:\s]*(.{0,80})", r"(?:请务必|注意)[：:\s]*(.{0,80})"]:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            value = str(match.group(1) or "").strip("，。,.；; ")
            if value:
                chunks.append(value[:80])
    if not chunks:
        chunks.append(text[:80])
    return chunks[:5]


def _micro_tuning_from_requirements(requirements: list[str]) -> dict[str, Any]:
    blob = " ".join(requirements).lower()
    tuning = {
        "tone": "balanced",
        "pace": "medium",
        "cta_intensity": 0.56,
        "visual_detail_level": "medium",
    }
    if any(token in blob for token in ["稳重", "专业", "可信", "理性"]):
        tuning["tone"] = "trustworthy"
        tuning["cta_intensity"] = 0.48
    if any(token in blob for token in ["活泼", "年轻", "冲击", "强种草"]):
        tuning["tone"] = "energetic"
        tuning["cta_intensity"] = 0.72
    if any(token in blob for token in ["快节奏", "高节奏", "短平快"]):
        tuning["pace"] = "fast"
        tuning["visual_detail_level"] = "high"
    if any(token in blob for token in ["慢节奏", "娓娓道来"]):
        tuning["pace"] = "slow"
    return tuning


def _merge_visual_tuning(industry: str, micro_tuning: dict[str, Any]) -> dict[str, Any]:
    baseline = INDUSTRY_BASELINES.get(industry, DEFAULT_BASELINE)
    digital = dict(baseline.get("digital_human_defaults", {}))
    vlog = dict(baseline.get("vlog_defaults", {}))
    tone = str(micro_tuning.get("tone", "balanced"))
    pace = str(micro_tuning.get("pace", "medium"))

    if tone == "trustworthy":
        digital["expression_intensity"] = round(max(0.35, float(digital.get("expression_intensity", 0.5)) - 0.08), 3)
        vlog["narration_tone"] = "trustworthy"
    elif tone == "energetic":
        digital["expression_intensity"] = round(min(0.82, float(digital.get("expression_intensity", 0.5)) + 0.1), 3)
        vlog["narration_tone"] = "energetic"

    if pace == "fast":
        digital["speech_rate"] = round(min(1.2, float(digital.get("speech_rate", 1.0)) + 0.08), 3)
        vlog["beat_cut_strength"] = round(min(0.9, float(vlog.get("beat_cut_strength", 0.55)) + 0.1), 3)
    elif pace == "slow":
        digital["speech_rate"] = round(max(0.82, float(digital.get("speech_rate", 1.0)) - 0.08), 3)
        vlog["beat_cut_strength"] = round(max(0.35, float(vlog.get("beat_cut_strength", 0.55)) - 0.08), 3)

    return {"digital_human": digital, "vlog": vlog}


def build_policy_context(
    *,
    task_description: str,
    strategy: dict[str, Any],
    hot_topics: list[str] | None = None,
    industry_hint: str | None = None,
) -> dict[str, Any]:
    industry = str(industry_hint or "").strip().lower() or detect_industry_from_text(task_description, hot_topics)
    baseline = INDUSTRY_BASELINES.get(industry, DEFAULT_BASELINE)
    requirements = _extract_customer_requirements(task_description)
    micro_tuning = _micro_tuning_from_requirements(requirements)
    visual_tuning = _merge_visual_tuning(industry, micro_tuning)
    return {
        "industry": industry,
        "strategy_version": baseline.get("strategy_version", "general_safe_v1"),
        "baseline": baseline,
        "customer_requirements": requirements,
        "micro_tuning": micro_tuning,
        "digital_human_tuning": visual_tuning.get("digital_human", {}),
        "vlog_tuning": visual_tuning.get("vlog", {}),
        "strategy_summary": str(strategy.get("strategy_summary", ""))[:500],
    }


def evaluate_policy_context(
    *,
    task_description: str,
    strategy: dict[str, Any],
    policy_context: dict[str, Any],
) -> dict[str, Any]:
    blob = f"{task_description}\n{strategy}".lower()
    baseline = policy_context.get("baseline", {}) if isinstance(policy_context, dict) else {}
    blocked_terms = [term for term in baseline.get("blocked_terms", []) if str(term).lower() in blob]
    review_terms = [term for term in baseline.get("review_terms", []) if str(term).lower() in blob]
    missing_required: list[str] = []
    summary_blob = f"{strategy.get('strategy_summary', '')}\n{strategy.get('cta', '')}".lower()
    for point in baseline.get("required_points", []):
        if str(point).lower() not in summary_blob:
            missing_required.append(str(point))

    reason_codes: list[str] = []
    if blocked_terms:
        reason_codes.append("policy.blocked_terms")
    if review_terms:
        reason_codes.append("policy.review_terms")
    if len(missing_required) >= 2:
        reason_codes.append("policy.required_points_missing")

    decision = "allow"
    if blocked_terms:
        decision = "block"
    elif review_terms or len(missing_required) >= 2:
        decision = "review"

    risk = min(1.0, (len(blocked_terms) * 0.45) + (len(review_terms) * 0.2) + (len(missing_required) * 0.08))
    return {
        "decision": decision,
        "policy_risk": round(float(risk), 4),
        "blocked_terms": blocked_terms,
        "review_terms": review_terms,
        "missing_required_points": missing_required,
        "reason_codes": reason_codes,
    }
