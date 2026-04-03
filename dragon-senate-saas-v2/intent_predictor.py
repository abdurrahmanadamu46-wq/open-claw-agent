"""
Proactive intent prediction helpers inspired by memU.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("intent_predictor")

INTENT_PREDICTOR_SYSTEM_PROMPT = """
你是 ClawCommerce 的用户意图分析专家。
基于刚完成的营销任务，预测用户下一次最可能提出的 3 个需求。

只输出 JSON：
{
  "top_intents": [
    {
      "intent_id": "id_1",
      "title": "意图标题",
      "description": "意图描述",
      "suggested_action": "建议用户下一步可以直接说的话",
      "confidence": 0.82,
      "lobster_hint": "followup"
    }
  ]
}
"""


@dataclass
class PredictedIntent:
    intent_id: str
    title: str
    description: str
    suggested_action: str
    confidence: float
    lobster_hint: str


async def predict_next_intents(
    *,
    llm_router: Any,
    task_summary: str,
    tenant_id: str = "tenant_main",
    max_intents: int = 3,
) -> list[PredictedIntent]:
    try:
        from llm_router import RouteMeta

        raw = await llm_router.routed_ainvoke_text(
            system_prompt=INTENT_PREDICTOR_SYSTEM_PROMPT,
            user_prompt=f"刚完成的任务摘要：\n{task_summary[:3000]}\n\n请预测接下来最可能的 {max_intents} 个需求。",
            meta=RouteMeta(
                critical=False,
                est_tokens=500,
                tenant_tier="basic",
                user_id="intent_predictor",
                tenant_id=tenant_id,
                task_type="intent_prediction",
            ),
            temperature=0.2,
        )
        payload = json.loads(str(raw).strip())
    except Exception as exc:  # noqa: BLE001
        logger.warning("[IntentPredictor] prediction failed: %s", exc)
        return []

    intents: list[PredictedIntent] = []
    for item in list(payload.get("top_intents") or [])[:max_intents]:
        if not isinstance(item, dict):
            continue
        intents.append(
            PredictedIntent(
                intent_id=str(item.get("intent_id") or f"intent_{len(intents) + 1}"),
                title=str(item.get("title") or ""),
                description=str(item.get("description") or ""),
                suggested_action=str(item.get("suggested_action") or ""),
                confidence=float(item.get("confidence", 0.5) or 0.5),
                lobster_hint=str(item.get("lobster_hint") or "followup"),
            )
        )
    return sorted(intents, key=lambda item: item.confidence, reverse=True)


async def store_predicted_intents(
    intents: list[PredictedIntent],
    *,
    lobster: Any,
    task_id: str,
    tenant_id: str,
) -> None:
    if not intents or lobster is None or not hasattr(lobster, "memory"):
        return
    payload = [
        {
            "intent_id": item.intent_id,
            "title": item.title,
            "description": item.description,
            "suggested_action": item.suggested_action,
            "confidence": item.confidence,
            "lobster_hint": item.lobster_hint,
        }
        for item in intents
    ]
    await lobster.memory.remember(
        category="context",
        key=f"predicted_intents_{task_id}",
        value=json.dumps(payload, ensure_ascii=False),
        metadata={
            "source": "intent_predictor",
            "tenant_id": tenant_id,
            "task_id": task_id,
            "predicted_at": time.time(),
        },
    )


async def retrieve_pending_intents(lobster: Any, *, limit: int = 3) -> list[dict[str, Any]]:
    if lobster is None or not hasattr(lobster, "memory"):
        return []
    items = await lobster.memory.list_by_category("context")
    pending: list[dict[str, Any]] = []
    for item in items:
        metadata = item.get("metadata") or {}
        if str(metadata.get("source") or "") != "intent_predictor":
            continue
        try:
            payload = json.loads(str(item.get("content") or "").split("\n\n---\n", 1)[0].split("\n\n", 1)[1])
        except Exception:
            raw = str(item.get("content") or "")
            try:
                payload = json.loads(raw)
            except Exception:
                continue
        if isinstance(payload, list):
            pending.extend(payload)
        if len(pending) >= limit:
            break
    pending.sort(key=lambda item: float(item.get("confidence", 0) or 0), reverse=True)
    return pending[:limit]
