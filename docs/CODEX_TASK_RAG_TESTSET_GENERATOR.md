# CODEX TASK: RAG 评估测试集自动生成器（TestSet Generator）

**优先级：P1**  
**来源：RAGAS_BORROWING_ANALYSIS.md P1-#1（Ragas TestSet Generator）**

---

## 背景

构建 RAG 评估测试集是检索质量评估的前提。手动标注50个"问题-上下文-参考答案"三元组需要 2-3 天，而且容易有标注偏差。借鉴 Ragas TestSet Generator 思路，实现从 `enterprise_memory` 文档自动生成评估问题集，生成三类问题（简单/推理/跨文档），保存到 `dataset_store.py` 供 ExperimentRegistry 使用。

---

## 一、核心实现

```python
# scripts/generate_rag_testset.py

import asyncio
import json
import random
import logging
from dataclasses import dataclass, field
from typing import Literal
from pathlib import Path

logger = logging.getLogger(__name__)

QuestionType = Literal["simple", "reasoning", "multi_context"]

QUESTION_TYPE_PROMPTS = {
    "simple": """
基于以下文档片段，生成一个简单直接的问题（答案可以在片段中直接找到）。
要求：
- 问题自然，像真实用户会问的
- 答案在文档中明确存在
- 同时提供参考答案

文档片段：
{context}

输出 JSON：{{"question": "...", "ground_truth": "..."}}
""",
    "reasoning": """
基于以下文档片段，生成一个需要推理/分析的问题（需要理解和分析才能回答）。
要求：
- 问题需要对文档内容进行分析或推断
- 不能直接从文档复制答案，需要总结或推导

文档片段：
{context}

输出 JSON：{{"question": "...", "ground_truth": "..."}}
""",
    "multi_context": """
基于以下多个文档片段，生成一个需要综合多个来源才能回答的问题。
要求：
- 答案需要同时参考多个片段
- 单个片段无法完整回答

文档片段：
{contexts}

输出 JSON：{{"question": "...", "ground_truth": "..."}}
""",
}


@dataclass
class RagTestItem:
    """RAG 评估数据集的一条记录"""
    question: str
    ground_truth: str
    reference_contexts: list[str]   # 理论上应召回的上下文
    question_type: QuestionType = "simple"
    tenant_id: str = ""
    metadata: dict = field(default_factory=dict)


class RagTestsetGenerator:
    """
    RAG 评估测试集自动生成器
    
    流程：
      1. 从 enterprise_memory 抽取文档块
      2. 按分布比例生成三类问题（simple/reasoning/multi_context）
      3. LLM 自动生成"问题 + 参考答案"
      4. 保存到 dataset_store.py（供 ExperimentRegistry 使用）
    """

    def __init__(self, llm_caller, memory_store):
        self.llm = llm_caller
        self.memory = memory_store

    async def generate(
        self,
        tenant_id: str,
        test_size: int = 50,
        distributions: dict[QuestionType, float] = None,
        save_to_dataset_store: bool = True,
        dataset_name: str = None,
    ) -> list[RagTestItem]:
        """
        主入口：自动生成 RAG 评估测试集
        
        Args:
            tenant_id: 租户ID（从哪个租户的记忆中生成）
            test_size: 生成问题总数
            distributions: 三类问题的比例（默认 simple:0.5/reasoning:0.25/multi:0.25）
            save_to_dataset_store: 是否保存到 dataset_store.py
            dataset_name: 数据集名称（默认 rag_eval_{tenant_id}_{date}）
        """
        if distributions is None:
            distributions = {
                "simple": 0.5,
                "reasoning": 0.25,
                "multi_context": 0.25,
            }

        # 计算各类问题数量
        counts = {
            q_type: max(1, int(test_size * ratio))
            for q_type, ratio in distributions.items()
        }
        # 修正总数
        total = sum(counts.values())
        if total < test_size:
            counts["simple"] += test_size - total

        logger.info(f"[RagTestset] 开始生成: {counts}")

        # 从 enterprise_memory 抽取文档块
        all_chunks = await self._fetch_memory_chunks(tenant_id, sample_size=test_size * 3)
        if not all_chunks:
            raise ValueError(f"tenant {tenant_id} 的记忆为空，无法生成测试集")

        # 并行生成各类问题
        items = []
        tasks = []

        for q_type, count in counts.items():
            for i in range(count):
                if q_type == "multi_context":
                    # 随机取2-3个文档块
                    contexts = random.sample(all_chunks, min(3, len(all_chunks)))
                    task = self._generate_multi_context_item(contexts, tenant_id)
                else:
                    chunk = random.choice(all_chunks)
                    task = self._generate_single_item(chunk, q_type, tenant_id)
                tasks.append(task)

        results = await asyncio.gather(*tasks, return_exceptions=True)
        for r in results:
            if isinstance(r, RagTestItem):
                items.append(r)
            else:
                logger.warning(f"[RagTestset] 生成失败: {r}")

        logger.info(f"[RagTestset] 生成完成: {len(items)}/{test_size} 条")

        # 保存到 dataset_store
        if save_to_dataset_store and items:
            name = dataset_name or f"rag_eval_{tenant_id}"
            await self._save_to_dataset_store(items, name, tenant_id)

        return items

    async def _fetch_memory_chunks(
        self, tenant_id: str, sample_size: int = 150
    ) -> list[str]:
        """从 enterprise_memory 随机抽取文档块"""
        results = await self.memory.search_async(
            query="",  # 空查询，随机抽取
            tenant_id=tenant_id,
            limit=sample_size,
            use_hybrid=False,
        )
        return [r["content"] for r in results if r.get("content")]

    async def _generate_single_item(
        self, chunk: str, q_type: QuestionType, tenant_id: str
    ) -> RagTestItem:
        """生成 simple 或 reasoning 类型的问题"""
        prompt = QUESTION_TYPE_PROMPTS[q_type].format(context=chunk[:2000])
        try:
            import json
            resp = await self.llm.call_async(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,
                response_format={"type": "json_object"},
            )
            data = json.loads(resp.choices[0].message.content)
            return RagTestItem(
                question=data["question"],
                ground_truth=data["ground_truth"],
                reference_contexts=[chunk],
                question_type=q_type,
                tenant_id=tenant_id,
            )
        except Exception as e:
            raise RuntimeError(f"生成失败: {e}")

    async def _generate_multi_context_item(
        self, chunks: list[str], tenant_id: str
    ) -> RagTestItem:
        """生成 multi_context 类型的问题"""
        contexts_text = "\n\n---\n\n".join(c[:800] for c in chunks)
        prompt = QUESTION_TYPE_PROMPTS["multi_context"].format(contexts=contexts_text)
        try:
            import json
            resp = await self.llm.call_async(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,
                response_format={"type": "json_object"},
            )
            data = json.loads(resp.choices[0].message.content)
            return RagTestItem(
                question=data["question"],
                ground_truth=data["ground_truth"],
                reference_contexts=chunks,
                question_type="multi_context",
                tenant_id=tenant_id,
            )
        except Exception as e:
            raise RuntimeError(f"multi_context 生成失败: {e}")

    async def _save_to_dataset_store(
        self, items: list[RagTestItem], name: str, tenant_id: str
    ):
        """保存到 dataset_store.py"""
        from dragon_senate_saas_v2.dataset_store import DatasetStore
        store = DatasetStore()
        dataset_id = await store.create_dataset(
            name=name,
            tenant_id=tenant_id,
            items=[
                {
                    "question": item.question,
                    "ground_truth": item.ground_truth,
                    "reference_contexts": item.reference_contexts,
                    "question_type": item.question_type,
                }
                for item in items
            ],
            metadata={
                "generator": "RagTestsetGenerator",
                "source": "enterprise_memory",
                "total": len(items),
            },
        )
        logger.info(f"[RagTestset] 已保存到 dataset_store: {dataset_id} ({name})")
        return dataset_id
```

---

## 二、CLI 入口（运行脚本）

```python
# scripts/generate_rag_testset.py（底部 main）

if __name__ == "__main__":
    import argparse, asyncio

    parser = argparse.ArgumentParser(description="RAG 评估测试集生成器")
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--size", type=int, default=50, help="生成问题数量")
    parser.add_argument("--name", help="数据集名称")
    args = parser.parse_args()

    async def main():
        from dragon_senate_saas_v2.app import create_app
        app = create_app()
        generator = RagTestsetGenerator(app.llm_caller, app.memory_store)
        items = await generator.generate(
            tenant_id=args.tenant_id,
            test_size=args.size,
            dataset_name=args.name,
        )
        print(f"✅ 生成完成：{len(items)} 条测试数据")
        print(f"   simple: {sum(1 for i in items if i.question_type=='simple')}")
        print(f"   reasoning: {sum(1 for i in items if i.question_type=='reasoning')}")
        print(f"   multi_context: {sum(1 for i in items if i.question_type=='multi_context')}")

    asyncio.run(main())

# 使用示例：
# python scripts/generate_rag_testset.py --tenant-id tenant_001 --size 50
```

---

## 验收标准

- [ ] `RagTestsetGenerator.generate()` 主入口：按分布生成三类问题
- [ ] `_fetch_memory_chunks()`：从 `enterprise_memory` 随机抽取文档块
- [ ] `_generate_single_item()`：生成 simple/reasoning 问题
- [ ] `_generate_multi_context_item()`：生成跨文档问题（2-3个chunk）
- [ ] `asyncio.gather()` 并行生成（不串行等待）
- [ ] `_save_to_dataset_store()`：保存到已有 `dataset_store.py`
- [ ] CLI 入口：`--tenant-id` / `--size` / `--name` 参数
- [ ] 生成失败的条目 warning 日志，不崩溃整体流程
- [ ] distributions 三类比例可配置（默认 50%/25%/25%）

---

*Codex Task | 来源：RAGAS_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
