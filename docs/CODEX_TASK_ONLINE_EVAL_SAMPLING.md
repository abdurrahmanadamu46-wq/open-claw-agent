# CODEX TASK: 龙虾在线采样评估（Online Evaluation Sampling）

**优先级：P2**  
**来源：OPIK_BORROWING_ANALYSIS.md P2-#2（Opik Online Evaluation）**

---

## 背景

`llm_quality_judge.py` 已能评分，但需手动触发。借鉴 Opik 在线评估，在 `lobster_runner.py` 中以装饰器模式按采样率自动触发质量评判，结果写入 ExperimentRegistry（P1 已落地），实现生产质量持续监控。

---

## 实现

```python
# dragon-senate-saas-v2/online_eval_sampler.py

import random
import asyncio
import logging
from functools import wraps
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# ── 采样配置（可通过 dynamic_config 热更新）─────────────
ONLINE_EVAL_CONFIG = {
    "enabled": True,
    "sampling_rate": 0.1,    # 10% 抽样
    "metrics": ["task_completion", "hallucination"],
    "async_eval": True,      # 异步评估（不阻塞主流程）
}


class OnlineEvalSampler:
    """
    在线评估采样器：按概率触发 llm_quality_judge，结果写入实验记录
    
    使用方式：
      @sampler.track(lobster_name="strategist")
      async def run_task(input: str, tenant_id: str) -> str:
          ...
    """

    def __init__(self, quality_judge, experiment_registry):
        self.judge = quality_judge
        self.registry = experiment_registry

    def track(
        self,
        lobster_name: str,
        sampling_rate: Optional[float] = None,
    ):
        """装饰器：自动采样评估"""
        def decorator(func: Callable):
            @wraps(func)
            async def wrapper(*args, **kwargs):
                # 执行原始任务
                output = await func(*args, **kwargs)

                # 按采样率决定是否评估
                rate = sampling_rate or ONLINE_EVAL_CONFIG.get("sampling_rate", 0.1)
                if ONLINE_EVAL_CONFIG.get("enabled") and random.random() < rate:
                    input_data = kwargs.get("input") or (args[0] if args else "")
                    tenant_id = kwargs.get("tenant_id", "unknown")

                    if ONLINE_EVAL_CONFIG.get("async_eval"):
                        # 异步评估（不阻塞返回）
                        asyncio.create_task(
                            self._evaluate(lobster_name, input_data, output, tenant_id)
                        )
                    else:
                        await self._evaluate(lobster_name, input_data, output, tenant_id)

                return output
            return wrapper
        return decorator

    async def _evaluate(
        self,
        lobster_name: str,
        input_data: str,
        output: str,
        tenant_id: str,
    ):
        """执行质量评估并记录"""
        try:
            scores = await self.judge.evaluate_async(
                lobster_name=lobster_name,
                input=input_data,
                output=output,
                metrics=ONLINE_EVAL_CONFIG.get("metrics", []),
            )
            # 写入在线评估专用实验（"online_eval_{lobster}" 常驻实验）
            online_exp_id = f"online_eval_{lobster_name}_{tenant_id}"
            self.registry.append_online_result(
                experiment_id=online_exp_id,
                lobster_name=lobster_name,
                input=input_data,
                output=output,
                scores=scores,
                tenant_id=tenant_id,
            )
            logger.debug(f"[OnlineEval] {lobster_name} 评估完成: {scores}")
        except Exception as e:
            logger.warning(f"[OnlineEval] 评估失败: {e}")


# 集成到 lobster_runner.py：
# 
# from .online_eval_sampler import OnlineEvalSampler
# sampler = OnlineEvalSampler(quality_judge, experiment_registry)
#
# class LobsterRunner:
#
#     @sampler.track(lobster_name="strategist")
#     async def run_strategist(self, input: str, tenant_id: str) -> str:
#         return await self._strategist.run(input)
```

---

## 验收标准

- [ ] `OnlineEvalSampler.track()` 装饰器：按 sampling_rate 随机采样
- [ ] 异步评估（`asyncio.create_task`，不阻塞主流程）
- [ ] 结果写入 `ExperimentRegistry.append_online_result()`
- [ ] `sampling_rate` 支持通过 `dynamic_config` 热更新
- [ ] `enabled=False` 时完全跳过评估
- [ ] 集成到 `lobster_runner.py` 的各龙虾执行方法

---

*Codex Task | 来源：OPIK_BORROWING_ANALYSIS.md P2-#2 | 2026-04-02*
