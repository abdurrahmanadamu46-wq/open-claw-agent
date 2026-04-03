# CODEX TASK: 答案相关性指标（Answer Relevance，反向问题生成法）

**优先级：P2**  
**来源：RAGAS_BORROWING_ANALYSIS.md P2-#3（Ragas Answer Relevancy）**

---

## 背景

`HallucinationMetric`（已落地）解决"龙虾是否捏造"，但不解决"龙虾是否答非所问"。Ragas 的 Answer Relevance 创新在于**不需要参考答案**：从龙虾输出中反向生成 N 个假设问题，计算这些假设问题与原始问题的语义相似度，相似度越高说明答案越切题。集成到 `llm_quality_judge.py`。

---

## 实现

```python
# dragon-senate-saas-v2/answer_relevance_metric.py

import asyncio
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

REVERSE_QUESTION_PROMPT = """
基于以下回答，生成 {n} 个可能触发这个回答的问题。
要求：这些问题应该是这个回答在自然场景下可能被问到的真实问题。

【回答内容】
{answer}

只输出 JSON：{{"questions": ["问题1", "问题2", "问题3"]}}
"""


@dataclass
class AnswerRelevanceScore:
    value: float          # 0.0（完全不相关）~ 1.0（完全切题）
    hypothesis_questions: list[str]  # 生成的假设问题列表
    avg_similarity: float  # 平均语义相似度


class AnswerRelevanceMetric:
    """
    答案相关性评估（无需参考答案，反向问题生成法）
    
    算法：
      1. 从龙虾输出中生成 N 个假设问题
      2. 计算每个假设问题与原始问题的余弦相似度（embedding）
      3. 平均值即为答案相关性分数
    
    使用方式：
      metric = AnswerRelevanceMetric(llm_caller, embedder)
      score = await metric.score(
          question="帮我分析这个月的销售趋势",
          answer=lobster_output,
      )
      # score.value = 0.82（答案基本切题）
    """

    METRIC_NAME = "answer_relevance"

    def __init__(self, llm_caller, embedder, n_hypotheses: int = 3, threshold: float = 0.7):
        self.llm = llm_caller
        self.embedder = embedder    # 复用已有 dense embedder（OpenAI text-embedding）
        self.n = n_hypotheses
        self.threshold = threshold

    async def score(
        self,
        question: str,
        answer: str,
        model: str = "gpt-4o-mini",
    ) -> AnswerRelevanceScore:
        """计算答案相关性"""
        if not answer.strip():
            return AnswerRelevanceScore(0.0, [], 0.0)

        # Step 1: 从答案生成 N 个假设问题
        hypothesis_questions = await self._generate_hypotheses(answer, model)
        if not hypothesis_questions:
            return AnswerRelevanceScore(0.5, [], 0.5)

        # Step 2: 计算相似度（并行 embed）
        texts_to_embed = [question] + hypothesis_questions
        embeddings = await asyncio.gather(*[
            asyncio.to_thread(self.embedder.embed, t) for t in texts_to_embed
        ])

        question_emb = embeddings[0]
        hyp_embs = embeddings[1:]

        # 余弦相似度
        similarities = [self._cosine_similarity(question_emb, h) for h in hyp_embs]
        avg_sim = sum(similarities) / len(similarities)

        return AnswerRelevanceScore(
            value=round(avg_sim, 3),
            hypothesis_questions=hypothesis_questions,
            avg_similarity=round(avg_sim, 3),
        )

    async def _generate_hypotheses(self, answer: str, model: str) -> list[str]:
        """从答案反向生成假设问题"""
        try:
            import json
            prompt = REVERSE_QUESTION_PROMPT.format(n=self.n, answer=answer[:2000])
            resp = await self.llm.call_async(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,
                model=model,
                response_format={"type": "json_object"},
            )
            data = json.loads(resp.choices[0].message.content)
            return data.get("questions", [])[:self.n]
        except Exception as e:
            logger.warning(f"[AnswerRelevance] 假设问题生成失败: {e}")
            return []

    @staticmethod
    def _cosine_similarity(a: list[float], b: list[float]) -> float:
        """计算两个向量的余弦相似度"""
        import math
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)


# 集成到 llm_quality_judge.py：
#
# class LLMQualityJudge:
#     def __init__(self, ...):
#         self.answer_relevance_metric = AnswerRelevanceMetric(
#             llm_caller=self.llm_caller,
#             embedder=self.dense_embedder,
#         )
#
#     async def evaluate_async(self, lobster_name, input, output, metrics=None):
#         scores = {}
#         if metrics is None or "answer_relevance" in metrics:
#             ar = await self.answer_relevance_metric.score(input, output)
#             scores["answer_relevance"] = ar.value
#         return scores
```

---

## 验收标准

- [ ] `AnswerRelevanceMetric.score(question, answer)`：返回 `AnswerRelevanceScore`
- [ ] `_generate_hypotheses()`：LLM 反向生成 N 个假设问题（默认3个）
- [ ] `_cosine_similarity()`：纯 Python 实现，无额外依赖
- [ ] 并行 embed（`asyncio.gather` + `asyncio.to_thread`）
- [ ] 集成到 `LLMQualityJudge.evaluate_async()`
- [ ] `metrics=["answer_relevance"]` 时触发

---

*Codex Task | 来源：RAGAS_BORROWING_ANALYSIS.md P2-#3 | 2026-04-02*
