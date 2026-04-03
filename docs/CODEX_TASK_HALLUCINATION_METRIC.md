# CODEX TASK: 龙虾幻觉检测评估指标（HallucinationMetric）

**优先级：P2**  
**来源：OPIK_BORROWING_ANALYSIS.md P2-#4（Opik Hallucination Metric）**

---

## 背景

`llm_quality_judge.py` 已有通用评判，但缺少基于"记忆上下文"的幻觉专项检测——即龙虾是否凭空捏造了不在召回记忆中的信息。借鉴 Opik Hallucination 指标，新增 `HallucinationMetric`，集成到 `llm_quality_judge.py` 和 ExperimentRegistry 评估指标列表。

---

## 实现

```python
# dragon-senate-saas-v2/hallucination_metric.py

import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

HALLUCINATION_JUDGE_PROMPT = """
你是一个专业的AI输出质量评估员。
任务：判断"龙虾输出"是否包含幻觉（即捏造了上下文记忆中不存在的信息）。

【用户指令】
{input}

【龙虾可用的记忆上下文】
{context}

【龙虾的实际输出】
{output}

请判断：龙虾的输出是否包含了记忆上下文中不存在的、被捏造的关键事实？

评分规则：
- 0.0：完全基于上下文，无捏造
- 0.3：有轻微推断，但不影响核心事实
- 0.6：有明显捏造，关键信息与上下文不符
- 1.0：严重幻觉，大量捏造

只输出 JSON：{{"score": 0.0, "reason": "简短说明"}}
"""


@dataclass
class HallucinationScore:
    value: float        # 0.0（无幻觉）~ 1.0（严重幻觉）
    reason: str         # 评分理由
    passed: bool        # value < threshold 则通过


class HallucinationMetric:
    """
    基于召回上下文的幻觉检测指标
    
    使用方式：
      metric = HallucinationMetric(llm_caller, threshold=0.3)
      score = await metric.score(
          input="帮我写给王老板的感谢信",
          output=lobster_output,
          context=retrieved_memory_texts,
      )
      if not score.passed:
          logger.warning(f"幻觉检测不通过: {score.reason}")
    """

    METRIC_NAME = "hallucination"

    def __init__(self, llm_caller, threshold: float = 0.3):
        """
        Args:
            llm_caller: 调用 LLM 的函数（复用已有 llm_call_logger 封装）
            threshold: 幻觉得分阈值，超过则视为不通过（默认 0.3）
        """
        self.llm = llm_caller
        self.threshold = threshold

    async def score(
        self,
        input: str,
        output: str,
        context: str | list[str],  # 从 enterprise_memory 召回的记忆文本
        model: str = "gpt-4o-mini",
    ) -> HallucinationScore:
        """
        评估幻觉分数
        
        Args:
            input: 用户原始指令
            output: 龙虾生成的输出
            context: 记忆上下文（字符串或列表）
        """
        if isinstance(context, list):
            context_text = "\n---\n".join(context)
        else:
            context_text = context

        prompt = HALLUCINATION_JUDGE_PROMPT.format(
            input=input,
            context=context_text[:4000],  # 截断防止超长
            output=output[:2000],
        )

        try:
            import json
            response = await self.llm.call_async(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                response_format={"type": "json_object"},
            )
            result = json.loads(response.choices[0].message.content)
            value = float(result.get("score", 0.5))
            reason = result.get("reason", "")
        except Exception as e:
            logger.warning(f"[HallucinationMetric] 评估失败: {e}")
            value = 0.5  # 失败时保守返回中间值
            reason = f"评估失败: {e}"

        return HallucinationScore(
            value=round(value, 3),
            reason=reason,
            passed=value < self.threshold,
        )


# ── 集成到 llm_quality_judge.py ─────────────────────────
#
# class LLMQualityJudge:
#
#     def __init__(self, ...):
#         ...
#         self.hallucination_metric = HallucinationMetric(self.llm_caller)
#
#     async def evaluate_with_context(
#         self,
#         input: str,
#         output: str,
#         context: list[str],  # 从 enterprise_memory.search() 获取
#         metrics: list[str] = None,
#     ) -> dict[str, float]:
#         scores = {}
#
#         if metrics is None or "hallucination" in metrics:
#             h_score = await self.hallucination_metric.score(input, output, context)
#             scores["hallucination"] = h_score.value
#             if not h_score.passed:
#                 logger.warning(
#                     f"[QualityJudge] 幻觉检测不通过 (score={h_score.value}): {h_score.reason}"
#                 )
#
#         return scores
```

---

## 验收标准

- [ ] `HallucinationMetric.score(input, output, context)`：返回 `HallucinationScore`
- [ ] context 支持 `str | list[str]`，超长自动截断（4000字）
- [ ] LLM 调用失败时返回保守值 0.5（不崩溃）
- [ ] 集成到 `LLMQualityJudge.evaluate_with_context()`
- [ ] `metrics=["hallucination"]` 时触发幻觉检测
- [ ] 在 ExperimentRegistry 的评估指标列表中注册 "hallucination"
- [ ] 幻觉不通过时（score >= threshold）写入 `llm_call_logger` 警告日志

---

*Codex Task | 来源：OPIK_BORROWING_ANALYSIS.md P2-#4 | 2026-04-02*
