# CODEX TASK: 批量并行评估 Pipeline（ExperimentRegistry 并发改造）

**优先级：P2**  
**来源：RAGAS_BORROWING_ANALYSIS.md P2-#4（Ragas Batch Evaluation）**

---

## 背景

`ExperimentRegistry.run_experiment_evaluation()` 目前是逐条串行调用 LLM 评分，评估100条数据集需要 100 次串行 LLM 调用，耗时约 5-10 分钟。借鉴 Ragas 批量并行评估，改造为 `asyncio.Semaphore` 控制并发，速度提升 5-8x。

---

## 实现

```python
# dragon-senate-saas-v2/experiment_registry.py（改造 run_experiment_evaluation）

import asyncio
import logging
import time

logger = logging.getLogger(__name__)

# 默认并发数：5路（避免 OpenAI Rate Limit）
DEFAULT_EVAL_CONCURRENCY = 5


async def run_experiment_evaluation(
    experiment_id: str,
    registry,
    quality_judge,
    dataset_store,
    concurrency: int = DEFAULT_EVAL_CONCURRENCY,
):
    """
    并行评估实验（原串行版 → asyncio.Semaphore 并发版）
    
    改造前：逐条串行，100条 ≈ 10分钟
    改造后：5路并发，100条 ≈ 2分钟（速度提升5x）
    """
    exp = registry.db.get_experiment(experiment_id)
    dataset = dataset_store.get(exp.dataset_id)

    if not dataset or not dataset.items:
        logger.error(f"[ParallelEval] 数据集为空: {exp.dataset_id}")
        return

    semaphore = asyncio.Semaphore(concurrency)
    start_time = time.time()

    logger.info(
        f"[ParallelEval] 开始评估 exp={experiment_id} "
        f"items={len(dataset.items)} concurrency={concurrency}"
    )

    async def eval_one(item: dict):
        """评估单条数据集记录（受 Semaphore 限速）"""
        async with semaphore:
            item_start = time.time()
            try:
                # 运行龙虾任务
                from dragon_senate_saas_v2.lobster_runner import LobsterRunner
                runner = LobsterRunner()
                output = await runner.run(
                    lobster_name=exp.lobster_name,
                    input=item.get("question", item.get("input", "")),
                    tenant_id=exp.tenant_id,
                    prompt_version=exp.prompt_version,
                    model=exp.model,
                )

                # 评估各项指标
                scores = await quality_judge.evaluate_async(
                    lobster_name=exp.lobster_name,
                    input=item.get("question", ""),
                    output=output,
                    context=item.get("reference_contexts", []),
                    metrics=exp.config.get("metrics", None),
                )

                latency_ms = int((time.time() - item_start) * 1000)

                from dragon_senate_saas_v2.experiment_registry import ExperimentResult
                registry.add_result(experiment_id, ExperimentResult(
                    dataset_item_id=item.get("id", ""),
                    input={"question": item.get("question", "")},
                    output=output,
                    scores=scores,
                    latency_ms=latency_ms,
                ))

            except Exception as e:
                logger.warning(f"[ParallelEval] 评估失败 item={item.get('id')}: {e}")
                from dragon_senate_saas_v2.experiment_registry import ExperimentResult
                registry.add_result(experiment_id, ExperimentResult(
                    dataset_item_id=item.get("id", ""),
                    input={},
                    output="",
                    scores={},
                    error=str(e),
                ))

    # 并发执行所有评估任务
    await asyncio.gather(*[eval_one(item) for item in dataset.items])

    # 完成实验，计算汇总
    registry.complete(experiment_id)

    elapsed = round(time.time() - start_time, 1)
    exp = registry.db.get_experiment(experiment_id)
    logger.info(
        f"[ParallelEval] 完成 exp={experiment_id} "
        f"耗时={elapsed}s avg_scores={exp.avg_scores}"
    )
```

---

## 配置

```python
# dragon-senate-saas-v2/dynamic_config.py（新增评估并发配置）
EVAL_CONCURRENCY = int(os.environ.get("EVAL_CONCURRENCY", "5"))

# .env
# EVAL_CONCURRENCY=5      # 默认5路（OpenAI RPM 限制友好）
# EVAL_CONCURRENCY=10     # 企业版可以更激进
# EVAL_CONCURRENCY=1      # 调试时用串行
```

---

## 验收标准

- [ ] `run_experiment_evaluation()` 改为 `asyncio.Semaphore` 并发
- [ ] 默认并发数：5（通过 `EVAL_CONCURRENCY` 环境变量配置）
- [ ] 单条失败不影响整体流程（try/except + error 字段记录）
- [ ] 日志：开始时打印 items 数量 + concurrency，完成时打印耗时 + avg_scores
- [ ] 与 `ExperimentResult.error` 字段兼容（失败条目有 error 信息）
- [ ] `registry.complete()` 在所有任务 gather 完成后才调用

---

*Codex Task | 来源：RAGAS_BORROWING_ANALYSIS.md P2-#4 | 2026-04-02*
