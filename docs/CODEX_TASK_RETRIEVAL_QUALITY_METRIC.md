# CODEX TASK: 龙虾记忆检索质量评估（Context Precision + Recall）

**优先级：P1**  
**来源：RAGAS_BORROWING_ANALYSIS.md P1-#2（Ragas Context Precision/Recall）**

---

## 背景

龙虾的 RAG 流程（`enterprise_memory.search()` → 召回记忆 → 拼入 prompt）存在两个盲区：①召回了不相关记忆（噪声，浪费 token）②遗漏了关键记忆（信息缺失）。借鉴 Ragas 的 Context Precision + Context Recall，新增检索质量评估指标，集成到 ExperimentRegistry，让龙虾进化决策有检索维度的数据支撑。

**依赖**：需先有 RAG 测试集（`CODEX_TASK_RAG_TESTSET_GENERATOR` 生成）

---

## 一、核心实现

```python
# dragon-senate-saas-v2/retrieval_quality_metric.py

import asyncio
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

CONTEXT_PRECISION_PROMPT = """
判断以下"召回上下文"中，每个片段是否对回答"问题"有帮助。

【问题】
{question}

【参考答案】
{ground_truth}

【召回的上下文片段列表】
{contexts_numbered}

对每个片段评分：1（相关，对回答有帮助）或 0（无关，噪声）
输出 JSON：{{"scores": [1, 0, 1, ...]}}（与片段顺序一一对应）
"""

CONTEXT_RECALL_PROMPT = """
判断"参考答案"中的关键信息，是否都能从"召回的上下文"中找到支撑。

【问题】
{question}

【参考答案（标准答案）】
{ground_truth}

【召回的上下文】
{contexts_text}

请列出参考答案的关键主张，并判断每条是否在上下文中有依据。
输出 JSON：{{"claims": [{{"claim": "...", "supported": true/false}}]}}
"""


@dataclass
class RetrievalQualityScore:
    context_precision: float    # 0.0~1.0：召回上下文的精确率
    context_recall: float       # 0.0~1.0：关键信息的召回率
    retrieved_count: int        # 召回了多少条
    relevant_count: int         # 其中有多少条是相关的
    claims_total: int           # 标准答案有多少个主张
    claims_supported: int       # 其中多少有上下文支撑


class RetrievalQualityMetric:
    """
    龙虾记忆检索质量评估
    
    使用方式：
      metric = RetrievalQualityMetric(llm_caller)
      score = await metric.score(
          question="王老板上次提到的合同金额是多少？",
          ground_truth="150万元",
          retrieved_contexts=["...记忆片段1...", "...记忆片段2..."],
      )
      # score.context_precision = 0.73（73%的召回是相关的）
      # score.context_recall = 0.85（85%的关键信息被召回了）
    """

    METRIC_NAMES = ["context_precision", "context_recall"]

    def __init__(self, llm_caller):
        self.llm = llm_caller

    async def score(
        self,
        question: str,
        ground_truth: str,
        retrieved_contexts: list[str],
        model: str = "gpt-4o-mini",
    ) -> RetrievalQualityScore:
        """并行计算 Precision + Recall"""
        if not retrieved_contexts:
            return RetrievalQualityScore(0.0, 0.0, 0, 0, 0, 0)

        precision_task = self._calc_precision(question, ground_truth, retrieved_contexts, model)
        recall_task = self._calc_recall(question, ground_truth, retrieved_contexts, model)

        (precision, relevant_count), (recall, claims_total, claims_supported) = \
            await asyncio.gather(precision_task, recall_task)

        return RetrievalQualityScore(
            context_precision=precision,
            context_recall=recall,
            retrieved_count=len(retrieved_contexts),
            relevant_count=relevant_count,
            claims_total=claims_total,
            claims_supported=claims_supported,
        )

    async def _calc_precision(
        self, question: str, ground_truth: str, contexts: list[str], model: str
    ) -> tuple[float, int]:
        """Context Precision：召回中有多少是相关的（加权平均排名精确率）"""
        contexts_numbered = "\n".join(
            f"[{i+1}] {c[:500]}" for i, c in enumerate(contexts)
        )
        prompt = CONTEXT_PRECISION_PROMPT.format(
            question=question,
            ground_truth=ground_truth,
            contexts_numbered=contexts_numbered,
        )
        try:
            import json
            resp = await self.llm.call_async(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                model=model,
                response_format={"type": "json_object"},
            )
            data = json.loads(resp.choices[0].message.content)
            scores = data.get("scores", [])

            # 加权精确率：排名靠前的相关片段权重更高（参考 Ragas AP@K）
            relevant_count = sum(scores)
            if not scores:
                return 0.0, 0

            weighted_sum = 0.0
            num_relevant = 0
            for i, s in enumerate(scores):
                if s == 1:
                    num_relevant += 1
                    weighted_sum += num_relevant / (i + 1)

            precision = weighted_sum / max(relevant_count, 1)
            return round(precision, 3), int(relevant_count)

        except Exception as e:
            logger.warning(f"[RetrievalMetric] Precision 计算失败: {e}")
            return 0.5, 0

    async def _calc_recall(
        self, question: str, ground_truth: str, contexts: list[str], model: str
    ) -> tuple[float, int, int]:
        """Context Recall：标准答案的关键主张是否都能从上下文中找到支撑"""
        contexts_text = "\n---\n".join(c[:600] for c in contexts)
        prompt = CONTEXT_RECALL_PROMPT.format(
            question=question,
            ground_truth=ground_truth,
            contexts_text=contexts_text[:3000],
        )
        try:
            import json
            resp = await self.llm.call_async(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                model=model,
                response_format={"type": "json_object"},
            )
            data = json.loads(resp.choices[0].message.content)
            claims = data.get("claims", [])

            claims_total = len(claims)
            claims_supported = sum(1 for c in claims if c.get("supported"))

            recall = claims_supported / max(claims_total, 1)
            return round(recall, 3), claims_total, claims_supported

        except Exception as e:
            logger.warning(f"[RetrievalMetric] Recall 计算失败: {e}")
            return 0.5, 0, 0

    # ── 批量评估（供 ExperimentRegistry 调用）────────────

    async def batch_score(
        self,
        eval_items: list[dict],  # [{question, ground_truth, retrieved_contexts}]
        concurrency: int = 5,
    ) -> list[RetrievalQualityScore]:
        """并发批量评估"""
        semaphore = asyncio.Semaphore(concurrency)

        async def score_with_sem(item):
            async with semaphore:
                return await self.score(
                    question=item["question"],
                    ground_truth=item["ground_truth"],
                    retrieved_contexts=item.get("retrieved_contexts", []),
                )

        return await asyncio.gather(*[score_with_sem(item) for item in eval_items])


# ── 集成到 ExperimentRegistry ──────────────────────────
#
# 在运行检索质量实验时：
#
# async def run_retrieval_eval(exp_id, dataset_id, tenant_id):
#     dataset = dataset_store.get(dataset_id)
#     metric = RetrievalQualityMetric(llm_caller)
#
#     for item in dataset.items:
#         # 用龙虾的实际检索系统召回
#         retrieved = await enterprise_memory.search(
#             query=item["question"], tenant_id=tenant_id, limit=10
#         )
#         retrieved_texts = [r["content"] for r in retrieved]
#
#         score = await metric.score(
#             question=item["question"],
#             ground_truth=item["ground_truth"],
#             retrieved_contexts=retrieved_texts,
#         )
#
#         registry.add_result(exp_id, ExperimentResult(
#             dataset_item_id=item["id"],
#             input={"question": item["question"]},
#             output="",
#             scores={
#                 "context_precision": score.context_precision,
#                 "context_recall": score.context_recall,
#             }
#         ))
#
#     registry.complete(exp_id)
```

---

## 二、检索调优指南（基于指标结果）

```
Context Precision 低（< 0.6）：
  → 召回了太多无关记忆
  → 行动：提高 Qdrant 搜索阈值 / 减少 top_k / 启用更严格的 Payload 过滤
  
Context Recall 低（< 0.7）：
  → 遗漏了关键记忆
  → 行动：增加 top_k / 检查记忆的 embedding 质量 / 启用混合搜索（Dense+BM25）
  
两者都低：
  → 检索系统整体质量差
  → 行动：检查 Collection 的向量配置、文档分块策略
```

---

## 验收标准

- [ ] `RetrievalQualityMetric.score(question, ground_truth, retrieved_contexts)`：返回 `RetrievalQualityScore`
- [ ] `_calc_precision()`：加权 AP@K 精确率（排名靠前的相关片段权重更高）
- [ ] `_calc_recall()`：基于关键主张的召回率
- [ ] `batch_score()`：并发 Semaphore 限制（默认5路并发）
- [ ] 集成到 ExperimentRegistry：新增检索质量实验类型
- [ ] 指标名注册：`context_precision` / `context_recall`
- [ ] 前端 ExperimentRegistry 对比表格新增这两列指标
- [ ] 依赖：RAG 测试集（`CODEX_TASK_RAG_TESTSET_GENERATOR` 已落地）

---

*Codex Task | 来源：RAGAS_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
