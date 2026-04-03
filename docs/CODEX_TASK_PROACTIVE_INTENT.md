# CODEX TASK: 主动意图捕获（commander 会话结束后预判下次需求）

> **任务来源**：G12 — memU 借鉴分析差距报告 2026-04-01  
> **参考文档**：docs/MEMU_BORROWING_ANALYSIS.md / docs/BORROWING_GAP_ANALYSIS_2026-04-01.md  
> **优先级**：🟠 P1 重要（当前完全被动等待用户，错失大量主动服务机会）  
> **预估工作量**：2 天  
> **负责人**：Codex  

---

## ⚠️ 开始前：冲突检查（必须执行）

```bash
# 1. 检查 commander_router.py 是否已有任务完成后的主动行为
grep -n "proactive\|next_task\|predict\|intent\|after_complete\|post_mission" \
  dragon-senate-saas-v2/commander_router.py 2>/dev/null | head -20

# 2. 检查 memory_compressor.py 是否已有意图提炼
grep -n "intent\|predict\|next_session\|user_goal" \
  dragon-senate-saas-v2/memory_compressor.py 2>/dev/null | head -10

# 3. 检查 followup 龙虾是否已有主动推送能力
grep -n "proactive\|push\|remind\|schedule\|next_touch" \
  dragon-senate-saas-v2/lobsters/followup.py 2>/dev/null | head -10

# 4. 确认 notification_center.py 存在
ls dragon-senate-saas-v2/notification_center.py 2>/dev/null && echo "OK" || echo "需新建"
```

**冲突解决原则**：
- 若 commander 已有任务完成回调：在其基础上新增意图推断步骤，不替换
- 意图推断是**轻量 LLM 调用**，不是完整龙虾任务，使用低成本模型（basic tier）
- 推断结果存入 memory，不自动执行，只在下次用户启动时作为建议提示

---

## 一、任务目标

实现 memU 风格的主动意图捕获，让 commander 在每次任务完成后预判下次需求：
1. **任务完成回调**：龙虾链路完成后，commander 自动调用意图推断
2. **意图提炼**：基于本次任务的上下文，预测用户下次最可能的需求（Top3）
3. **意图存储**：将预测结果写入 lobster memory（followup 龙虾的 memory）
4. **下次唤醒**：下次用户启动时，commander 主动展示"您可能想要..."建议

---

## 二、实施方案

### 2.1 新建 intent_predictor.py

**目标文件**：`dragon-senate-saas-v2/intent_predictor.py`（新建）

```python
"""
IntentPredictor — 主动意图预测器
借鉴 memU 主动意图捕获机制

在任务完成后，基于任务上下文预测用户下次最可能的需求，
存入 lobster memory，供下次启动时主动提示。
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("intent_predictor")

INTENT_PREDICTOR_SYSTEM_PROMPT = """
你是 ClawCommerce 用户意图分析专家。
基于刚完成的营销任务，预测用户下次最可能的3个需求。

输出格式（严格 JSON，不要任何解释）：
{
  "top_intents": [
    {
      "intent_id": "unique_id_1",
      "title": "简短意图标题（10字以内）",
      "description": "意图描述（30字以内）",
      "suggested_action": "建议用户说的话",
      "confidence": 0.9,
      "lobster_hint": "哪只龙虾最可能处理此意图"
    }
  ],
  "reasoning": "简短推断理由"
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
    """
    基于本次任务摘要，预测用户下次的意图

    Args:
        llm_router: LLMRouter 实例（低成本 basic tier 调用）
        task_summary: 本次任务的简短摘要（由 commander 生成）
        tenant_id: 租户 ID
        max_intents: 最多预测几个意图

    Returns:
        PredictedIntent 列表（按 confidence 降序）
    """
    try:
        from llm_router import RouteMeta
        meta = RouteMeta(
            critical=False,
            est_tokens=500,
            tenant_tier="basic",
            user_id="intent_predictor",
            tenant_id=tenant_id,
            task_type="intent_prediction",
        )
        user_prompt = (
            f"刚完成的任务摘要：\n{task_summary}\n\n"
            f"请预测用户接下来最可能的 {max_intents} 个需求，输出 JSON："
        )
        raw = await llm_router.routed_ainvoke_text(
            system_prompt=INTENT_PREDICTOR_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            meta=meta,
            temperature=0.3,
        )
        data = json.loads(raw.strip())
        intents = []
        for item in data.get("top_intents", [])[:max_intents]:
            intents.append(PredictedIntent(
                intent_id=str(item.get("intent_id", "")),
                title=str(item.get("title", "")),
                description=str(item.get("description", "")),
                suggested_action=str(item.get("suggested_action", "")),
                confidence=float(item.get("confidence", 0.5)),
                lobster_hint=str(item.get("lobster_hint", "commander")),
            ))
        return sorted(intents, key=lambda i: i.confidence, reverse=True)
    except Exception as e:
        logger.warning("[IntentPredictor] Prediction failed: %s", e)
        return []


async def store_predicted_intents(
    intents: list[PredictedIntent],
    *,
    lobster: Any,  # followup lobster（有 memory 属性）
    task_id: str,
    tenant_id: str,
) -> None:
    """
    将预测意图存入 followup 龙虾的 memory
    下次会话启动时，commander 从 memory 中读取并展示建议
    """
    if not intents or lobster is None or not hasattr(lobster, "memory"):
        return
    try:
        intent_data = [
            {
                "intent_id": i.intent_id,
                "title": i.title,
                "description": i.description,
                "suggested_action": i.suggested_action,
                "confidence": i.confidence,
                "lobster_hint": i.lobster_hint,
            }
            for i in intents
        ]
        await lobster.memory.remember(
            category="predicted_intents",
            key=f"task_{task_id}_next_intents",
            value=json.dumps(intent_data, ensure_ascii=False),
            metadata={
                "source": "intent_predictor",
                "task_id": task_id,
                "tenant_id": tenant_id,
                "predicted_at": time.time(),
            },
        )
        logger.info(
            "[IntentPredictor] Stored %d intents for task %s",
            len(intents), task_id,
        )
    except Exception as e:
        logger.warning("[IntentPredictor] Failed to store intents: %s", e)


async def retrieve_pending_intents(
    lobster: Any,
    *,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """
    从 followup 龙虾 memory 中读取最近的预测意图
    供 commander 在下次会话启动时展示
    """
    if lobster is None or not hasattr(lobster, "memory"):
        return []
    try:
        memories = await lobster.memory.recall(
            query="predicted_intents",
            category="predicted_intents",
            top_k=limit,
        )
        intents = []
        for m in memories:
            try:
                value = m.get("content") or m.get("value", "")
                items = json.loads(value) if isinstance(value, str) else value
                if isinstance(items, list):
                    intents.extend(items)
            except (json.JSONDecodeError, TypeError):
                pass
        return intents[:limit]
    except Exception as e:
        logger.warning("[IntentPredictor] Failed to retrieve intents: %s", e)
        return []
```

### 2.2 在 commander 任务完成后触发预测

**目标文件**：`dragon-senate-saas-v2/commander_router.py`  
**修改位置**：任务完成回调处

```python
# 在 commander 任务完成后（after_mission_complete）异步触发意图预测

from intent_predictor import predict_next_intents, store_predicted_intents

async def _post_mission_intent_prediction(
    *,
    llm_router: Any,
    task_summary: str,
    task_id: str,
    tenant_id: str,
    followup_lobster: Any,
) -> None:
    """任务完成后的异步意图预测（不阻塞主流程）"""
    try:
        intents = await predict_next_intents(
            llm_router=llm_router,
            task_summary=task_summary,
            tenant_id=tenant_id,
        )
        await store_predicted_intents(
            intents,
            lobster=followup_lobster,
            task_id=task_id,
            tenant_id=tenant_id,
        )
    except Exception as e:
        logger.warning("[Commander] Post-mission intent prediction failed: %s", e)
```

### 2.3 会话启动时展示意图建议

**目标文件**：`dragon-senate-saas-v2/app.py`  
**新增端点**：

```python
# GET /api/v1/commander/suggested-intents
# 返回 commander 预测的下次可能需求

@app.get("/api/v1/commander/suggested-intents")
async def get_suggested_intents(tenant_id: str = "tenant_main"):
    """返回预测的用户意图（供前端在对话框打开时展示）"""
    from intent_predictor import retrieve_pending_intents
    # 通过 followup 龙虾的 memory 获取
    try:
        from lobsters.followup import Followup
        followup = Followup()
        followup.bind_runtime_context(tenant_id)
        intents = await retrieve_pending_intents(followup)
        return {"suggested_intents": intents, "tenant_id": tenant_id}
    except Exception as e:
        return {"suggested_intents": [], "error": str(e)}
```

---

## 三、前端工程师对接说明

### 对话框打开时展示意图建议

```typescript
// 在对话框/聊天界面打开时，调用接口获取建议
// GET /api/v1/commander/suggested-intents

interface SuggestedIntent {
  intent_id: string;
  title: string;              // "发布内容" / "查看本周报告" 等
  description: string;
  suggested_action: string;   // 点击后填入输入框的内容
  confidence: number;         // 0-1，展示优先级
  lobster_hint: string;       // 哪只龙虾处理（供颜色标记）
}

// UI 建议：
// - 在对话框顶部展示 2-3 个快捷建议卡片
// - 点击卡片 → 自动填入 suggested_action → 用户确认后发送
// - 样式参考：微信/钉钉的"猜你想问"快捷回复
```

---

## 四、验收标准

- [ ] `predict_next_intents(llm_router, task_summary="发布了10篇小红书笔记")` 返回3个 PredictedIntent
- [ ] `store_predicted_intents(intents, lobster=followup_lobster, ...)` 写入 memory 成功
- [ ] `retrieve_pending_intents(followup_lobster)` 返回存储的意图列表
- [ ] GET /api/v1/commander/suggested-intents 返回 200 + intents 列表
- [ ] 任务完成后异步触发预测（不阻塞任务返回）
- [ ] LLM 调用使用 basic tier（低成本）

---

## 五、实施顺序

```
Day 1（4小时）：
  ① 冲突检查（4条 grep）
  ② 新建 intent_predictor.py（见 2.1）
  ③ 在 commander_router.py 中新增 _post_mission_intent_prediction()（见 2.2）

Day 2（2小时）：
  ④ 在 app.py 新增 GET /api/v1/commander/suggested-intents（见 2.3）
  ⑤ 端到端测试：完成一次任务 → 意图存储 → 接口查询
  ⑥ 更新 PROJECT_CONTROL_CENTER.md（标记 CODEX_MEMU_PROACTIVE_INTENT 为 ✅）
```

---

*创建时间：2026-04-01 | 来源：BORROWING_GAP_ANALYSIS_2026-04-01.md G12*
